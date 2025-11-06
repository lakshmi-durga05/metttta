import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { io, Socket } from "socket.io-client";
export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const xrBtnRef = useRef<HTMLDivElement | null>(null);
  const [xrSupported, setXrSupported] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [camEnabled, setCamEnabled] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const userIdRef = useRef<string>(`u_${Math.random().toString(36).slice(2, 10)}`);
  const [displayName, setDisplayName] = useState<string>(`Guest-${Math.floor(Math.random()*1000)}`);
  const [roomCodeInput, setRoomCodeInput] = useState<string>("");
  const nameRef = useRef<string>("");
  const tabTagRef = useRef<string>("");
  const remoteAvatarsRef = useRef<Record<string, THREE.Object3D>>({});
  const sceneRef = useRef<THREE.Scene | null>(null);
  const remoteGroupRef = useRef<THREE.Group | null>(null);
  const [roster, setRoster] = useState<Array<{ id: string; name: string; avatar?: { kind: 'color' | 'image'; value: string } }>>([]);
  const remoteCursorsRef = useRef<Record<string, THREE.Mesh>>({});
  const xrStatusRef = useRef<string>("Checking XR...");
  const peerConnsRef = useRef<Record<string, RTCPeerConnection>>({});
  const remoteStreamsRef = useRef<Record<string, MediaStream>>({});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const remoteAudioRef = useRef<Record<string, { source: MediaStreamAudioSourceNode; panner: PannerNode }>>({});
  const remoteAudioElsRef = useRef<Record<string, HTMLAudioElement>>({});
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micLevelRafRef = useRef<number | null>(null);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [, forceRerender] = useState(0);
  const [authOpen, setAuthOpen] = useState<boolean>(false);
  const [authedUser, setAuthedUser] = useState<{ id: string; name: string; email: string; avatar: { kind: 'color' | 'image'; value: string } } | null>(null);
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [authName, setAuthName] = useState<string>("");
  const [avatarColor, setAvatarColor] = useState<string>("#4f46e5");
  const [sessionReady, setSessionReady] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<'login'|'signup'>('login');
  const avatarGallery: string[] = [
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="%234f46e5"/><circle cx="64" cy="52" r="28" fill="%23fff"/><rect x="24" y="84" width="80" height="28" rx="14" fill="%23fff"/></svg>',
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="%2310b981"/><circle cx="64" cy="50" r="26" fill="%23fef3c7"/><rect x="20" y="82" width="88" height="30" rx="15" fill="%23fef3c7"/></svg>',
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="%23f97316"/><circle cx="64" cy="50" r="26" fill="%23fff"/><rect x="20" y="82" width="88" height="30" rx="15" fill="%23fff"/></svg>'
  ];
  const [avatarImage, setAvatarImage] = useState<string>(avatarGallery[0]);
  const modelCacheRef = useRef<Record<string, { scene: THREE.Group; clips: THREE.AnimationClip[] }>>({});
  const localAvatarRef = useRef<THREE.Object3D | null>(null);
  const localMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const remoteMixersRef = useRef<Record<string, THREE.AnimationMixer>>({});
  const localActionsRef = useRef<{ idle?: THREE.AnimationAction; walk?: THREE.AnimationAction; current?: 'idle'|'walk' }>({});
  const keysRef = useRef<Record<string, boolean>>({});
  const lastEmitRef = useRef<number>(0);
  const moveTargetRef = useRef<THREE.Vector3 | null>(null);
  const micMonitorRef = useRef<{ source: MediaStreamAudioSourceNode; gain: GainNode } | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const transcriptRef = useRef<string>("");
  const [summaries, setSummaries] = useState<string[]>([]);
  const [chatOpen, setChatOpen] = useState<boolean>(true);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatLog, setChatLog] = useState<Array<{userId:string; name:string; text:string; ts:number}>>([]);
  const [meetingEnded, setMeetingEnded] = useState<boolean>(false);
  const [medMode, setMedMode] = useState<boolean>(false);
  const meetingEndedRef = useRef<boolean>(false);
  const chatSeenRef = useRef<Set<string>>(new Set());
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const [dashboardOpen, setDashboardOpen] = useState<boolean>(false);
  const [meetings, setMeetings] = useState<Array<{ id:string; roomId:string|null; ts:number; title:string; summary:string[]; transcript:string; participants:Array<{id:string; name:string}>; whiteboardImage?:string; chat:Array<{userId:string; name:string; text:string; ts:number}> }>>([]);
  const recognitionRef = useRef<any>(null);
  const [sttAvailable, setSttAvailable] = useState<boolean>(true);
  const sttManualStopRef = useRef<boolean>(false);
  const [sttStatus, setSttStatus] = useState<'idle'|'running'|'stopped'|'unsupported'|'not_joined'>('idle');
  const startRecognition = () => {
    try {
      const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) { setSttAvailable(false); setSttStatus('unsupported'); return; }
      if (!joined || meetingEnded) { setSttStatus('not_joined'); return; }
      sttManualStopRef.current = false;
      if (recognitionRef.current) { try { recognitionRef.current.start(); } catch {} return; }
      const rec: any = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = (navigator.language || 'en-US');
      let buffer = '';
      rec.onresult = (e: any) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) buffer += res[0].transcript + ' ';
          else interim += res[0].transcript;
        }
        const full = (buffer + ' ' + interim).trim();
        transcriptRef.current = full;
        setTranscript(full);
      };
      rec.onerror = (e: any) => {
        const name = (e?.error || '').toString();
        if (name.includes('not-allowed') || name.includes('service-not-allowed')) return;
        if (!sttManualStopRef.current) { try { rec.start(); } catch {} }
      };
      rec.onend = () => { if (!meetingEnded && !sttManualStopRef.current) { try { rec.start(); } catch {} } };
      try { rec.start(); } catch {}
      recognitionRef.current = rec;
      setSttStatus('running');
    } catch {}
  };
  // Whiteboard state
  const [wbOpen, setWbOpen] = useState<boolean>(false);
  const wbCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [wbColor, setWbColor] = useState<string>("#1f2937");
  const [wbSize, setWbSize] = useState<number>(4);
  const [micBusy, setMicBusy] = useState<boolean>(false);
  const [camBusy, setCamBusy] = useState<boolean>(false);
  const wbDrawingRef = useRef<boolean>(false);
  const wbPointsRef = useRef<Array<[number, number]>>([]);
  const wbCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const wbToolRef = useRef<'pencil'|'brush'|'marker'|'eraser'|'airbrush'|'fill'>('pencil');
  const wbLastEmitRef = useRef<number>(0);
  const modelUrls = [
    'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/CesiumMan/glTF-Binary/CesiumMan.glb',
    'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
    'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb'
  ];

  const modelUrlForAvatar = (val: string) => {
    const idx = Math.max(0, avatarGallery.indexOf(val));
    return modelUrls[idx % modelUrls.length];
  };
  const handleWbTouchEnd = () => {
    if (!wbDrawingRef.current) return;
    wbDrawingRef.current = false;
    const pts = wbPointsRef.current.slice();
    wbPointsRef.current = [];
    if (pts.length > 1) {
      socketRef.current?.emit('whiteboard:stroke', { color: wbColor, size: wbSize, points: pts, tool: wbToolRef.current });
    } else if (pts.length === 1) {
      const p = pts[0];
      socketRef.current?.emit('whiteboard:stroke', { color: wbColor, size: wbSize, points: [p, [p[0]+0.01, p[1]+0.01]], tool: wbToolRef.current });
    }
  };

  const loadModel = async (url: string): Promise<{ group: THREE.Group; clips: THREE.AnimationClip[] }> => {
    if (modelCacheRef.current[url]) {
      const cached = modelCacheRef.current[url];
      return { group: cached.scene.clone(true) as THREE.Group, clips: cached.clips };
    }
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      const gltf = await new Promise<any>((resolve, reject) => loader.load(url, resolve, undefined, reject));
      const scene: THREE.Group = gltf.scene || new THREE.Group();
      const clips: THREE.AnimationClip[] = gltf.animations || [];
      modelCacheRef.current[url] = { scene, clips };
      return { group: scene.clone(true) as THREE.Group, clips };
    } catch (e) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.9, 6, 12), new THREE.MeshStandardMaterial({ color: 0x22c55e }));
      body.castShadow = true;
      g.add(body);
      return { group: g, clips: [] };
    }
  };

  const lastPoseRef = useRef<Record<string, { p: [number, number, number]; r: [number, number, number] }>>({});

  useEffect(() => {
    const saved = localStorage.getItem('authUser');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setAuthedUser(parsed);
        setDisplayName(parsed.name || displayName);
      } catch {}
    }
    const session = sessionStorage.getItem('sessionAuthed');
    // Ensure a stable per-tab suffix for visible names
    let tabTag = sessionStorage.getItem('tabTag');
    if (!tabTag) { tabTag = Math.random().toString(36).slice(2,5); sessionStorage.setItem('tabTag', tabTag); }
    tabTagRef.current = tabTag;
    setSessionReady(session === '1');
    if (session !== '1') setAuthOpen(true);
    const lastRoom = sessionStorage.getItem('lastRoomId');
    if (lastRoom) {
      setRoomCodeInput(lastRoom);
      setRoomId(lastRoom);
    }
    const wasJoined = sessionStorage.getItem('joined') === '1';
    if (wasJoined) setJoined(true);
    if (!mountRef.current) return;

    const container = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f4f6);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(3, 2, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);
    // expose renderer for potential debug
    (renderer.domElement as any).__threeRenderer = renderer;

    // Skip adding VRButton; we run in non-XR by default and optionally show status only

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 7);
    dir.castShadow = true;
    scene.add(dir);

    // Simple virtual room: floor + walls
    const room = new THREE.Group();
    scene.add(room);
    const floorGeo = new THREE.PlaneGeometry(12, 12);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    room.add(floor);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5 });
    const wallGeo = new THREE.PlaneGeometry(12, 3);
    const wall1 = new THREE.Mesh(wallGeo, wallMat);
    wall1.position.set(0, 1.5, -6);
    room.add(wall1);
    const wall2 = new THREE.Mesh(wallGeo, wallMat);
    wall2.position.set(0, 1.5, 6);
    wall2.rotation.y = Math.PI;
    room.add(wall2);
    const wall3 = new THREE.Mesh(wallGeo, wallMat);
    wall3.position.set(-6, 1.5, 0);
    wall3.rotation.y = Math.PI / 2;
    room.add(wall3);
    const wall4 = new THREE.Mesh(wallGeo, wallMat);
    wall4.position.set(6, 1.5, 0);
    wall4.rotation.y = -Math.PI / 2;
    room.add(wall4);

    // Ground + Grid
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.001;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(50, 50, 0x94a3b8, 0xe2e8f0); // slate-400 / slate-200
    scene.add(grid);

    // Demo content: spinning box avatar placeholder
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x4f46e5 }) // indigo-600
    );
    box.position.set(0, 0.5, 0);
    box.castShadow = true;
    box.name = 'placeholderBox';
    scene.add(box);

    // Group to hold remote avatars
    const remoteGroup = new THREE.Group();
    scene.add(remoteGroup);
    remoteGroupRef.current = remoteGroup;

    // Orbit controls for non-XR
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.5, 0);
    controls.enableDamping = true;

    let rafId = 0;
    const onKey = (e: KeyboardEvent) => {
      if (meetingEndedRef.current) return;
      const k = (e?.key || '').toLowerCase();  
      if (!k) return;
      // Do not capture movement keys when typing in form fields
      const target = e.target as HTMLElement | null;
      const isEditable = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        (target as HTMLElement).isContentEditable ||
        (typeof (target as any).closest === 'function' && !!(target as any).closest('input, textarea, [contenteditable="true"], [contenteditable]'))
      );
      if (isEditable) return;
      const down = e.type === 'keydown';
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) {
        keysRef.current[k] = down;
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    const onResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", onResize);

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const dt = clock.getDelta();
      if (localMixerRef.current) localMixerRef.current.update(dt);
      Object.values(remoteMixersRef.current).forEach((m) => m.update(dt));
      // Local avatar movement (WASD)
      const av = localAvatarRef.current;
      if (av) {
        if (!meetingEnded) {
          let vx = 0, vz = 0;
          const k = keysRef.current;
          if (k['w'] || k['arrowup']) vz -= 1;
          if (k['s'] || k['arrowdown']) vz += 1;
          if (k['a'] || k['arrowleft']) vx -= 1;
          if (k['d'] || k['arrowright']) vx += 1;
          // Click-to-move: steer toward target
          if (moveTargetRef.current) {
            const dx = moveTargetRef.current.x - av.position.x;
            const dz = moveTargetRef.current.z - av.position.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 0.02) { vx += dx / dist; vz += dz / dist; } else { moveTargetRef.current = null; }
          }
          if (vx !== 0 || vz !== 0) {
            const len = Math.hypot(vx, vz) || 1;
            vx /= len; vz /= len;
            const speed = 1.5; // m/s
            av.position.x += vx * speed * dt;
            av.position.z += vz * speed * dt;
            // animation blend
            const acts = localActionsRef.current;
            if (acts.walk && acts.current !== 'walk') {
              acts.idle?.crossFadeTo(acts.walk, 0.25, false);
              acts.walk.play();
              acts.current = 'walk';
            }
          } else {
            const acts = localActionsRef.current;
            if (acts.idle && acts.current !== 'idle') {
              acts.walk?.crossFadeTo(acts.idle, 0.25, false);
              acts.idle.play();
              acts.current = 'idle';
            }
          }
          // emit pose at 10 Hz
          const now = performance.now();
          if (socketRef.current && now - lastEmitRef.current > 100) {
            lastEmitRef.current = now;
            const r = new THREE.Euler().copy(av.rotation);
            const p: [number, number, number] = [av.position.x, av.position.y, av.position.z];
            const rot: [number, number, number] = [r.x, r.y, r.z];
            socketRef.current.emit('avatar:pose', { userId: userIdRef.current, p, r: rot });
          }
        } else {
          moveTargetRef.current = null;
        }
      }
      controls.update();
      renderer.render(scene, camera);
    });

    // Socket listeners are now attached in the room socket effect

    // Detect XR support with retries (helps when emulator extension initializes late)
    let checks = 0;
    const checkXr = () => {
      if ((navigator as any).xr?.isSessionSupported) {
        (navigator as any).xr
          .isSessionSupported("immersive-vr")
          .then((supported: boolean) => setXrSupported(supported))
          .catch(() => setXrSupported(false));
      }
      if (checks++ < 10) setTimeout(checkXr, 1000);
    };
    checkXr();
    xrStatusRef.current = 'XR check running';

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      renderer.setAnimationLoop(null as never);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  // Ensure a 3D avatar is loaded for the local user by default
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (localAvatarRef.current) return;
    const selected = authedUser?.avatar?.value || avatarImage;
    const url = modelUrlForAvatar(selected);
    (async () => {
      const { group: obj, clips } = await loadModel(url);
      obj.traverse((o) => { (o as any).castShadow = true; });
      scene.add(obj);
      localAvatarRef.current = obj;
      if (clips && clips.length) {
        localMixerRef.current = new THREE.AnimationMixer(obj);
        const idle = clips[0];
        const walk = clips[1];
        const idleAct = localMixerRef.current.clipAction(idle);
        idleAct.play();
        const walkAct = walk ? localMixerRef.current.clipAction(walk) : undefined;
        localActionsRef.current = { idle: idleAct, walk: walkAct, current: 'idle' };
      }
      const placeholder = scene.getObjectByName('placeholderBox');
      if (placeholder) placeholder.visible = false;
    })();
  }, [authedUser, avatarImage]);

  // Socket.io: join room and sync avatar pose
  useEffect(() => {
    if (!roomId || !joined) return;
    const socket = io("http://localhost:3001", { transports: ["websocket"], withCredentials: false });
    socketRef.current = socket;
    // Per-tab tag to avoid identical visible names across tabs
    const baseName = nameRef.current || displayName;
    const nameToUse = `${baseName}-${tabTagRef.current || ''}`;
    const avatar = authedUser?.avatar || { kind: 'image', value: avatarGallery[0] };
    socket.emit("room:join", { roomId, userId: userIdRef.current, name: nameToUse, avatar });
    // Ensure new joiners sync the current whiteboard state immediately
    socket.emit('whiteboard:requestState');

    socket.on("presence:roster", (members: Array<{ id: string; name: string; avatar?: { kind: 'color' | 'image'; value: string } }>) => {
      setRoster(members);
      members.forEach((m: { id: string; name: string }) => maybeStartPeer(m.id));
    });
    socket.on("presence:join", (user: any) => {
      setRoster((prev: Array<{ id: string; name: string; avatar?: { kind: 'color' | 'image'; value: string } }>) => {
        const exists = prev.some((m: { id: string; name: string }) => m.id === user.id);
        return exists ? prev : [...prev, user];
      });
      maybeStartPeer(user.id);
    });
    socket.on("presence:update", (user: { id: string; name: string; avatar?: { kind: 'color' | 'image'; value: string } }) => {
      setRoster((prev: Array<{ id: string; name: string; avatar?: { kind: 'color' | 'image'; value: string } }>) =>
        prev.map((m) => (m.id === user.id ? { ...m, avatar: user.avatar, name: user.name } : m))
      );
      if (user.id === userIdRef.current) {
        // Update own profile but do not create a remote avatar for self
        setAuthedUser((prevU) => (prevU ? { ...prevU, avatar: user.avatar || prevU.avatar } : prevU));
        // If an accidental remote avatar for self exists, remove it
        const selfRemote = remoteAvatarsRef.current[user.id];
        if (selfRemote && selfRemote.parent) selfRemote.parent.remove(selfRemote);
        delete remoteAvatarsRef.current[user.id];
        if (remoteMixersRef.current[user.id]) delete remoteMixersRef.current[user.id];
        return;
      }
      const group = remoteGroupRef.current;
      const scene = sceneRef.current;
      if (!group || !scene) return;
      const existing = remoteAvatarsRef.current[user.id];
      if (existing && existing.parent) existing.parent.remove(existing);
      delete remoteAvatarsRef.current[user.id];
      if (remoteMixersRef.current[user.id]) delete remoteMixersRef.current[user.id];
      const url = user?.avatar?.kind === 'image' ? modelUrlForAvatar(user.avatar.value) : modelUrls[0];
      (async () => {
        const { group: obj, clips } = await loadModel(url);
        obj.traverse((o) => { (o as any).castShadow = true; });
        remoteAvatarsRef.current[user.id] = obj;
        group.add(obj);
        if (clips && clips.length) {
          const mixer = new THREE.AnimationMixer(obj);
          remoteMixersRef.current[user.id] = mixer;
          const idle = clips[0];
          mixer.clipAction(idle).play();
        }
        const last = lastPoseRef.current[user.id];
        if (last) {
          obj.position.set(last.p[0], last.p[1], last.p[2]);
          obj.rotation.set(last.r[0], last.r[1], last.r[2]);
        }
      })();
    });
    socket.on("presence:leave", (user: any) => {
      const mesh = remoteAvatarsRef.current[user.id];
      if (mesh && mesh.parent) mesh.parent.remove(mesh);
      delete remoteAvatarsRef.current[user.id];
      setRoster((prev: Array<{ id: string; name: string }>) => prev.filter((m: { id: string; name: string }) => m.id !== user.id));
      teardownPeer(user.id);
    });

    // handle remote avatar poses
    socket.on("avatar:pose", (data: { userId: string; p: [number, number, number]; r: [number, number, number]; }) => {
      if (data.userId === userIdRef.current) return; // never render self as remote
      const scene = sceneRef.current;
      const group = remoteGroupRef.current;
      if (!scene || !group) return;
      const { userId, p, r } = data;
      let mesh = remoteAvatarsRef.current[userId];
      if (!mesh) {
        const member = roster.find((m) => m.id === userId);
        const url = member?.avatar?.kind === 'image' ? modelUrlForAvatar(member.avatar.value) : modelUrls[0];
        (async () => {
          const { group: obj, clips } = await loadModel(url);
          obj.traverse((o) => { (o as any).castShadow = true; });
          remoteAvatarsRef.current[userId] = obj;
          group.add(obj);
          if (clips && clips.length) {
            const mixer = new THREE.AnimationMixer(obj);
            remoteMixersRef.current[userId] = mixer;
            mixer.clipAction(clips[0]).play();
          }
          obj.position.set(p[0], p[1], p[2]);
          obj.rotation.set(r[0], r[1], r[2]);
        })();
        return;
      }
      mesh.position.set(p[0], p[1], p[2]);
      mesh.rotation.set(r[0], r[1], r[2]);
      lastPoseRef.current[userId] = { p, r };
      const audio = remoteAudioRef.current[userId];
      if (audio) audio.panner.positionX.value = p[0], audio.panner.positionY.value = p[1], audio.panner.positionZ.value = p[2];
    });

    // remote cursor positions
    socket.on("cursor:pos", (data: { userId: string; p: [number, number, number]; }) => {
      const scene = sceneRef.current;
      if (!scene) return;
      let cursor = remoteCursorsRef.current[data.userId];
      if (!cursor) {
        cursor = new THREE.Mesh(
          new THREE.SphereGeometry(0.06, 16, 16),
          new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 0.5 })
        );
        remoteCursorsRef.current[data.userId] = cursor;
        scene.add(cursor);
      }
      cursor.position.set(data.p[0], data.p[1], data.p[2]);
    });

    // Whiteboard + Chat listeners (registered after connection)
    socket.on('whiteboard:stroke', (s: { color: string; size: number; points: Array<[number,number]>; tool?: string }) => {
      if (meetingEndedRef.current) return;
      drawStrokeOnCanvas(s);
    });
    socket.on('whiteboard:clear', () => {
      if (meetingEndedRef.current) return;
      clearWhiteboardCanvas();
    });
    socket.on('whiteboard:fill', (act: { x:number; y:number; color:string }) => {
      if (meetingEndedRef.current) return;
      floodFillAt(Math.floor(act.x), Math.floor(act.y), act.color);
    });
    socket.on('whiteboard:state', (state: { actions: Array<any> } ) => {
      if (meetingEndedRef.current) return;
      clearWhiteboardCanvas();
      for (const act of (state.actions || [])) {
        if (act.type === 'stroke') drawStrokeOnCanvas(act);
        if (act.type === 'fill') floodFillAt(Math.floor(act.x), Math.floor(act.y), act.color);
      }
    });
    socket.on('chat:message', (msg: {userId:string; name:string; text:string; ts:number; cid?: string}) => {
      if (meetingEndedRef.current) return;
      if (msg.cid) {
        if (chatSeenRef.current.has(msg.cid)) return;
        chatSeenRef.current.add(msg.cid);
      }
      setChatLog((prev) => [...prev, msg]);
    });

    const interval = setInterval(() => {
      if (meetingEndedRef.current) return;
      if (!localAvatarRef.current) return;
      const p: [number, number, number] = [localAvatarRef.current.position.x, localAvatarRef.current.position.y, localAvatarRef.current.position.z];
      const r: [number, number, number] = [localAvatarRef.current.rotation.x, localAvatarRef.current.rotation.y, localAvatarRef.current.rotation.z];
      socket.emit('avatar:pose', { userId: userIdRef.current, p, r });
    }, 100);

    socket.on("webrtc:signal", async ({ from, data }: any) => {
      if (!from || from === userIdRef.current) return;
      const pc = await ensurePeer(from);
      try {
        if (data?.type === "offer") {
          const offerCollision = pc.signalingState !== "stable";
          const polite = userIdRef.current > from; // deterministic tie-breaker
          if (offerCollision) {
            if (!polite) return; // ignore non-polite collisions
            await pc.setLocalDescription({ type: "rollback" } as any);
          }
          await pc.setRemoteDescription(new RTCSessionDescription(data));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("webrtc:signal", { to: from, from: userIdRef.current, data: pc.localDescription });
        } else if (data?.type === "answer") {
          if (pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
          }
        } else if (data?.candidate) {
          try { await pc.addIceCandidate(new RTCIceCandidate(data)); } catch {}
        }
      } catch {}
    });

    return () => {
      clearInterval(interval);
      socketRef.current?.off('whiteboard:stroke');
      socketRef.current?.off('whiteboard:clear');
      socketRef.current?.off('whiteboard:state');
      socketRef.current?.off('whiteboard:fill');
      socketRef.current?.off('chat:message');
      socketRef.current?.disconnect();
    };
  }, [roomId, joined, authedUser]);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    const el = chatListRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatLog, chatOpen]);

  useEffect(() => { loadMeetings(); }, []);
  useEffect(() => { meetingEndedRef.current = meetingEnded; }, [meetingEnded]);

  const nameForUserId = (uid: string): string => {
    if (uid === userIdRef.current) return authedUser?.name || displayName;
    const m = roster.find(r => r.id === uid);
    return m?.name || 'Guest';
  };

  const avatarForUserId = (uid: string): string => {
    if (uid === userIdRef.current) return authedUser?.avatar?.value || avatarGallery[0];
    const m = roster.find(r => r.id === uid);
    return m?.avatar?.value || avatarGallery[0];
  };

  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const buildSummary = (fullTranscript: string, chatArr: Array<{userId:string; name:string; text:string; ts:number}>) => {
    const txt = (fullTranscript || '').trim();
    const chatText = (chatArr || []).map(m=>`${m.name}: ${m.text}`).join(' ');
    const all = `${txt} ${chatText}`.trim();
    if (!all) return ["No transcript captured."];
    const sents = all.split(/(?<=\.|\?|!)\s+/).map(s=>s.trim()).filter(Boolean);
    const stop = new Set(["the","is","a","an","and","or","to","of","in","on","for","with","that","this","it","as","at","by","be","we","you","they","i","are","was","were","from","our","your","their","will","can","should","could","would","about","into","over","after","before","than","then","so","if","but","not","no","yes","do","does","did"]);
    const freq: Record<string, number> = {};
    for (const w of all.toLowerCase().match(/\b[\p{L}0-9']+\b/gu) || []) { if (!stop.has(w) && w.length>2) freq[w]=(freq[w]||0)+1; }
    const scoreSent = (s: string) => { let sc=0; for (const w of s.toLowerCase().match(/\b[\p{L}0-9']+\b/gu) || []) { if (freq[w]) sc+=freq[w]; } return sc; };
    const scored = sents.map((s,i)=>({i,s,sc:scoreSent(s)})).sort((a,b)=>b.sc-a.sc).slice(0,8).sort((a,b)=>a.i-b.i).map(o=>o.s);
    const lowerAll = all.toLowerCase();
    const acts: string[] = [];
    for (const line of (txt+"\n"+chatText).split(/\n|\.|\?|!/)) {
      const l=line.trim(); if(!l) continue;
      if (/\b(will|todo|to do|next|follow up|assign|ownership|deadline|deliver|prepare|send|share)\b/i.test(l)) acts.push(l);
    }
    const decs: string[] = [];
    for (const line of (txt+"\n"+chatText).split(/\n|\.|\?|!/)) {
      const l=line.trim(); if(!l) continue;
      if (/\b(decide|decided|agree|agreed|approved|choose|chose|select|selected)\b/i.test(l)) decs.push(l);
    }
    const out: string[] = [];
    if (scored.length) out.push(`Overview: ${scored.slice(0,3).join(' ')}`);
    if (scored.length>3) { for (const s of scored.slice(3)) out.push(`Key: ${s}`); }
    if (decs.length) { out.push('Decisions:'); for (const d of decs.slice(0,6)) out.push(`- ${d}`); }
    if (acts.length) { out.push('Action items:'); for (const a of acts.slice(0,8)) out.push(`- ${a}`); }
    return out.length ? out : ["No notable content detected."];
  };

  useEffect(() => {
    let recognition: any = null;
    let stopRequested = false;
    const SpeechRecognition: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setSttAvailable(false); setSttStatus('unsupported'); return; }
    if (!joined || meetingEnded) { setSttStatus('not_joined'); return; }
    if (sttManualStopRef.current) { setSttStatus('stopped'); return; }
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = (navigator.language || 'en-US');
    let recent = '';
    recognition.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const txt = (res[0]?.transcript || '').trim();
          if (txt) {
            transcriptRef.current = ((transcriptRef.current || '') + ' ' + txt).trim();
            recent = (recent + ' ' + txt).trim();
          }
        } else {
          interim += res[0].transcript;
        }
      }
      const display = ((transcriptRef.current || '') + (interim ? (' ' + interim) : '')).trim();
      setTranscript(display);
    };
    recognition.onerror = (e: any) => {
      const name = (e?.error || '').toString();
      // Do not spin if user explicitly blocked
      if (name.includes('not-allowed') || name.includes('service-not-allowed')) return;
      if (!stopRequested && !sttManualStopRef.current) setTimeout(() => { try { recognition.start(); } catch {} }, 1200);
    };
    recognition.onaudioend = () => { if (!stopRequested && !sttManualStopRef.current) { try { recognition.start(); } catch {} } };
    recognition.onsoundend = () => { if (!stopRequested && !sttManualStopRef.current) { try { recognition.start(); } catch {} } };
    recognition.onend = () => {
      if (!stopRequested && !sttManualStopRef.current) try { recognition.start(); } catch {}
    };
    try { recognition.start(); setSttStatus('running'); } catch {}
    recognitionRef.current = recognition;
    const summarizer = setInterval(() => {
      if (!recent) return;
      const text = recent.trim();
      const words = text.split(/\s+/);
      const last = words.slice(-40).join(' ');
      const summary = last.length > 0 ? `Recent: ${last}` : '';
      if (summary) setSummaries((prev) => [...prev, summary].slice(-20));
      recent = '';
    }, 10000);
    return () => {
      stopRequested = true;
      clearInterval(summarizer);
      try { recognition.stop(); } catch {}
      recognitionRef.current = null;
      if (!sttManualStopRef.current && joined && !meetingEnded && sttAvailable) setSttStatus('idle');
    };
  }, [joined, meetingEnded, sttAvailable]);

  // Keep STT status in sync with session/support changes
  useEffect(() => {
    if (!sttAvailable) { setSttStatus('unsupported'); return; }
    if (!joined || meetingEnded) { setSttStatus('not_joined'); return; }
    if (sttManualStopRef.current) { setSttStatus('stopped'); return; }
    if (!recognitionRef.current) { setSttStatus('idle'); return; }
  }, [joined, meetingEnded, sttAvailable]);

  const loadMeetings = () => {
    try {
      const raw = localStorage.getItem('meetings') || '[]';
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) setMeetings(arr);
    } catch {}
  };

  const saveMeeting = (payload: { summary?: string[]; transcript: string; whiteboardImage?: string }) => {
    const participants = [{ id: userIdRef.current, name: authedUser?.name || displayName }, ...roster.map(r=>({ id: r.id, name: r.name }))]
      .filter((v,i,a)=> a.findIndex(x=>x.id===v.id)===i);
    const finalSummary = (payload.summary && payload.summary.length)
      ? payload.summary
      : buildSummary(payload.transcript || '', chatLog);
    const meeting = {
      id: `m_${Date.now()}`,
      roomId,
      ts: Date.now(),
      title: `Room ${roomId || ''} — ${new Date().toLocaleString()}`.trim(),
      summary: finalSummary,
      transcript: payload.transcript,
      participants,
      whiteboardImage: payload.whiteboardImage,
      chat: chatLog.slice(-500)
    };
    try {
      const raw = localStorage.getItem('meetings') || '[]';
      const arr = JSON.parse(raw);
      const next = Array.isArray(arr) ? [...arr, meeting] : [meeting];
      localStorage.setItem('meetings', JSON.stringify(next));
      setMeetings(next);
    } catch {
      localStorage.setItem('meetings', JSON.stringify([meeting]));
      setMeetings([meeting]);
    }
  };

  // Render remote avatars in the scene
  useEffect(() => {
    // This effect taps into the three scene by creating/looking up a marker object attached to mountRef
    if (!mountRef.current) return;
    const container = mountRef.current;
    const canvas = container.querySelector('canvas');
    if (!canvas) return;

    // @ts-ignore - retrieve renderer from canvas
    const renderer: THREE.WebGLRenderer | undefined = (canvas as any).__threeRenderer;
    // We didn't store it earlier, so we attach a hidden property when creating it. Let's ensure we do that in init.
  }, []);

  const maybeStartPeer = async (peerId: string) => {
    if (peerConnsRef.current[peerId]) return;
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] }
      ]
    });
    peerConnsRef.current[peerId] = pc;
    pc.onicecandidate = (e: RTCPeerConnectionIceEvent) => {
      if (!e.candidate) return;
      socketRef.current?.emit("webrtc:signal", { to: peerId, from: userIdRef.current, data: e.candidate });
    };
    pc.ontrack = (e: RTCTrackEvent) => {
      if (!e.streams[0]) return;
      remoteStreamsRef.current[peerId] = e.streams[0];
      forceRerender((prev: number) => prev + 1);
      try {
        let audioEl = remoteAudioElsRef.current[peerId];
        if (!audioEl) { audioEl = new Audio(); remoteAudioElsRef.current[peerId] = audioEl; }
        audioEl.autoplay = true; (audioEl as any).playsInline = true;
        if (audioEl.srcObject !== e.streams[0]) audioEl.srcObject = e.streams[0];
        audioEl.volume = 1.0; audioEl.muted = false;
        audioEl.play().catch(()=>{});
      } catch {}
    };
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => pc.addTrack(track, mediaStreamRef.current as MediaStream));
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit("webrtc:signal", { to: peerId, from: userIdRef.current, data: pc.localDescription });
  };

  const teardownPeer = (peerId: string) => {
    const pc = peerConnsRef.current[peerId];
    if (!pc) return;
    pc.close();
    delete peerConnsRef.current[peerId];
    delete remoteStreamsRef.current[peerId];
    const a = remoteAudioElsRef.current[peerId];
    if (a) { try { a.srcObject = null as any; a.remove(); } catch {} delete remoteAudioElsRef.current[peerId]; }
    forceRerender((prev: number) => prev + 1);
  };

  const ensurePeer = async (peerId: string) => {
    if (peerConnsRef.current[peerId]) return peerConnsRef.current[peerId];
    await maybeStartPeer(peerId);
    return peerConnsRef.current[peerId];
  };

  const resumeAllRemoteAudio = async () => {
    try { if (audioCtxRef.current && audioCtxRef.current.state !== 'running') await audioCtxRef.current.resume(); } catch {}
    try {
      const els = Object.values(remoteAudioElsRef.current);
      for (const a of els) { try { await a.play(); } catch {} }
    } catch {}
  };

  // Media helpers used by Settings toggles
  const ensureMediaIfNeeded = async () => {
    if (mediaStreamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      mediaStreamRef.current = stream;
      if (!audioCtxRef.current) {
        try {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        } catch {}
      }
      // Attempt to resume context on a user gesture
      try { if (audioCtxRef.current && audioCtxRef.current.state !== 'running') await audioCtxRef.current.resume(); } catch {}
      // Local mic monitor (echo to user when mic enabled)
      try {
        if (audioCtxRef.current && stream.getAudioTracks()[0]) {
          const src = audioCtxRef.current.createMediaStreamSource(stream);
          const gain = audioCtxRef.current.createGain();
          gain.gain.value = 0.0; // start muted until toggled on
          src.connect(gain).connect(audioCtxRef.current.destination);
          micMonitorRef.current = { source: src, gain };
          // Create analyser for mic level meter
          const analyser = audioCtxRef.current.createAnalyser();
          analyser.fftSize = 256;
          micAnalyserRef.current = analyser;
          try { src.connect(analyser); } catch {}
          // start update loop (will show ~0 until mic unmuted)
          const data = new Uint8Array(analyser.frequencyBinCount);
          const loop = () => {
            try { analyser.getByteTimeDomainData(data); } catch {}
            // RMS of waveform
            let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v*v; }
            const rms = Math.sqrt(sum / data.length);
            setMicLevel(Math.min(1, rms * 2));
            micLevelRafRef.current = requestAnimationFrame(loop);
          };
          micLevelRafRef.current = requestAnimationFrame(loop);
        }
      } catch {
        // If WebAudio fails, continue without local monitor
        micMonitorRef.current = null;
      }
    } catch (e) {
      setErrorMsg('Failed to access media devices');
    }
  };

  const replaceAudioTrackForAll = async (track: MediaStreamTrack | null) => {
    const conns = peerConnsRef.current;
    for (const pid of Object.keys(conns)) {
      const pc = conns[pid];
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
      if (sender) {
        try { await sender.replaceTrack(track as any); } catch {}
      }
    }
  };

  const replaceVideoTrackForAll = async (track: MediaStreamTrack | null) => {
    const conns = peerConnsRef.current;
    for (const pid of Object.keys(conns)) {
      const pc = conns[pid];
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) {
        try { await sender.replaceTrack(track as any); } catch {}
      }
    }
  };

  // Whiteboard functions (component scope)
  const setupWhiteboardCanvas = () => {
    const canvas = wbCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    wbCtxRef.current = ctx;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
  };

  const clearWhiteboardCanvas = () => {
    const canvas = wbCanvasRef.current;
    if (!canvas) return;
    const ctx = wbCtxRef.current || canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
  };

  const drawStrokeOnCanvas = (s: { color: string; size: number; points: Array<[number, number]>; tool?: string; }) => {
    const canvas = wbCanvasRef.current;
    if (!canvas) return;
    const ctx = wbCtxRef.current || canvas.getContext('2d');
    if (!ctx || s.points.length === 0) return;
    const tool = s.tool || 'pencil';
    if (tool === 'airbrush') {
      const density = 12;
      ctx.fillStyle = s.color;
      for (const [x,y] of s.points) {
        for (let i=0;i<density;i++) {
          const r = s.size * (Math.random()*0.5);
          const ang = Math.random()*Math.PI*2;
          ctx.globalAlpha = 0.15;
          ctx.beginPath();
          ctx.arc(x + Math.cos(ang)*r, y + Math.sin(ang)*r, 1.2, 0, Math.PI*2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1.0;
      return;
    }
    const color = tool==='eraser' ? '#ffffff' : s.color;
    ctx.strokeStyle = color;
    ctx.lineWidth = tool==='brush' || tool==='marker' ? Math.max(6, s.size) : s.size;
    ctx.beginPath();
    const [x0, y0] = s.points[0];
    ctx.moveTo(x0, y0);
    for (let i = 1; i < s.points.length; i++) {
      const [x, y] = s.points[i];
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  const pointerToCanvasXY = (canvas: HTMLCanvasElement, clientX: number, clientY: number): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    return [x, y];
  };

  const handleWbPointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (meetingEnded) return;
    const canvas = wbCanvasRef.current; if (!canvas) return;
    if (wbToolRef.current === 'fill') {
      const [x,y] = pointerToCanvasXY(canvas, e.clientX, e.clientY);
      floodFillAt(Math.floor(x), Math.floor(y), wbColor);
      socketRef.current?.emit('whiteboard:fill', { color: wbColor, x: Math.floor(x), y: Math.floor(y) });
      return;
    }
    wbDrawingRef.current = true; wbPointsRef.current = [];
    const [x, y] = pointerToCanvasXY(canvas, e.clientX, e.clientY);
    wbPointsRef.current.push([x, y]);
  };
  const handleWbPointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (meetingEnded) return;
    if (!wbDrawingRef.current) return;
    const canvas = wbCanvasRef.current; if (!canvas) return;
    const [x, y] = pointerToCanvasXY(canvas, e.clientX, e.clientY);
    const last = wbPointsRef.current[wbPointsRef.current.length - 1];
    wbPointsRef.current.push([x, y]);
    const seg = { color: wbColor, size: wbSize, points: [last, [x, y]] as any, tool: wbToolRef.current };
    drawStrokeOnCanvas(seg);
    const now = performance.now();
    if (now - wbLastEmitRef.current > 30) {
      wbLastEmitRef.current = now;
      socketRef.current?.emit('whiteboard:stroke', seg);
    }
  };
  const handleWbPointerUp = () => {
    if (meetingEnded) return;
    if (!wbDrawingRef.current) return;
    wbDrawingRef.current = false;
    const pts = wbPointsRef.current.slice();
    wbPointsRef.current = [];
    if (pts.length > 1) {
      socketRef.current?.emit('whiteboard:stroke', { color: wbColor, size: wbSize, points: pts, tool: wbToolRef.current });
    } else if (pts.length === 1) {
      // Emit a tiny dot to reflect a click without movement
      const p = pts[0];
      socketRef.current?.emit('whiteboard:stroke', { color: wbColor, size: wbSize, points: [p, [p[0]+0.01, p[1]+0.01]], tool: wbToolRef.current });
    }
  };
  const handleWbTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (meetingEnded) return;
    const t = e.touches[0]; if (!t) return; e.preventDefault();
    const canvas = wbCanvasRef.current; if (!canvas) return;
    if (wbToolRef.current === 'fill') {
      const [x,y] = pointerToCanvasXY(canvas, t.clientX, t.clientY);
      floodFillAt(Math.floor(x), Math.floor(y), wbColor);
      socketRef.current?.emit('whiteboard:fill', { color: wbColor, x: Math.floor(x), y: Math.floor(y) });
      return;
    }
    wbDrawingRef.current = true; wbPointsRef.current = [];
    const [x, y] = pointerToCanvasXY(canvas, t.clientX, t.clientY);
    wbPointsRef.current.push([x, y]);
  };
  const handleWbTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (meetingEnded) return;
    const t = e.touches[0]; if (!t || !wbDrawingRef.current) return; e.preventDefault();
    const canvas = wbCanvasRef.current; if (!canvas) return;
    const [x, y] = pointerToCanvasXY(canvas, t.clientX, t.clientY);
    const last = wbPointsRef.current[wbPointsRef.current.length - 1];
    wbPointsRef.current.push([x, y]);
    const seg = { color: wbColor, size: wbSize, points: [last, [x, y]] as any, tool: wbToolRef.current };
    drawStrokeOnCanvas(seg);
    const now = performance.now();
    if (now - wbLastEmitRef.current > 30) {
      wbLastEmitRef.current = now;
      socketRef.current?.emit('whiteboard:stroke', seg);
    }
  };

  const floodFillAt = (sx: number, sy: number, colorHex: string) => {
    const canvas = wbCanvasRef.current; if (!canvas) return;
    const ctx = wbCtxRef.current || canvas.getContext('2d'); if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const img = ctx.getImageData(0, 0, rect.width, rect.height);
    const data = img.data; const w = img.width, h = img.height;
    const idx = (x:number,y:number)=> (y*w + x)*4;
    const target = idx(sx, sy);
    const r0=data[target], g0=data[target+1], b0=data[target+2], a0=data[target+3];
    const hexToRgb = (hex:string)=>{ const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)!; return {r:parseInt(m[1],16),g:parseInt(m[2],16),b:parseInt(m[3],16)}; };
    const {r, g, b} = hexToRgb(colorHex);
    if (r0===r && g0===g && b0===b) return;
    const q: Array<[number,number]> = [[sx,sy]];
    while(q.length){
      const [x,y]=q.pop()!; const i=idx(x,y);
      if (x<0||y<0||x>=w||y>=h) continue;
      if (data[i]===r && data[i+1]===g && data[i+2]===b) continue;
      if (data[i]!==r0 || data[i+1]!==g0 || data[i+2]!==b0 || data[i+3]!==a0) continue;
      data[i]=r; data[i+1]=g; data[i+2]=b; data[i+3]=255;
      q.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    ctx.putImageData(img, 0, 0);
  };


  return (
    <div className="min-h-screen flex flex-col bg-[#0A0A0A] text-[#F1F1F1]">
      <header className="border-b border-[#2A2A2A] bg-[#3D2C8D]">
        <div className="container-page h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-white/90 shadow-sm" />
            <span className="font-semibold tracking-wide text-white">Metaverse Collaboration</span>
            {roomId && (
              <span className="ml-2 text-xs px-2 py-1 rounded bg-[#3D2C8D] text-white">
                Room: {roomId}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              className="input w-44 bg-[#1E1E1E] text-[#F1F1F1] placeholder:text-[#A0A0A0] border border-[#2A2A2A]"
              placeholder="Your name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <input
              className="input w-44 bg-[#1E1E1E] text-[#F1F1F1] placeholder:text-[#A0A0A0] border border-[#2A2A2A]"
              placeholder="Room code"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value)}
            />
            <button
              className="btn-secondary hover:brightness-110 bg-[#3D2C8D] hover:bg-[#7A00FF] text-white"
              onClick={() => {
                const code = roomCodeInput.trim();
                if (code) setRoomId(code);
                if (code) sessionStorage.setItem('lastRoomId', code);
              }}
            >
              Use Code
            </button>
            <button
              className="btn-secondary hover:brightness-110 bg-[#3D2C8D] hover:bg-[#7A00FF] text-white"
              onClick={() => {
                const code = "room-" + Math.random().toString(36).slice(2, 8);
                setRoomId(code);
                setRoomCodeInput(code);
                sessionStorage.setItem('lastRoomId', code);
              }}
            >
              Create Room
            </button>
            <button
              className="btn-secondary hover:brightness-110 bg-[#3D2C8D] hover:bg-[#7A00FF] text-white"
              onClick={() => { loadMeetings(); setDashboardOpen(true); }}
            >
              Dashboard
            </button>
            <button
              className="btn-primary shadow-sm hover:shadow-md bg-[#3D2C8D] hover:bg-[#7A00FF] text-white"
              onClick={async () => {
                setErrorMsg(null);
                try {
                  // Ensure room code exists
                  let code = roomId || roomCodeInput.trim();
                  if (!code) {
                    code = "room-" + Math.random().toString(36).slice(2, 8);
                    setRoomId(code);
                    setRoomCodeInput(code);
                    sessionStorage.setItem('lastRoomId', code);
                  }
                  // Ensure an identity (guest if not authed)
                  let user = authedUser;
                  if (!user) {
                    user = { id: userIdRef.current, name: displayName || `Guest-${Math.floor(Math.random()*1000)}`, email: "guest@local", avatar: { kind: 'image' as const, value: avatarImage } };
                    setAuthedUser(user);
                    sessionStorage.setItem('sessionAuthed', '1');
                  }
                  if (!joined) {
                    // Try audio+video, then audio-only, then none
                    let stream: MediaStream | null = null;
                    try {
                      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                      setMicEnabled(true);
                      setCamEnabled(true);
                    } catch {
                      try {
                        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                        setMicEnabled(true);
                        setCamEnabled(false);
                      } catch {
                        stream = null;
                        setMicEnabled(false);
                        setCamEnabled(false);
                      }
                    }
                    mediaStreamRef.current = stream;
                    if (videoRef.current && stream) {
                      videoRef.current.srcObject = stream;
                      await videoRef.current.play().catch(() => {});
                    }
                    nameRef.current = displayName;
                    setMeetingEnded(false);
                    setJoined(true);
                    sessionStorage.setItem('joined', '1');
                    // Ensure local avatar exists
                    const selected = (user?.avatar?.value) || avatarImage;
                    const url = modelUrlForAvatar(selected);
                    const { group: obj, clips } = await loadModel(url);
                    obj.traverse((o) => { (o as any).castShadow = true; });
                    localAvatarRef.current = obj;
                    const scene = sceneRef.current;
                    if (scene) scene.add(obj);
                    if (clips && clips.length) {
                      localMixerRef.current = new THREE.AnimationMixer(obj);
                      const idle = clips[0];
                      const walk = clips[1];
                      const idleAct = localMixerRef.current.clipAction(idle);
                      idleAct.play();
                      const walkAct = walk ? localMixerRef.current.clipAction(walk) : undefined;
                      localActionsRef.current = { idle: idleAct, walk: walkAct, current: 'idle' };
                    }
                    // After a user gesture, try resuming any remote audio
                    setTimeout(() => { resumeAllRemoteAudio(); }, 300);
                  }
                } catch (err: any) {
                  setErrorMsg(err?.message ?? "Failed to access media devices");
                }
              }}
              disabled={joined}
            >
              {joined ? "Joined" : "Join"}
            </button>
            {authedUser && (
              <div className="ml-2 inline-flex items-center gap-2 text-sm">
                <img src={authedUser.avatar?.value || avatarGallery[0]} className="h-6 w-6 rounded-full object-cover" />
                <span className="text-white">{authedUser.name}</span>
                <button className="btn-ghost text-white hover:bg-white/10" onClick={() => { sessionStorage.removeItem('sessionAuthed'); setSessionReady(false); setJoined(false); }}>Logout</button>
                <button className="btn-ghost text-white hover:bg-white/10" onClick={() => { localStorage.removeItem('authUser'); sessionStorage.removeItem('sessionAuthed'); setAuthedUser(null); setSessionReady(false); setAuthMode('login'); }}>Switch</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-12 gap-4 container-page py-4">
        <aside className="col-span-3 hidden md:block">
          <div className="card shadow-sm bg-[#1E1E1E] border border-[#2A2A2A]">
            <div className="card-body">
              <h3 className="text-[#F1F1F1] font-semibold tracking-wide">Roster</h3>
              {roster.length === 0 ? (
                <p className="text-sm text-[#A0A0A0]">Participants will appear here.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  <li key="self" className="text-indigo-700 flex items-center gap-2">
                    <img src={authedUser?.avatar?.value || avatarGallery[0]} className="h-4 w-4 rounded-full object-cover" />
                    You: {`${displayName}-${tabTagRef.current || ''}`}
                  </li>
                  {roster.map((m) => (
                    <li key={m.id} className="flex items-center gap-2">
                      <img src={m.avatar?.value || avatarGallery[0]} className="h-4 w-4 rounded-full object-cover" />
                      {m.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="card mt-4 shadow-sm bg-[#1E1E1E] border border-[#2A2A2A]">
            <div className="card-body">
              <h3 className="text-[#F1F1F1] font-semibold tracking-wide">Tools</h3>
              <ul className="mt-2 space-y-2 text-sm">
                <li>
                  <button className="btn-primary w-full shadow-sm hover:shadow bg-[#3D2C8D] hover:bg-[#7A00FF] text-white" disabled={meetingEnded} onClick={() => {
                    if (meetingEnded) return;
                    setWbOpen((v)=>!v);
                    setTimeout(setupWhiteboardCanvas, 50);
                    if (socketRef.current) socketRef.current.emit('whiteboard:requestState');
                  }}>{wbOpen? 'Hide Whiteboard':'Open Whiteboard'}</button>
                </li>
                <li>
                  <button className="btn-primary w-full shadow-sm hover:shadow bg-[#3D2C8D] hover:bg-[#7A00FF] text-white" disabled={meetingEnded} onClick={() => { if (meetingEnded) return; setChatOpen((v)=>!v);} }>{chatOpen? 'Hide Chat':'Open Chat'}</button>
                </li>
                <li className="text-[#F1F1F1]">Documents</li>
                <li className="text-[#F1F1F1]">Assets</li>
              </ul>
            </div>
          </div>
          {wbOpen && (
            <div className="card mt-4 shadow-sm bg-[#1E1E1E] border border-[#2A2A2A]">
              <div className="card-body">
                <div className="flex items-center justify-between">
                  <h3 className="text-[#F1F1F1] font-semibold tracking-wide">Whiteboard</h3>
                  <div className="flex items-center gap-2">
                    <select className="input focus:ring-2 focus:ring-[#7A00FF] bg-[#1E1E1E] border border-[#2A2A2A] text-[#F1F1F1]" onChange={(e)=>{ wbToolRef.current = e.target.value as any; }}>
                      <option value="pencil">Pencil</option>
                      <option value="brush">Brush</option>
                      <option value="marker">Marker</option>
                      <option value="airbrush">Airbrush</option>
                      <option value="eraser">Eraser</option>
                      <option value="fill">Fill</option>
                    </select>
                    <input type="color" value={wbColor} onChange={(e)=>setWbColor(e.target.value)} className="h-9 w-10 rounded" />
                    <input type="range" min={1} max={24} value={wbSize} onChange={(e)=>setWbSize(parseInt(e.target.value))} className="accent-[#7A00FF]" />
                    <button className="btn-ghost hover:bg-white/5" onClick={() => {
                      clearWhiteboardCanvas();
                      socketRef.current?.emit('whiteboard:clear');
                    }} disabled={meetingEnded}>Clear</button>
                  </div>
                </div>
                <div className="mt-2 border border-[#2A2A2A] rounded-md overflow-hidden">
                  <canvas ref={wbCanvasRef} className="w-full h-72 touch-none select-none bg-white" 
                    onMouseDown={(e)=>handleWbPointerDown(e)}
                    onMouseMove={(e)=>handleWbPointerMove(e)}
                    onMouseUp={()=>handleWbPointerUp()}
                    onMouseLeave={()=>handleWbPointerUp()}
                    onTouchStart={(e)=>handleWbTouchStart(e)}
                    onTouchMove={(e)=>handleWbTouchMove(e)}
                    onTouchEnd={()=>handleWbTouchEnd()}
                  />
                </div>
                <p className="text-xs text-[#A0A0A0] mt-2">Tip: choose color/size, draw together in real-time.</p>
              </div>
            </div>
          )}
        </aside>

        <section className="col-span-12 md:col-span-6">
          <div className="card overflow-hidden shadow-sm bg-[#1E1E1E] border border-[#2A2A2A]">
            <div className="relative">
              <div
                ref={mountRef}
                className="h-[60vh] w-full"
                onMouseMove={(e) => {
                  if (meetingEnded) return;
                  if (!socketRef.current) return;
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                  const scene = sceneRef.current;
                  if (!scene) return;
                  const camera = scene.children.find((c) => (c as any).isCamera) as THREE.PerspectiveCamera | undefined;
                  if (!camera) return;
                  const ray = new THREE.Raycaster();
                  ray.setFromCamera(new THREE.Vector2(x, y), camera);
                  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
                  const point = new THREE.Vector3();
                  ray.ray.intersectPlane(plane, point);
                  socketRef.current.emit("cursor:pos", { userId: userIdRef.current, p: [point.x, 0.05, point.z] });
                }}
                onClick={(e) => {
                  if (meetingEnded) return;
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                  const scene = sceneRef.current;
                  if (!scene) return;
                  const camera = scene.children.find((c) => (c as any).isCamera) as THREE.PerspectiveCamera | undefined;
                  if (!camera) return;
                  const ray = new THREE.Raycaster();
                  ray.setFromCamera(new THREE.Vector2(x, y), camera);
                  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
                  const point = new THREE.Vector3();
                  ray.ray.intersectPlane(plane, point);
                  moveTargetRef.current = point.clone();
                }}
              />
              {/* XR UI removed */}
            </div>
          </div>
          {/* XR helper text removed */}
          {errorMsg && (
            <p className="text-sm text-red-600 mt-1">{errorMsg}</p>
          )}
          <div className="mt-4 card shadow-sm bg-[#1E1E1E] border border-[#2A2A2A]">
            <div className="card-body">
              <h3 className="text-[#F1F1F1] font-semibold tracking-wide">Participants Video</h3>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-3">
                {!meetingEnded && camEnabled && mediaStreamRef.current && (
                  <div className="relative">
                    <video className="w-full aspect-video rounded-lg bg-black" muted playsInline autoPlay ref={(el: HTMLVideoElement | null) => { if (el && el.srcObject !== mediaStreamRef.current) el.srcObject = mediaStreamRef.current; }} />
                    <div className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">You</div>
                  </div>
                )}
                {!meetingEnded && (Object.entries(remoteStreamsRef.current) as [string, MediaStream][]).map(([peerId, stream]) => (
                  <div key={peerId} className="relative">
                    <video className="w-full aspect-video rounded-lg bg-black" autoPlay playsInline ref={(el: HTMLVideoElement | null) => { if (el && el.srcObject !== stream) el.srcObject = stream; try { (el as any).muted = false; } catch {} }} />
                    <div className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">{nameForUserId(peerId)}</div>
                  </div>
                ))}
                {meetingEnded && (
                  <div className="col-span-2 md:col-span-3 text-center text-sm text-[#A0A0A0] py-6 bg-[#121212] rounded-md border border-[#2A2A2A]">Meeting ended</div>
                )}
              </div>
            </div>
          </div>
          {chatOpen && (
            <div className="mt-4 card shadow-sm bg-[#1E1E1E] border border-[#2A2A2A]">
              <div className="card-body">
                <div className="flex items-center justify-between">
                  <h3 className="text-[#F1F1F1] font-semibold tracking-wide">Chat</h3>
                  <div className="flex items-center gap-2">
                    <label className="text-xs">Medical Mode</label>
                    <button
                      className={`btn-secondary text-xs ${medMode ? 'bg-[#2A2A2A] ring-1 ring-[#7A00FF]' : 'bg-[#2A2A2A]'} text-[#F1F1F1]`}
                      onClick={() => {
                        setMedMode((v)=>{
                          const next = !v;
                          if (next && !chatInput.trim()) {
                            setChatInput('Discuss a drug: indications, mechanism of action, dosage, side effects, interactions, contraindications.');
                          }
                          return next;
                        });
                      }}
                    >{medMode ? 'ON' : 'OFF'}</button>
                  </div>
                </div>
                <div className="mt-2 border border-[#2A2A2A] rounded p-2 bg-[#111111]">
                  {chatLog.length === 0 ? (
                    <p className="text-xs text-[#A0A0A0]">No messages yet.</p>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {chatLog.slice(-200).map((m,i)=> {
                        const isSelf = m.userId === userIdRef.current;
                        return (
                          <li key={m.ts+':'+i} className={`flex items-end ${isSelf ? 'justify-end' : 'justify-start'}`}>
                            {!isSelf && (
                              <img src={avatarForUserId(m.userId)} className="h-6 w-6 rounded-full object-cover mr-2" />
                            )}
                            <div className={`${isSelf ? 'bg-[#3D2C8D] text-white' : 'bg-[#2A2A2A] text-[#F1F1F1]'} rounded-2xl px-3 py-2 max-w-[75%] shadow-sm`}> 
                              {!isSelf && <div className="text-[10px] text-[#A0A0A0] mb-0.5">{nameForUserId(m.userId)}</div>}
                              <div className="whitespace-pre-wrap break-words">{m.text}</div>
                              <div className={`text-[10px] mt-0.5 ${isSelf ? 'text-white/70' : 'text-[#A0A0A0]'}`}>{formatTime(m.ts)}</div>
                            </div>
                            {isSelf && (
                              <img src={avatarForUserId(m.userId)} className="h-6 w-6 rounded-full object-cover ml-2" />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    className="input flex-1 bg-[#1E1E1E] text-[#F1F1F1] placeholder:text-[#A0A0A0] border border-[#2A2A2A]"
                    placeholder="Type a message"
                    value={chatInput}
                    onChange={(e)=>{ if (meetingEnded) return; setChatInput(e.target.value);} }
                    disabled={meetingEnded}
                    onKeyDown={(e)=>{
                      if(meetingEnded) return;
                      if(e.key==='Enter') {
                        const raw = chatInput.trim();
                        if (!raw) return;
                        const text = medMode ? `[MED] ${raw}` : raw;
                        const cid = `${userIdRef.current}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
                        chatSeenRef.current.add(cid);
                        setChatLog(prev => [...prev, { userId: userIdRef.current, name: authedUser?.name || displayName, text, ts: Date.now() }]);
                        socketRef.current?.emit('chat:message', { text, cid });
                        setChatInput('');
                      }
                    }}
                  />
                  <button
                    className="btn-primary shadow-sm hover:shadow bg-[#3D2C8D] hover:bg-[#7A00FF]"
                    onClick={()=>{
                      if (meetingEnded) return;
                      const raw = chatInput.trim();
                      if (!raw) return;
                      const text = medMode ? `[MED] ${raw}` : raw;
                      const cid = `${userIdRef.current}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
                      chatSeenRef.current.add(cid);
                      setChatLog(prev => [...prev, { userId: userIdRef.current, name: authedUser?.name || displayName, text, ts: Date.now() }]);
                      socketRef.current?.emit('chat:message', { text, cid });
                      setChatInput('');
                    }}
                    disabled={meetingEnded}
                  >Send</button>
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="col-span-12 md:col-span-3">
          {/* Timeline with End Meeting */}
          <div className="card shadow-sm bg-[#1E1E1E] border border-[#2A2A2A]">
            <div className="card-body">
              <h3 className="text-[#F1F1F1] font-semibold tracking-wide">Timeline</h3>
              <p className="text-sm text-[#A0A0A0]">Meeting summary (after End Meeting).</p>
              {summaries.length === 0 ? (
                <p className="text-xs text-[#A0A0A0] mt-2">No summary yet.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-xs">
                  {summaries.slice(-6).map((s, i) => (<li key={i} className="text-[#F1F1F1]">• {s}</li>))}
                </ul>
              )}
              <div className="mt-3 flex gap-2">
                <button className="btn-primary w-full shadow-sm hover:shadow bg-[#3D2C8D] hover:bg-[#7A00FF]" onClick={async () => {
                  setMeetingEnded(true);
                  const full = (transcriptRef.current || transcript || '').trim();
                  const bullets = buildSummary(full, chatLog);
                  setSummaries(bullets);
                  const whiteboardImage = (() => { const c = wbCanvasRef.current; try { return c ? c.toDataURL('image/png') : undefined; } catch { return undefined; } })();
                  try { recognitionRef.current?.stop?.(); } catch {}
                  if (mediaStreamRef.current) {
                    try { await replaceVideoTrackForAll(null); } catch {}
                    try { await replaceAudioTrackForAll(null); } catch {}
                    mediaStreamRef.current.getTracks().forEach(t=>{ try { t.stop(); } catch {} });
                    mediaStreamRef.current = null;
                  }
                  setCamEnabled(false); setMicEnabled(false);
                  saveMeeting({ summary: bullets, transcript: (transcriptRef.current || transcript || '').trim(), whiteboardImage });
                  sessionStorage.setItem('joined', '0');
                  setJoined(false);
                }}>End Meeting</button>
              </div>
            </div>
          </div>
          <div className="card mt-4 shadow-sm bg-[#1E1E1E] border border-[#2A2A2A]">
            <div className="card-body">
              <h3 className="text-[#F1F1F1] font-semibold tracking-wide">Settings</h3>
              <div className="mt-2 space-y-2">
                <button
                  className={`${micEnabled ? 'bg-[#7A00FF] text-white hover:bg-[#6a00e6]' : 'bg-[#2A2A2A] text-[#F1F1F1] hover:bg-[#333333]'} w-full rounded-md px-3 py-2 transition-colors disabled:bg-[#2A2A2A] disabled:text-[#F1F1F1] disabled:opacity-60 disabled:cursor-not-allowed`}
                  disabled={meetingEnded || micBusy}
                  onClick={async () => {
                    if (meetingEnded || micBusy) return;
                    setMicBusy(true);
                    try {
                      await ensureMediaIfNeeded();
                      let st = mediaStreamRef.current;
                      if (!st) {
                        try {
                          st = await navigator.mediaDevices.getUserMedia({ audio: true });
                          mediaStreamRef.current = st;
                        } catch { setErrorMsg('Cannot access microphone'); return; }
                      }
                      let a = st.getAudioTracks()[0];
                      if (!a) {
                        try {
                          const anew = (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0];
                          st.addTrack(anew);
                          a = anew;
                        } catch { setErrorMsg('Cannot start microphone'); return; }
                      }
                      if (a.enabled) {
                        await replaceAudioTrackForAll(null);
                        a.enabled = false;
                        if (micMonitorRef.current) micMonitorRef.current.gain.gain.value = 0.0;
                        if (micLevelRafRef.current) { cancelAnimationFrame(micLevelRafRef.current); micLevelRafRef.current = null; }
                        setMicLevel(0);
                        setMicEnabled(false);
                      } else {
                        if (a.readyState === 'ended') {
                          try {
                            const anew = (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0];
                            st.addTrack(anew);
                            await replaceAudioTrackForAll(anew);
                            a = anew;
                          } catch { setErrorMsg('Cannot start microphone'); return; }
                        } else {
                          await replaceAudioTrackForAll(a);
                        }
                        a.enabled = true;
                        try {
                          if (!audioCtxRef.current || (audioCtxRef.current as any).state === 'closed') {
                            audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                          }
                          if (audioCtxRef.current.state !== 'running') await audioCtxRef.current.resume();
                          if (!micMonitorRef.current) {
                            try {
                              const src = audioCtxRef.current.createMediaStreamSource(st);
                              const gain = audioCtxRef.current.createGain();
                              gain.gain.value = 0.0;
                              src.connect(gain).connect(audioCtxRef.current.destination);
                              micMonitorRef.current = { source: src, gain };
                            } catch {}
                          }
                          // ensure analyser exists and loop runs
                          if (!micAnalyserRef.current) {
                            try {
                              const analyser = audioCtxRef.current.createAnalyser();
                              analyser.fftSize = 256; micAnalyserRef.current = analyser;
                              micMonitorRef.current?.source.connect(analyser);
                            } catch {}
                          }
                          if (!micLevelRafRef.current && micAnalyserRef.current) {
                            const analyser = micAnalyserRef.current; const data = new Uint8Array(analyser.frequencyBinCount);
                            const loop = () => {
                              try { analyser.getByteTimeDomainData(data); } catch {}
                              let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v*v; }
                              const rms = Math.sqrt(sum / data.length);
                              setMicLevel(Math.min(1, rms * 2));
                              micLevelRafRef.current = requestAnimationFrame(loop);
                            };
                            micLevelRafRef.current = requestAnimationFrame(loop);
                          }
                        } catch {}
                        if (micMonitorRef.current) micMonitorRef.current.gain.gain.value = 1.0;
                        setMicEnabled(true);
                        // ensure remote audio resumes after user gesture
                        resumeAllRemoteAudio();
                      }
                    } finally {
                      setMicBusy(false);
                    }
                  }}
                >
                  {micEnabled ? "Mute Mic" : "Unmute Mic"}
                </button>
                <button
                  className={`${camEnabled ? 'bg-[#7A00FF] text-white hover:bg-[#6a00e6]' : 'bg-[#2A2A2A] text-[#F1F1F1] hover:bg-[#333333]'} w-full rounded-md px-3 py-2 transition-colors disabled:bg-[#2A2A2A] disabled:text-[#F1F1F1] disabled:opacity-60 disabled:cursor-not-allowed`}
                  disabled={meetingEnded || camBusy}
                  onClick={async () => {
                    if (meetingEnded || camBusy) return;
                    setCamBusy(true);
                    try {
                      await ensureMediaIfNeeded();
                      let st = mediaStreamRef.current;
                      if (!st) {
                        try {
                          st = await navigator.mediaDevices.getUserMedia({ video: true });
                          mediaStreamRef.current = st;
                        } catch { setErrorMsg('Cannot access camera'); return; }
                      }
                      let vtrack = st.getVideoTracks()[0];
                      if (camEnabled && vtrack) {
                        await replaceVideoTrackForAll(null);
                        vtrack.stop();
                        st.removeTrack(vtrack);
                        setCamEnabled(false);
                        if (videoRef.current) videoRef.current.srcObject = st;
                      } else if (!camEnabled) {
                        try {
                          if (!vtrack || vtrack.readyState === 'ended') {
                            const v = await navigator.mediaDevices.getUserMedia({ video: true });
                            const newTrack = v.getVideoTracks()[0];
                            st.addTrack(newTrack);
                            await replaceVideoTrackForAll(newTrack);
                          } else {
                            await replaceVideoTrackForAll(vtrack);
                          }
                          if (videoRef.current) videoRef.current.srcObject = st;
                          setCamEnabled(true);
                          // ensure remote audio resumes after user gesture
                          resumeAllRemoteAudio();
                        } catch { setErrorMsg('Cannot start camera'); }
                      }
                    } finally {
                      setCamBusy(false);
                    }
                  }}
                >
                  {camEnabled ? "Turn Camera Off" : "Turn Camera On"}
                </button>
                <div className="mt-2">
                  <div className="text-xs text-[#A0A0A0] mb-1">Mic Level</div>
                  <div className="h-2 w-full rounded bg-[#2A2A2A] overflow-hidden">
                    <div className="h-full bg-[#7A00FF] transition-[width] duration-100" style={{ width: `${Math.round(micLevel*100)}%` }} />
                  </div>
                </div>
                <div className="mt-2 h-40 bg-[#111111] rounded-md flex items-center justify-center ring-1 ring-[#2A2A2A]">
                  <video ref={videoRef} className="h-full" muted playsInline autoPlay />
                </div>
                <div className="mt-3">
                  <div className="text-sm mb-1">Quick Avatar</div>
                  <div className="grid grid-cols-5 gap-2">
                    {avatarGallery.map((src) => (
                      <button key={src} className={`rounded-lg p-1 ring-2 ${avatarImage===src? 'ring-[#7A00FF] shadow-sm':'ring-transparent'} bg-[#2A2A2A] hover:bg-[#333333]`} onClick={() => setAvatarImage(src)}>
                        <img src={src} className="h-12 w-12 rounded-md object-cover" />
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-end gap-2 mt-2">
                    <button className="btn-secondary hover:brightness-110 bg-[#2A2A2A] text-[#F1F1F1]" onClick={() => setAvatarImage(avatarGallery[0])}>Reset</button>
                    <button className="btn-primary shadow-sm hover:shadow bg-[#3D2C8D] hover:bg-[#7A00FF]" onClick={async () => {
                      if (!authedUser) return;
                      const updated = { ...authedUser, avatar: { kind: 'image' as const, value: avatarImage } };
                      setAuthedUser(updated);
                      const accounts = JSON.parse(localStorage.getItem('accounts') || '[]');
                      const idx = accounts.findIndex((a: any) => a.email === updated.email);
                      if (idx >= 0) { accounts[idx] = { ...accounts[idx], avatar: updated.avatar }; localStorage.setItem('accounts', JSON.stringify(accounts)); }
                      localStorage.setItem('authUser', JSON.stringify(updated));
                      socketRef.current?.emit('avatar:update', { avatar: updated.avatar });
                      setRoster((prev) => prev.map((m) => (m.id === userIdRef.current ? { ...m, avatar: updated.avatar } : m)));
                      const scene = sceneRef.current;
                      if (scene && localAvatarRef.current) { scene.remove(localAvatarRef.current); localAvatarRef.current = null; }
                      const url = modelUrlForAvatar(updated.avatar.value);
                      const { group: obj, clips } = await loadModel(url);
                      if (scene) { scene.add(obj); localAvatarRef.current = obj; }
                      if (clips && clips.length) {
                        localMixerRef.current = new THREE.AnimationMixer(obj);
                        const idle = clips[0];
                        const walk = clips[1];
                        const idleAct = localMixerRef.current.clipAction(idle);
                        idleAct.play();
                        const walkAct = walk ? localMixerRef.current.clipAction(walk) : undefined;
                        localActionsRef.current = { idle: idleAct, walk: walkAct, current: 'idle' };
                      }
                    }}>Save Avatar</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* Transcript Preview (below Settings) */}
          <div className="card mt-4 shadow-sm bg-[#1E1E1E] border border-[#2A2A2A]">
            <div className="card-body">
              <h3 className="text-[#F1F1F1] font-semibold tracking-wide">Transcript Preview</h3>
              <div className="mt-2 h-40 overflow-y-auto border border-[#2A2A2A] rounded p-2 bg-[#111111] text-sm whitespace-pre-wrap text-[#F1F1F1]">
                {transcript?.trim() ? transcript : 'Speak to start capturing transcript...'}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="text-xs text-[#A0A0A0]">
                  {sttStatus === 'unsupported' && 'Speech Recognition not supported in this browser.'}
                  {sttStatus === 'not_joined' && 'Join a room to start transcription.'}
                  {sttStatus === 'idle' && 'Click Start if transcript does not begin automatically.'}
                  {sttStatus === 'running' && 'Listening… speak to transcribe.'}
                  {sttStatus === 'stopped' && 'Transcription stopped. Press Start to resume.'}
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-secondary bg-[#2A2A2A] text-[#F1F1F1] hover:bg-[#333333] disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={sttStatus === 'unsupported' || !joined || meetingEnded}
                    aria-disabled={sttStatus === 'unsupported' || !joined || meetingEnded}
                    onClick={() => startRecognition()}
                  >Start</button>
                  <button
                    className="btn-ghost hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={sttStatus !== 'running'}
                    aria-disabled={sttStatus !== 'running'}
                    onClick={() => { sttManualStopRef.current = true; setSttStatus('stopped'); try { recognitionRef.current?.stop?.(); } catch {} }}
                  >Stop</button>
                  <button
                    className="btn-ghost hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!transcript?.trim()}
                    aria-disabled={!transcript?.trim()}
                    onClick={() => { transcriptRef.current = ''; setTranscript(''); }}
                  >Clear</button>
                  <button
                    className="btn-ghost hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!transcript?.trim()}
                    aria-disabled={!transcript?.trim()}
                    onClick={() => {
                      const title = `Transcript_${roomId || 'room'}_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}`;
                      const text = [
                        `Title: ${title}`,
                        `When: ${new Date().toLocaleString()}`,
                        `Room: ${roomId || '-'}`,
                        '',
                        'Transcript:',
                        (transcriptRef.current || transcript || '').trim() || '(empty)'
                      ].join('\n');
                      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = `${title}.txt`;
                      a.click(); URL.revokeObjectURL(url);
                    }}
                  >Save</button>
                  <button className="btn-ghost hover:bg-white/5" onClick={() => { navigator.clipboard?.writeText(transcript || ''); }}>Copy</button>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </main>

      <footer className="border-t border-[#2A2A2A] bg-[#0A0A0A]">
        <div className="container-page h-12 flex items-center justify-between text-sm text-[#A0A0A0]">
          <span>Three.js + WebXR scaffold</span>
          <span>Vite + React + Tailwind</span>
        </div>
      </footer>

      {!sessionReady && (
        <div className="fixed inset-0 flex items-center justify-center p-0">
          <div className="absolute inset-0 bg-gradient-to-br from-[#3D2C8D] via-[#5B3FD9] to-[#7A00FF] opacity-80" />
          <div className="relative w-full max-w-md mx-auto">
            <div className="card rounded-2xl shadow-2xl backdrop-blur bg-[#1E1E1E] border border-[#2A2A2A]">
              <div className="card-body">
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-bold tracking-tight">{authMode === 'login' ? 'Login' : 'Sign Up'}</h3>
                  <div className="text-sm">
                    {authMode === 'login' ? (
                      <button className="btn-ghost hover:bg-white/5" onClick={() => setAuthMode('signup')}>Create account</button>
                    ) : (
                      <button className="btn-ghost hover:bg-white/5" onClick={() => setAuthMode('login')}>Have an account? Login</button>
                    )}
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <input className="input bg-[#0F0F0F] border border-[#2A2A2A] text-[#F1F1F1] placeholder:text-[#A0A0A0] focus:ring-2 focus:ring-[#7A00FF] focus:border-[#7A00FF]" placeholder="Email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} />
                  <input className="input bg-[#0F0F0F] border border-[#2A2A2A] text-[#F1F1F1] placeholder:text-[#A0A0A0] focus:ring-2 focus:ring-[#7A00FF] focus:border-[#7A00FF]" placeholder="Password" type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} />
                  <input className="input bg-[#0F0F0F] border border-[#2A2A2A] text-[#F1F1F1] placeholder:text-[#A0A0A0] focus:ring-2 focus:ring-[#7A00FF] focus:border-[#7A00FF]" placeholder="Display name" value={authName} onChange={(e) => setAuthName(e.target.value)} />
                  <div>
                    <div className="text-sm mb-1 text-[#A0A0A0]">Choose avatar</div>
                    <div className="grid grid-cols-5 gap-2">
                      {avatarGallery.map((src) => (
                        <button key={src} className={`rounded-lg p-1 ring-2 transition-all ${avatarImage===src? 'ring-[#7A00FF] shadow-md':'ring-transparent'} bg-[#2A2A2A] hover:bg-[#333333]`} onClick={() => setAvatarImage(src)}>
                          <img src={src} className="h-12 w-12 rounded-md object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                  {authMode === 'signup' && (
                    <button className="btn-primary w-full shadow-sm hover:shadow bg-[#3D2C8D] hover:bg-[#7A00FF]" onClick={() => {
                      const accounts = JSON.parse(localStorage.getItem('accounts') || '[]');
                      const exists = accounts.find((a: any) => a.email === authEmail);
                      if (exists) { setErrorMsg('Account already exists'); return; }
                      const profile = { id: `u_${Math.random().toString(36).slice(2,10)}`, name: authName || 'User', email: authEmail, password: authPassword, avatar: { kind: 'image' as const, value: avatarImage } };
                      accounts.push(profile);
                      localStorage.setItem('accounts', JSON.stringify(accounts));
                      setErrorMsg(null);
                      setAuthMode('login');
                    }}>Create Account</button>
                  )}
                  {authMode === 'login' && (
                    <button className="btn-primary w-full shadow-sm hover:shadow bg-[#3D2C8D] hover:bg-[#7A00FF]" onClick={() => {
                      const accounts = JSON.parse(localStorage.getItem('accounts') || '[]');
                      const found = accounts.find((a: any) => a.email === authEmail && a.password === authPassword);
                      if (!found) { setErrorMsg('Invalid credentials'); return; }
                      found.name = authName || found.name;
                      if (avatarImage) found.avatar = { kind: 'image', value: avatarImage };
                      localStorage.setItem('accounts', JSON.stringify(accounts));
                      localStorage.setItem('authUser', JSON.stringify(found));
                      setAuthedUser(found);
                      setDisplayName(found.name);
                      sessionStorage.setItem('sessionAuthed','1');
                      setSessionReady(true);
                      setAuthOpen(false);
                      setErrorMsg(null);
                    }}>Login</button>
                  )}
                  {errorMsg && <div className="text-sm text-red-400">{errorMsg}</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {dashboardOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDashboardOpen(false)} />
          <div className="relative w-full max-w-4xl mx-auto">
            <div className="card rounded-2xl shadow-2xl backdrop-blur bg-[#1E1E1E] border border-[#2A2A2A]">
              <div className="card-body">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold text-[#F1F1F1]">Meeting Dashboard</h3>
                  <button className="btn-ghost hover:bg-white/5" onClick={() => setDashboardOpen(false)}>Close</button>
                </div>
                {meetings.length === 0 ? (
                  <p className="text-sm text-[#A0A0A0] mt-2">No past meetings yet.</p>
                ) : (
                  <div className="mt-3 space-y-3 max-h-[70vh] overflow-y-auto">
                    {meetings.slice().reverse().map((m) => (
                      <div key={m.id} className="border border-[#2A2A2A] rounded-lg p-3 bg-[#111111] shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-medium">{m.title}</div>
                            <div className="text-xs text-[#A0A0A0]">{new Date(m.ts).toLocaleString()} · Room {m.roomId || '-'}</div>
                            <div className="text-xs text-[#A0A0A0]">Participants: {m.participants.map(p=>p.name).join(', ') || '—'}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              className="btn-secondary hover:brightness-110 bg-[#3D2C8D] hover:bg-[#7A00FF] text-white"
                              onClick={() => {
                                const text = [
                                  `Title: ${m.title}`,
                                  `When: ${new Date(m.ts).toLocaleString()}`,
                                  `Room: ${m.roomId || '-'}`,
                                  `Participants: ${m.participants.map(p=>p.name).join(', ')}`,
                                  '',
                                  'Summary:',
                                  ...(m.summary||[]).map(s=>`- ${s}`),
                                  '',
                                  'Transcript:',
                                  m.transcript || '(empty)'
                                ].join('\n');
                                const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url; a.download = `${m.title.replace(/[^a-z0-9_\- ]/gi,'_')}.txt`;
                                a.click(); URL.revokeObjectURL(url);
                              }}
                            >Download Notes</button>
                            {m.whiteboardImage && (
                              <a className="btn-secondary hover:brightness-110 bg-[#3D2C8D] hover:bg-[#7A00FF] text-white" href={m.whiteboardImage} download={`whiteboard_${m.id}.png`}>Download Whiteboard</a>
                            )}
                          </div>
                        </div>
                        {(() => {
                          const display = (m.summary && m.summary.length > 0)
                            ? m.summary
                            : buildSummary(m.transcript || '', m.chat || []);
                          return display && display.length > 0 ? (
                            <ul className="mt-2 list-disc list-inside text-sm text-[#F1F1F1]">
                              {display.slice(-6).map((s,i)=>(<li key={i}>{s}</li>))}
                            </ul>
                          ) : null;
                        })()}
                        {m.chat && m.chat.length>0 && (
                          <div className="mt-2 text-xs text-[#A0A0A0]">
                            Recent chat: {m.chat.slice(-5).map(c=>c.name+': '+c.text).join(' · ')}
                          </div>
                        )}
                        {m.whiteboardImage && (
                          <div className="mt-2">
                            <img src={m.whiteboardImage} alt="Whiteboard snapshot" className="max-h-48 rounded border border-[#2A2A2A]" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Whiteboard helpers (component scope)
function getCanvasCtx(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  if (!canvas) return null;
  return canvas.getContext('2d');
}