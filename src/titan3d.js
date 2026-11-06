// 蒸氣巨神 (machine 4, dev/MACHINE4.md): the colossus's head, the cabinet's 3D gimmick. three.js r128
// (loaded by the shell from cdnjs only for this machine), built from primitives in code: brass face plates
// on hinges, angry eye slits, a crown of gears, a furnace core behind the face. It is drawn only while it
// moves, and at IDLE_FPS while it rests (steam, turning gears); paused behind the hall.
//   PK.Titan3D.mount(canvas, { rest: {y, s}, down: {y, s} }) -> false without WebGL
//   drop() open() up() turn() eye("blue"|"green"|"red"|"gold"|"rainbow") pause(on)
(function () {
  "use strict";
  const PK = (window.PK = window.PK || {});
  let api = null;
  function mount(cv, o) {
  o = o || {};
  if (!window.THREE || !cv) return false;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: "low-power" }); } catch (e) { return false; }
  const stats = { fps: 0, busy: false };
  let paused = false;
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));   // perf rule: ≤ 1.5
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  cam.position.set(0, 0, 9.5); cam.lookAt(0, 0, 0);

  // reflections: a small warm room made into an environment map (no files)
  (function env() {
    const es = new THREE.Scene(), g = new THREE.SphereGeometry(20, 32, 16), cols = [], c = new THREE.Color();
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 20;
      c.setRGB(0.05 + 0.9 * Math.max(0, y) ** 1.5, 0.04 + 0.62 * Math.max(0, y) ** 1.5, 0.03 + 0.35 * Math.max(0, y) ** 1.5);
      if (y < 0) c.setRGB(0.04 + 0.08 * (1 + y), 0.035 + 0.05 * (1 + y), 0.03 + 0.03 * (1 + y));
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    es.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const lamp = (x, y, z, s, col) => { const m = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 8), new THREE.MeshBasicMaterial({ color: col })); m.position.set(x, y, z); es.add(m); };
    lamp(-8, 9, 6, 2.2, 0xfff1d0); lamp(9, 4, 8, 1.6, 0xffb24a); lamp(0, -2, -12, 2.5, 0x6a8aa8);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(es, 0.04).texture;
    pm.dispose();
  })();

  const M = {
    brass: new THREE.MeshStandardMaterial({ color: 0xc8963c, metalness: 0.92, roughness: 0.32 }),
    brassD: new THREE.MeshStandardMaterial({ color: 0x8a6428, metalness: 0.9, roughness: 0.45 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xb0603a, metalness: 0.9, roughness: 0.38 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x24272b, metalness: 0.7, roughness: 0.62 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.6, roughness: 0.7 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0x2a7aff, emissiveIntensity: 1.1, metalness: 0, roughness: 0.3, toneMapped: false }),
    core: new THREE.MeshStandardMaterial({ color: 0x220a00, emissive: 0xff8a1a, emissiveIntensity: 0.4, metalness: 0, roughness: 0.6 }),
  };
  scene.add(new THREE.HemisphereLight(0xfff0d8, 0x1a1410, 0.35));
  const key = new THREE.DirectionalLight(0xffe2b0, 1.3); key.position.set(-1, 4, 7); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9ab8d8, 0.9); rim.position.set(4, 2, -5); scene.add(rim);
  const furnace = new THREE.PointLight(0xff8a1a, 0, 6, 2); furnace.position.set(0, -0.2, 0.9);

  // ---- the head (a pivot at the neck; parts in local units, about 2.8 wide and 3.2 tall)
  const head = new THREE.Group(), pivot = new THREE.Group();
  pivot.add(head); scene.add(pivot);
  const add = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); (parent || head).add(m); return m; };
  const shape = (pts) => { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; };
  const extrude = (pts, depth, bevel) => new THREE.ExtrudeGeometry(shape(pts), { depth, bevelEnabled: !!bevel, bevelThickness: bevel || 0, bevelSize: bevel || 0, bevelSegments: 2, curveSegments: 4 });
  // The AI-painted face (the user: the primitive head looked too plain), cut down its seam into two
  // halves (dev/make_titan_face.py) on hinged planes that swing open like doors; behind them the
  // AI-painted furnace (titan_core.jpg) and a crown of gears turning behind the whole head.
  const base = o.base || "assets/titan_", loader = new THREE.TextureLoader();
  const tex = (f) => { const t = loader.load(base + f, () => kick(0.3)); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t; };
  const crown = new THREE.Group(); head.add(crown); crown.position.set(0, 0.15, -0.9);
  add(new THREE.TorusGeometry(2.05, 0.11, 10, 64), M.copper, 0, 0, 0, crown);
  for (let i = 0; i < 30; i++) { const t = add(new THREE.BoxGeometry(0.2, 0.28, 0.16), M.copper, 0, 0, 0, crown); const a = (i / 30) * Math.PI * 2; t.position.set(Math.cos(a) * 2.22, Math.sin(a) * 2.22, 0); t.rotation.z = a; }
  for (let i = 0; i < 6; i++) { const sp = add(new THREE.BoxGeometry(0.08, 4.0, 0.06), M.brassD, 0, 0, -0.05, crown); sp.rotation.z = (i / 6) * Math.PI; }
  // the furnace inside: a dark bowl and the painted core, glowing up when the face opens
  add(new THREE.CircleGeometry(1.8, 48), M.dark, 0, 0, -0.35);
  const coreMat = new THREE.MeshBasicMaterial({ map: tex("core.jpg"), color: 0x555555 });
  const gear = add(new THREE.CircleGeometry(1.6, 48), coreMat, 0, 0.05, -0.3);   // turns slowly (named gear: draw() spins it)
  const coreG = new THREE.Group(); head.add(coreG); coreG.add(furnace); furnace.position.set(0, 0, 0.6);
  // the two halves of the face (each 1.9 x 3.8 units: the picture's halves are 400 x 800), hinged at
  // their outer edges; a dark back so the inside of an open door is not the face mirrored
  const plates = [], eyeGlow = [];
  const glowTex = (function () {
    const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    const gr = g.createRadialGradient(32, 32, 1, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.3, "rgba(255,255,255,0.45)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  const PW = 1.9, PH = 3.8, EYE_X = 0.437, EYE_Y = 0.081;   // eye centres from the picture (395 and 630 of 1024 across, 490 down)
  for (const sx of [-1, 1]) {
    const map = tex(sx < 0 ? "face_l.png" : "face_r.png");
    const hinge = new THREE.Group(); head.add(hinge); hinge.position.set(sx * PW, 0, 0.05);
    const front = add(new THREE.PlaneGeometry(PW, PH), new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.35, metalness: 0.15, roughness: 0.6 }), -sx * PW / 2, 0, 0, hinge);
    const back = add(new THREE.PlaneGeometry(PW, PH), new THREE.MeshStandardMaterial({ map, color: 0x2a2018, transparent: true, alphaTest: 0.35, metalness: 0.6, roughness: 0.6, side: THREE.BackSide }), -sx * PW / 2, 0, -0.01, hinge);
    const gs = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x2a7aff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    gs.position.set(-sx * PW + sx * EYE_X, EYE_Y, 0.06); gs.scale.set(1.3, 0.7, 1); hinge.add(gs); eyeGlow.push(gs);
    plates.push({ hinge, sx, front, back });
  }
  const jaw = new THREE.Group(), ears = [];   // (the painted face has its own; kept for draw())

  // ---- steam: soft sprites drifting up from the pipes
  const steamTex = (function () {
    const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,0.75)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  })();
  const puffs = [];
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, depthWrite: false, opacity: 0 }));
    s.userData = { t: Math.random() * 3, side: i % 2 ? 1 : -1 }; head.add(s); puffs.push(s);
  }

  // ---- state and moves
  const REST = o.rest || { y: 1.45, s: 0.55 }, DOWN = o.down || { y: -0.3, s: 0.95 };   // resting over the LCD; dropped in front of its top
  const S = { y: REST.y, sc: REST.s, open: 0, turn: 0, eye: "blue", glow: 0, tw: [] };
  const EYE = { blue: 0x2a7aff, green: 0x2aff7a, red: 0xff2a1a, gold: 0xffc23a };
  function setEye(c) {
    S.eye = c;
    if (c !== "rainbow") { M.eye.emissive.setHex(EYE[c]); eyeGlow.forEach((g) => g.material.color.setHex(EYE[c])); }
    kick(1.2);
  }
  const ease = { out: (t) => 1 - (1 - t) ** 3, bounce: (t) => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; }, io: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2) };
  function tween(prop, to, dur, fn) { S.tw = S.tw.filter((t) => t.prop !== prop); S.tw.push({ prop, from: S[prop], to, t0: now(), dur, fn }); kick(dur + 0.2); }
  const now = () => performance.now() / 1000;
  function drop() { tween("y", DOWN.y, 0.9, ease.bounce); tween("sc", DOWN.s, 0.5, ease.out); shakeT = now() + 0.62; }
  function open() { tween("open", 1, 0.7, ease.io); tween("glow", 1, 0.9, ease.out); }
  function up() { tween("open", 0, 0.4, ease.io); tween("glow", 0, 0.4, ease.out); tween("y", REST.y, 0.8, ease.io); tween("sc", REST.s, 0.8, ease.io); tween("turn", 0, 0.5, ease.io); }
  function turn() { tween("turn", S.turn > 0.1 ? -0.5 : 0.5, 0.6, ease.io); }
  let shakeT = 0;

  // ---- render on demand: frames only while something moves (plus a slow idle for the steam)
  let busyUntil = 0, last = now(), frames = 0, fpsT = now(), raf = 0;
  const IDLE_FPS = 12;   // the steam and the ear gears at rest
  function kick(sec) { busyUntil = Math.max(busyUntil, now() + (sec || 0.5)); if (!raf) raf = requestAnimationFrame(loop); }
  function resize() {
    const r = cv.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); kick(0.1);
  }
  let idleAcc = 0;
  function loop() {
    if (paused) { raf = 0; return; }
    raf = 0;
    const t = now(), dt = Math.min(0.1, t - last); last = t;
    const busy = t < busyUntil;
    if (!busy) {   // idle: a slow tick for the steam
      idleAcc += dt;
      if (idleAcc < 1 / IDLE_FPS) { raf = requestAnimationFrame(loop); return; }
      idleAcc = 0;
    }
    S.tw = S.tw.filter((w) => { const u = Math.min(1, (t - w.t0) / w.dur); S[w.prop] = w.from + (w.to - w.from) * w.fn(u); return u < 1; });
    draw(t, busy ? dt : 1 / IDLE_FPS);
    renderer.render(scene, cam);
    frames++;
    if (t - fpsT > 1) { stats.fps = Math.round(frames / (t - fpsT)); stats.busy = busy; frames = 0; fpsT = t; }
    if (!paused) raf = requestAnimationFrame(loop);
  }
  function draw(t, dt) {
    const sh = t < shakeT ? (shakeT - t) * 0.12 : 0;
    pivot.position.set((Math.random() - 0.5) * sh, S.y + (Math.random() - 0.5) * sh, 0);
    pivot.scale.setScalar(S.sc);
    head.rotation.set(0.12 - 0.08 * S.open, S.turn, 0);
    plates.forEach((p) => { p.hinge.rotation.y = p.sx * 0.95 * S.open; });
    jaw.position.y = -0.3 * S.open;
    crown.rotation.z += dt * (0.12 + 1.2 * S.open);
    ears.forEach((g, i) => { g.rotation.x += dt * (0.6 + 3 * S.open) * (i ? 1 : -1); });
    gear.rotation.z += dt * (0.15 + 0.8 * S.open);
    coreMat.color.setScalar(Math.min(1, 0.33 + 0.67 * S.glow + 0.08 * S.glow * Math.sin(t * 9)));
    furnace.intensity = 6 * S.glow;
    if (S.eye === "rainbow") { M.eye.emissive.setHSL((t * 0.6) % 1, 1, 0.5); eyeGlow.forEach((g) => g.material.color.setHSL((t * 0.6) % 1, 1, 0.55)); }
    const hot = S.eye === "gold" || S.eye === "rainbow";
    M.eye.emissiveIntensity = (hot ? 1.6 : 1.1) * (0.85 + 0.15 * Math.sin(t * 6));
    eyeGlow.forEach((g) => { g.material.opacity = (hot ? 1 : 0.75) * (0.8 + 0.2 * Math.sin(t * 6)); });
    puffs.forEach((s) => {
      const u = s.userData; u.t += dt * (0.5 + 0.8 * S.open);
      const k = u.t % 3 / 3;
      s.position.set(u.side * (1.32 + 0.35 * k), 1.95 + 1.5 * k, -0.5 - 0.2 * k);
      s.scale.setScalar(0.4 + 1.2 * k);
      s.material.opacity = 0.32 * Math.sin(Math.PI * k) * (0.6 + 0.6 * S.open);
    });
  }

  window.addEventListener("resize", resize);
  resize();
  kick(1);
  api = { drop, open, up, turn, eye: setEye, stats, state: S,
    pause(on) { paused = !!on; if (!paused) kick(0.2); } };
  return true;
  }
  PK.Titan3D = {
    mount,
    drop() { if (api) api.drop(); }, open() { if (api) api.open(); }, up() { if (api) api.up(); },
    turn() { if (api) api.turn(); }, eye(c) { if (api) api.eye(c); }, pause(on) { if (api) api.pause(on); },
    get ready() { return !!api; }, get stats() { return api ? api.stats : null; }, get state() { return api ? api.state : null; },
  };
})();
