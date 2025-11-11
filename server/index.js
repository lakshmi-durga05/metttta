require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@deepgram/sdk');
const PORT = process.env.PORT || 3001;
const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5174',
      'http://localhost:5175',
      'http://127.0.0.1:5175',
    ],
    methods: ['GET', 'POST']
  },
  // Allow larger payloads for base64 data URLs when sharing media
  maxHttpBufferSize: 5e7 // 50 MB
});

const whiteboards = new Map(); // roomId -> { actions: Array<stroke|fill> }
const roomMedia = new Map();   // roomId -> { items: Array<{name,type,dataUrl}> }
const roomDocs = new Map();    // roomId -> { text: string }
const roomTranscripts = new Map(); // roomId -> { segments: Array<{ userId, name, text, ts }> }
const roomChats = new Map();   // roomId -> { messages: Array<{ userId, name, text, ts, cid? }> }

const transcriptsDir = path.join(__dirname, 'transcripts');
try { if (!fs.existsSync(transcriptsDir)) fs.mkdirSync(transcriptsDir, { recursive: true }); } catch {}
// Batch-only switch (disable Deepgram live websockets). Default true for reliability on restrictive networks.
const STT_BATCH_ONLY = (process.env.STT_BATCH_ONLY === '1' || process.env.STT_BATCH_ONLY === 'true' || true);

// Batch transcription fallback state (per room)
const roomAudio = new Map(); // roomId -> { mimetype: string, chunks: Buffer[], timer: NodeJS.Timeout|null }

function ensureRoomAudio(roomId, mimetype) {
  const r = roomAudio.get(roomId) || { mimetype: mimetype || 'pcm16', chunks: [], timer: null };
  r.mimetype = mimetype || r.mimetype || 'pcm16';
  if (!r.chunks) r.chunks = [];
  roomAudio.set(roomId, r);
  return r;
}

function pcm16ToWav(int16Buffer, sampleRate = 16000, channels = 1) {
  const bytesPerSample = 2;
  const dataLength = int16Buffer.byteLength;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM header size
  buffer.writeUInt16LE(1, 20); // audio format = PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(8 * bytesPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  Buffer.from(int16Buffer).copy(buffer, 44);
  return buffer;
}

async function transcribeBatchWithOpenAI(buf, mimetype) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  const filename = mimetype === 'pcm16' ? 'audio.wav' : (mimetype.includes('ogg') ? 'audio.ogg' : 'audio.webm');
  const form = new FormData();
  form.append('file', new Blob([buf]), filename);
  form.append('model', 'whisper-1');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form
  });
  if (!res.ok) throw new Error('OpenAI transcribe failed: ' + res.status + ' ' + (await res.text()).slice(0, 500));
  const js = await res.json();
  return (js?.text || '').toString();
}

io.on('connection', (socket) => {
  let joinedRoom = null;
  let user = null;
  const deepgramKey = process.env.DEEPGRAM_API_KEY || '';
  const deepgram = deepgramKey ? createClient(deepgramKey) : null;
  let dgConn = null; // Deepgram live connection per socket

  socket.on('room:join', ({ roomId, userId, name, avatar }) => {
    joinedRoom = roomId;
    user = { id: userId, name, avatar };
    socket.join(roomId);
    socket.to(roomId).emit('presence:join', user);

    const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    const members = clients
      .map((id) => io.sockets.sockets.get(id))
      .filter(Boolean)
      .map((s) => s.data.user)
      .filter(Boolean);

    socket.emit('presence:roster', members);
    socket.data.user = user;
    if (!whiteboards.has(roomId)) whiteboards.set(roomId, { actions: [] });
    if (!roomMedia.has(roomId)) roomMedia.set(roomId, { items: [] });
    if (!roomChats.has(roomId)) roomChats.set(roomId, { messages: [] });
  });

  // Live STT streaming via Deepgram
  // Client should emit:
  //  - 'stt:stream:start' with { mimetype?: string, language?: string }
  //  - 'stt:stream:chunk' with raw binary audio chunks (Buffer) from MediaRecorder
  //  - 'stt:stream:stop'
  socket.on('stt:stream:start', async (cfg = {}) => {
    // Allow STT even if Deepgram client isn't available (batch-only mode)
    if (!joinedRoom) { return; }
    try {
      if (dgConn) { try { await dgConn.finish(); } catch {} dgConn = null; }
      socket.emit('stt:dg:status', { ok: true, event: 'client_start', cfg });
      const mimetype = typeof cfg.mimetype === 'string' && cfg.mimetype ? cfg.mimetype : 'audio/webm;codecs=opus';
      const language = typeof cfg.language === 'string' && cfg.language ? cfg.language : 'en-US';
      // Map client mimetype to Deepgram encoding/options
      let dgOpts = {
        model: 'nova-2-general',
        language,
        detect_language: true,
        interim_results: true,
        smart_format: true,
        punctuate: true,
        endpointing: 100,
      };
      const mt = (mimetype || '').toLowerCase();
      if (STT_BATCH_ONLY) {
        // Initialize batch-only buffer as pcm16; client fallback sends Int16 chunks via socket
        const ra = ensureRoomAudio(joinedRoom, 'pcm16');
        if (!ra.timer) {
          ra.timer = setInterval(async () => {
            try {
              const current = roomAudio.get(joinedRoom);
              if (!current || current.chunks.length === 0) return;
              if ((current.mimetype || '').toLowerCase() !== 'pcm16') return;
              const merged = Buffer.concat(current.chunks);
              current.chunks = [];
              const wav = pcm16ToWav(merged, 16000, 1);
              try {
                try { socket.emit('stt:dg:status', { ok: true, event: 'batch_start', bytes: merged.length }); } catch {}
                const text = await transcribeBatchWithOpenAI(wav, 'pcm16');
                if (text && text.trim()) {
                  const entry = { userId: user?.id, name: user?.name || 'Guest', text: text.trim(), ts: Date.now() };
                  const bag = roomTranscripts.get(joinedRoom) || { segments: [] };
                  bag.segments.push(entry);
                  roomTranscripts.set(joinedRoom, bag);
                  io.to(joinedRoom).emit('stt:segment', entry);
                  try { socket.emit('stt:dg:status', { ok: true, event: 'batch_ok', chars: text.trim().length }); } catch {}
                }
              } catch (e) { }
            } catch {}
          }, 7000);
        }
        // Do not open Deepgram websocket in batch-only mode
        dgConn = null;
      } else if (deepgram) {
        if (mt === 'pcm16') {
          dgOpts = { ...dgOpts, encoding: 'linear16', sample_rate: 16000, channels: 1 };
        } else if (mt.includes('webm')) {
          dgOpts = { ...dgOpts, encoding: 'webm' };
        } else if (mt.includes('ogg')) {
          dgOpts = { ...dgOpts, encoding: 'ogg' };
        } else if (mt.includes('opus')) {
          dgOpts = { ...dgOpts, encoding: 'ogg' };
        } else {
          dgOpts = { ...dgOpts, encoding: 'webm' };
        }
        dgConn = deepgram.listen.live(dgOpts);
        dgConn.on('open', () => { socket.emit('stt:dg:status', { ok: true, event: 'open' }); });
        dgConn.on('error', (err) => { const msg = (err && (err.message || err.toString?.())) || 'unknown'; try { socket.emit('stt:dg:status', { ok: false, event: 'error', message: msg }); } catch {} });
        dgConn.on('close', (evt) => { let code, reason; try { code = evt?.code; reason = evt?.reason || evt?.message; } catch {} try { socket.emit('stt:dg:status', { ok: true, event: 'close', code, reason }); } catch {} });
        const handleTranscript = (dgMsg) => {
          try {
            const ch = dgMsg && dgMsg.channel; const alt = ch && ch.alternatives && ch.alternatives[0]; const text = (alt && alt.transcript) || '';
            if (!text) return; const isFinal = Boolean(dgMsg.is_final);
            if (isFinal) { const entry = { userId: user?.id, name: user?.name || 'Guest', text: text.trim(), ts: Date.now() }; const bag = roomTranscripts.get(joinedRoom) || { segments: [] }; bag.segments.push(entry); roomTranscripts.set(joinedRoom, bag); io.to(joinedRoom).emit('stt:segment', entry); }
            else { socket.emit('stt:interim', { text }); }
          } catch {}
        };
        dgConn.on('transcript', handleTranscript);
        dgConn.on('transcriptReceived', handleTranscript);
      }

      // Initialize batch fallback buffer for this room (only used for pcm16 reliably)
      try {
        const ra = ensureRoomAudio(joinedRoom, mimetype);
        if (!ra.timer) {
          ra.timer = setInterval(async () => {
            try {
              const current = roomAudio.get(joinedRoom);
              if (!current || current.chunks.length === 0) return;
              // Only batch for pcm16 to ensure valid WAV
              if ((current.mimetype || '').toLowerCase() !== 'pcm16') return;
              const merged = Buffer.concat(current.chunks);
              current.chunks = [];
              const wav = pcm16ToWav(merged, 16000, 1);
              try {
                try { socket.emit('stt:dg:status', { ok: true, event: 'batch_start', bytes: merged.length }); } catch {}
                const text = await transcribeBatchWithOpenAI(wav, 'pcm16');
                if (text && text.trim()) {
                  const entry = { userId: user?.id, name: user?.name || 'Guest', text: text.trim(), ts: Date.now() };
                  const bag = roomTranscripts.get(joinedRoom) || { segments: [] };
                  bag.segments.push(entry);
                  roomTranscripts.set(joinedRoom, bag);
                  io.to(joinedRoom).emit('stt:segment', entry);
                  try { socket.emit('stt:dg:status', { ok: true, event: 'batch_ok', chars: text.trim().length }); } catch {}
                }
              } catch (e) { }
            } catch {}
          }, 7000);
        }
      } catch {}

      // Live-DG event hooks are installed only when not in batch-only mode
      const handleTranscript = (dgMsg) => {
        try {
          const ch = dgMsg && dgMsg.channel;
          const alt = ch && ch.alternatives && ch.alternatives[0];
          const text = (alt && alt.transcript) || '';
          if (!text) return;
          const isFinal = Boolean(dgMsg.is_final);
          if (isFinal) {
            // Save and broadcast to room as a final segment
            const entry = { userId: user?.id, name: user?.name || 'Guest', text: text.trim(), ts: Date.now() };
            const bag = roomTranscripts.get(joinedRoom) || { segments: [] };
            bag.segments.push(entry);
            roomTranscripts.set(joinedRoom, bag);
            io.to(joinedRoom).emit('stt:segment', entry);
          } else {
            // Send interim back only to the speaker
            socket.emit('stt:interim', { text });
          }
        } catch {}
      };
      if (dgConn && typeof dgConn.on === 'function') {
        dgConn.on('transcript', handleTranscript);
        dgConn.on('transcriptReceived', handleTranscript);
      }
    } catch (e) {
      socket.emit('stt:dg:status', { ok: false, event: 'start_error', error: String(e && e.message || e) });
    }
  });

  socket.on('stt:stream:chunk', async (chunk) => {
    if (!chunk) return;
    try {
      // chunk can be Buffer or ArrayBuffer
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buf && buf.length) {
        if (dgConn) { try { dgConn.send(buf); } catch {} }
        socket.emit('stt:dg:status', { ok: true, event: 'chunk_sent', bytes: buf.length });
      }
      // Save for batch fallback when using pcm16
      try {
        if (joinedRoom) {
          const ra = ensureRoomAudio(joinedRoom);
          // In batch-only mode we always store PCM16 chunks; client fallback sends Int16
          ra.chunks.push(buf);
        }
      } catch {}
    } catch (e) {
      try { socket.emit('stt:dg:status', { ok: false, event: 'send_error', message: e?.message || 'send failed' }); } catch {}
    }
  });

  socket.on('stt:stream:stop', async () => {
    if (!dgConn) return;
    try { await dgConn.finish(); } catch {}
    dgConn = null;
  });

  // Transcript: collect final STT segments per room and broadcast
  socket.on('stt:segment', (payload) => {
    if (!joinedRoom || !payload || typeof payload.text !== 'string' || !payload.text.trim()) return;
    const entry = { userId: user?.id, name: user?.name || 'Guest', text: payload.text.trim(), ts: Date.now() };
    const bag = roomTranscripts.get(joinedRoom) || { segments: [] };
    bag.segments.push(entry);
    roomTranscripts.set(joinedRoom, bag);
    io.to(joinedRoom).emit('stt:segment', entry);
  });
  socket.on('stt:requestState', () => {
    if (!joinedRoom) return;
    const bag = roomTranscripts.get(joinedRoom) || { segments: [] };
    socket.emit('stt:state', bag);
  });
  socket.on('stt:summary', () => {
    if (!joinedRoom) return;
    const bag = roomTranscripts.get(joinedRoom) || { segments: [] };
    const all = bag.segments.map(s=>s.text).join(' ');
    if (!all.trim()) { socket.emit('stt:summary', { summary: '' }); return; }
    try {
      const sentences = all.split(/(?<=[.!?])\s+/).slice(0, 80);
      const words = all.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
      const stop = new Set(['the','and','a','an','to','of','in','is','it','that','for','on','with','as','are','was','be','this','you','i']);
      const freq = new Map();
      for (const w of words) { if (!stop.has(w)) freq.set(w, (freq.get(w)||0)+1); }
      const scored = sentences.map((s) => {
        const sw = s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);
        const score = sw.reduce((sum, w) => sum + (freq.get(w)||0), 0) / Math.sqrt(sw.length || 1);
        return { s, score };
      });
      scored.sort((a,b)=> b.score - a.score);
      const top = scored.slice(0, Math.max(2, Math.min(6, Math.ceil(scored.length/3))))
                        .map(x=>x.s.trim()).join(' ');
      socket.emit('stt:summary', { summary: top });
    } catch {
      socket.emit('stt:summary', { summary: '' });
    }
  });

  function findSocketIdByUserId(roomId, targetUserId) {
    const clientIds = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    for (const sid of clientIds) {
      const s = io.sockets.sockets.get(sid);
      if (s && s.data && s.data.user && s.data.user.id === targetUserId) {
        return sid;
      }
    }
    return null;
  }

  socket.on('webrtc:signal', (payload) => {
    if (!joinedRoom || !user) return;
    const { to, from, data } = payload || {};
    const targetSid = findSocketIdByUserId(joinedRoom, to);
    if (targetSid) {
      io.to(targetSid).emit('webrtc:signal', { from: from || user.id, data });
    }
  });

  socket.on('avatar:pose', (payload) => {
    if (!joinedRoom) return;
    socket.to(joinedRoom).emit('avatar:pose', payload);
  });

  socket.on('avatar:update', (payload) => {
    if (!joinedRoom || !user) return;
    const { avatar } = payload || {};
    if (!avatar) return;
    user.avatar = avatar;
    socket.data.user = user;
    io.to(joinedRoom).emit('presence:update', user);
  });

  socket.on('cursor:pos', (payload) => {
    if (!joinedRoom) return;
    socket.to(joinedRoom).emit('cursor:pos', payload);
  });

  socket.on('whiteboard:stroke', (payload) => {
    if (!joinedRoom) return;
    const board = whiteboards.get(joinedRoom) || { actions: [] };
    if (payload && Array.isArray(payload.points)) {
      const act = { type: 'stroke', tool: payload.tool || 'pencil', color: payload.color, size: payload.size, points: payload.points };
      board.actions.push(act);
      whiteboards.set(joinedRoom, board);
      socket.to(joinedRoom).emit('whiteboard:stroke', act);
    }
  });

  socket.on('whiteboard:fill', (payload) => {
    if (!joinedRoom) return;
    const board = whiteboards.get(joinedRoom) || { actions: [] };
    if (payload && typeof payload.x === 'number' && typeof payload.y === 'number') {
      const act = { type: 'fill', color: payload.color, x: payload.x, y: payload.y };
      board.actions.push(act);
      whiteboards.set(joinedRoom, board);
      socket.to(joinedRoom).emit('whiteboard:fill', act);
    }
  });

  socket.on('whiteboard:clear', () => {
    if (!joinedRoom) return;
    whiteboards.set(joinedRoom, { actions: [] });
    io.to(joinedRoom).emit('whiteboard:clear');
  });

  socket.on('whiteboard:requestState', () => {
    if (!joinedRoom) return;
    const board = whiteboards.get(joinedRoom) || { actions: [] };
    socket.emit('whiteboard:state', board);
  });

  // Collaborative document editing: simple last-write-wins text sync
  socket.on('doc:requestState', () => {
    if (!joinedRoom) return;
    const doc = roomDocs.get(joinedRoom) || { text: '' };
    socket.emit('doc:state', doc);
  });
  socket.on('doc:update', (payload) => {
    if (!joinedRoom || !payload || typeof payload.text !== 'string') return;
    const current = roomDocs.get(joinedRoom) || { text: '' };
    current.text = payload.text;
    roomDocs.set(joinedRoom, current);
    socket.to(joinedRoom).emit('doc:update', { text: current.text });
  });

  // AI meeting summarization: lightweight extractive summary
  socket.on('ai:summarize', (payload) => {
    if (!payload || typeof payload.text !== 'string') return;
    const text = payload.text.trim();
    if (!text) { socket.emit('ai:summary', { summary: '' }); return; }
    try {
      const sentences = text.split(/(?<=[.!?])\s+/).slice(0, 30);
      const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
      const stop = new Set(['the','and','a','an','to','of','in','is','it','that','for','on','with','as','are','was','be']);
      const freq = new Map();
      for (const w of words) { if (!stop.has(w)) freq.set(w, (freq.get(w)||0)+1); }
      const scored = sentences.map((s) => {
        const sw = s.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);
        const score = sw.reduce((sum, w) => sum + (freq.get(w)||0), 0) / Math.sqrt(sw.length || 1);
        return { s, score };
      });
      scored.sort((a,b)=> b.score - a.score);
      const top = scored.slice(0, Math.max(2, Math.min(5, Math.ceil(scored.length/3))))
                        .map(x=>x.s.trim()).join(' ');
      socket.emit('ai:summary', { summary: top });
    } catch {
      socket.emit('ai:summary', { summary: '' });
    } 
  });

  // Media sharing: broadcast newly added files as data URLs to the room
  socket.on('media:add', (payload) => {
    if (!joinedRoom) return;
    const items = (payload && Array.isArray(payload.items)) ? payload.items : [];
    if (!items.length) return;
    const stash = roomMedia.get(joinedRoom) || { items: [] };
    stash.items.push(...items);
    roomMedia.set(joinedRoom, stash);
    socket.to(joinedRoom).emit('media:add', { items });
  });

  socket.on('media:requestState', () => {
    if (!joinedRoom) return;
    const stash = roomMedia.get(joinedRoom) || { items: [] };
    socket.emit('media:state', stash);
  });

  socket.on('chat:message', (payload) => {
    if (!joinedRoom || !payload || typeof payload.text !== 'string') return;
    const msg = {
      userId: user?.id,
      name: user?.name || 'Guest',
      text: payload.text,
      ts: Date.now(),
      cid: payload.cid,
    };
    try {
      const chat = roomChats.get(joinedRoom) || { messages: [] };
      chat.messages.push({ userId: msg.userId, name: msg.name, text: msg.text, ts: msg.ts, cid: msg.cid });
      roomChats.set(joinedRoom, chat);
    } catch {}
    io.to(joinedRoom).emit('chat:message', msg);
  });

  // Compile and persist transcript when a client ends the meeting
  socket.on('meeting:end', () => {
    if (!joinedRoom) return;
    try {
      const rid = joinedRoom;
      const stt = roomTranscripts.get(rid) || { segments: [] };
      const chat = roomChats.get(rid) || { messages: [] };
      const combined = [];
      for (const s of (stt.segments || [])) combined.push({ kind: 'voice', userId: s.userId, name: s.name, text: s.text, ts: s.ts });
      for (const m of (chat.messages || [])) combined.push({ kind: 'chat', userId: m.userId, name: m.name, text: m.text, ts: m.ts });
      combined.sort((a,b)=> (a.ts||0)-(b.ts||0));
      const participantsMap = new Map();
      for (const ev of combined) { if (ev.userId) participantsMap.set(ev.userId, ev.name || 'Guest'); }
      const participants = Array.from(participantsMap.entries()).map(([id,name])=>({ id, name }));
      const startedAt = combined.length ? combined[0].ts : Date.now();
      const endedAt = Date.now();
      const transcriptText = combined.map(ev => {
        const t = new Date(ev.ts).toISOString();
        return `[${t}] ${ev.name}: ${ev.text}`;
      }).join('\n');
      const payload = { roomId: rid, startedAt, endedAt, participants, events: combined, transcriptText };
      const fname = `${rid}-${endedAt}.json`;
      const fpath = path.join(transcriptsDir, fname);
      try { fs.writeFileSync(fpath, JSON.stringify(payload, null, 2), 'utf8'); } catch {}
      socket.emit('transcript:ready', { roomId: rid, file: fname, ok: true, transcriptText });
    } catch {
      socket.emit('transcript:ready', { roomId: joinedRoom, ok: false });
    }
  });

  // Retrieve a list of saved transcripts for a room
  socket.on('transcript:list', ({ roomId }) => {
    try {
      const files = fs.readdirSync(transcriptsDir).filter(f => f.startsWith(`${roomId}-`) && f.endsWith('.json'));
      files.sort();
      socket.emit('transcript:list', { roomId, files });
    } catch { socket.emit('transcript:list', { roomId, files: [] }); }
  });

  // Fetch a specific saved transcript file
  socket.on('transcript:get', ({ roomId, file }) => {
    try {
      if (!file || !file.startsWith(`${roomId}-`) || !file.endsWith('.json')) { socket.emit('transcript:get', { roomId, error: 'bad_file' }); return; }
      const fpath = path.join(transcriptsDir, file);
      const raw = fs.readFileSync(fpath, 'utf8');
      const data = JSON.parse(raw);
      socket.emit('transcript:get', { roomId, file, data });
    } catch { socket.emit('transcript:get', { roomId, file, error: 'not_found' }); }
  });

  socket.on('disconnect', () => {
    if (joinedRoom && user) {
      socket.to(joinedRoom).emit('presence:leave', user);
    }
    // Clean up any Deepgram connection for this socket
    try { if (dgConn && typeof dgConn.finish === 'function') { dgConn.finish(); } } catch {}
    dgConn = null;
  });
});

server.listen(PORT, () => {
  console.log(`socket.io server listening on http://localhost:${PORT}`);
});
 
