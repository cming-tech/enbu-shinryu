// 炎舞ドラゴン v2 — Module 3: PK.LCD
// Everything inside the liquid-crystal screen: canvas scenes (backgrounds, characters,
// particles, metallic 3D digits) plus DOM telops / HUD text.
// Draws in LCD design units (L.lcd.w x L.lcd.h = 392 x 320). The shell scales the whole stage.
// All animation runs on an internal clock, so the demo can freeze any frame (see PK.LCD._debug).
(function () {
  "use strict";
  const PK = (window.PK = window.PK || {});
  const LL = (PK.L && PK.L.lcd) || { x: 104, y: 150, w: 392, h: 320, r: 44 };
  const W = LL.w, H = LL.h, CX = W / 2;

  const FONT_DIGIT = '"Dela Gothic One","Noto Sans TC","Arial Black",Impact,sans-serif';
  const FONT_POP = '"Reggae One","Dela Gothic One","Noto Serif TC","Noto Sans TC","Arial Black",Impact,sans-serif';   // Noto Serif TC: 咚
  // Visible text lives in PK.TEXT (src/text.js); a missing key shows as "?key".
  const T = (k, v) => (PK.t ? PK.t(k, v) : "?" + k);
  const FONT_BRUSH = '"Yuji Syuku","Noto Sans TC","Arial Black",Impact,serif';
  const FONT_TC = '"Noto Sans TC","Arial Black",Impact,sans-serif';

  // ------------------------------------------------------------------ utils
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const u01 = (t, t0, d) => clamp((t - t0) / d, 0, 1);
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let rng = mulberry32(0x7a11d0);
  const rand = (a, b) => a + (b - a) * rng();
  const randi = (a, b) => Math.floor(a + (b - a + 1) * rng());
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  function hash1(n) {
    n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n = n ^ (n >>> 4);
    n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296;
  }
  const E = {
    lin: (t) => t,
    out: (t) => 1 - (1 - t) * (1 - t) * (1 - t),
    out2: (t) => 1 - (1 - t) * (1 - t),
    in: (t) => t * t * t,
    io: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    back: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    backBig: (t) => { const c1 = 3.2, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    elastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
  };
  function mkCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mixHex(a, b, t) {
    const A = hex2rgb(a), B = hex2rgb(b);
    return "rgb(" + Math.round(lerp(A[0], B[0], t)) + "," + Math.round(lerp(A[1], B[1], t)) + "," + Math.round(lerp(A[2], B[2], t)) + ")";
  }
  const C = {
    white: "255,255,255", gold: "255,196,60", orange: "255,124,24", red: "255,46,24", blue: "60,150,255",
    cyan: "90,225,255", purple: "176,90,255", green: "70,235,120", pink: "255,100,210", yellow: "255,240,120",
    ember: "255,150,40",
  };
  const rgba = (c, a) => "rgba(" + c + "," + a + ")";
  const HOLD_RGB = { blue: C.blue, green: C.green, red: C.red, gold: C.gold, rainbow: C.white, white: C.white, purple: C.purple };
  const reduced = (function () { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } })();

  // ------------------------------------------------------------------ clock / waits / tweens
  const clk = { t: 0, scale: 1 };
  let waits = [];
  function wait(sec) {
    return new Promise((res) => { waits.push({ at: clk.t + Math.max(0, sec || 0), res }); });
  }
  let tweens = [];
  function tween(obj, to, dur, ease) {
    for (const tw of tweens) if (tw.obj === obj) for (const k in to) delete tw.to[k];
    if (!dur || dur <= 0) { for (const k in to) obj[k] = to[k]; return; }
    const tw = { obj, to: Object.assign({}, to), from: {}, t0: clk.t, dur, ease: ease || E.out };
    for (const k in to) tw.from[k] = obj[k];
    tweens.push(tw);
  }
  function updTweens() {
    if (!tweens.length) return;
    const keep = [];
    for (const tw of tweens) {
      const u = u01(clk.t, tw.t0, tw.dur), e = tw.ease(u);
      let any = false;
      for (const k in tw.to) { tw.obj[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e; any = true; }
      if (u < 1 && any) keep.push(tw);
    }
    tweens = keep;
  }

  // ------------------------------------------------------------------ sprite caches
  const cache = {};
  function glowSpr(c) {
    const key = "g" + c;
    if (cache[key]) return cache[key];
    const s = mkCanvas(64, 64), g = s.getContext("2d");
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.16, rgba(c, 0.95));
    gr.addColorStop(0.45, rgba(c, 0.32));
    gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (cache[key] = s);
  }
  function softSpr(c) { // flat soft blob (no white core)
    const key = "s" + c;
    if (cache[key]) return cache[key];
    const s = mkCanvas(64, 64), g = s.getContext("2d");
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(c, 1)); gr.addColorStop(0.5, rgba(c, 0.45)); gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (cache[key] = s);
  }
  function fireSpr() {
    if (cache.fire) return cache.fire;
    const s = mkCanvas(64, 64), g = s.getContext("2d");
    const gr = g.createRadialGradient(32, 34, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,250,215,1)");
    gr.addColorStop(0.22, "rgba(255,206,80,0.92)");
    gr.addColorStop(0.5, "rgba(255,96,12,0.5)");
    gr.addColorStop(0.78, "rgba(190,24,0,0.16)");
    gr.addColorStop(1, "rgba(120,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (cache.fire = s);
  }
  function starSpr(c) {
    const key = "st" + c;
    if (cache[key]) return cache[key];
    const s = mkCanvas(64, 64), g = s.getContext("2d");
    g.drawImage(glowSpr(c), 16, 16, 32, 32);
    g.globalCompositeOperation = "lighter";
    g.fillStyle = "rgba(255,255,255,0.95)";
    g.beginPath();
    g.moveTo(32, 2); g.quadraticCurveTo(34, 30, 62, 32); g.quadraticCurveTo(34, 34, 32, 62);
    g.quadraticCurveTo(30, 34, 2, 32); g.quadraticCurveTo(30, 30, 32, 2); g.fill();
    g.fillStyle = rgba(c, 0.8);
    g.beginPath(); g.arc(32, 32, 5, 0, TAU); g.fill();
    return (cache[key] = s);
  }
  function raysSpr(c, n) {
    const key = "r" + c + n;
    if (cache[key]) return cache[key];
    const S = 360, s = mkCanvas(S, S), g = s.getContext("2d");
    g.translate(S / 2, S / 2);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, S / 2);
    gr.addColorStop(0, rgba(c, 0.95)); gr.addColorStop(0.35, rgba(c, 0.45)); gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, w = i % 2 ? 0.045 : 0.1 + (i % 3) * 0.02;
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, S / 2, a - w, a + w); g.closePath(); g.fill();
    }
    return (cache[key] = s);
  }
  function vignSpr(c) {
    const key = "v" + c;
    if (cache[key]) return cache[key];
    const s = mkCanvas(200, 164), g = s.getContext("2d");
    g.scale(200 / W, 164 / H);
    const gr = g.createRadialGradient(CX, H / 2, 60, CX, H / 2, 250);
    gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.55, rgba(c, 0.25)); gr.addColorStop(1, rgba(c, 1));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    return (cache[key] = s);
  }
  function drawRays(ctx, x, y, c, rot, alpha, R, n, add) {
    if (alpha <= 0) return;
    const s = raysSpr(c, n || 16);
    ctx.save();
    if (add) ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot);
    R = R || 420; ctx.drawImage(s, -R, -R, 2 * R, 2 * R);
    ctx.restore();
  }
  function drawGlow(ctx, c, x, y, r, a) {
    if (a <= 0) return;
    ctx.globalAlpha = a; ctx.drawImage(glowSpr(c), x - r, y - r, 2 * r, 2 * r);
  }

  // ------------------------------------------------------------------ fancy (metallic) text
  // Draws text with glow, 3D extrusion, dark outline, metal rim, gradient face, bevel and gloss.
  // g must already have its transform set; K = device px per unit (for shadowBlur).
  function fancyText(g, text, x, y, o) {
    const K = o.K || 2, fs = o.size;
    g.save();
    g.font = fs + "px " + (o.font || FONT_DIGIT);
    g.textAlign = o.align || "left"; g.textBaseline = "alphabetic";
    g.lineJoin = "round"; g.miterLimit = 2;
    const m = g.measureText(text);
    const asc = m.actualBoundingBoxAscent || fs * 0.72, dsc = m.actualBoundingBoxDescent || 0;
    const top = y - asc, bot = y + dsc;
    const lwO = fs * (o.outline || 0.11);
    if (o.glow) {
      g.save(); g.shadowColor = o.glow; g.shadowBlur = fs * (o.glowBlur || 0.16) * K;
      g.strokeStyle = o.glow; g.fillStyle = o.glow; g.lineWidth = lwO;
      g.strokeText(text, x, y); g.strokeText(text, x, y); g.restore();
    }
    const dep = fs * (o.depth != null ? o.depth : 0.07);
    const steps = Math.ceil(dep);
    for (let i = steps; i >= 1; i--) {
      const f = i / steps;
      g.fillStyle = g.strokeStyle = mixHex(o.ext[0], o.ext[1], f);
      g.lineWidth = lwO;
      const dx = (i * dep * 0.45) / steps, dy = (i * dep) / steps;
      g.strokeText(text, x + dx, y + dy); g.fillText(text, x + dx, y + dy);
    }
    g.strokeStyle = o.dark || "#0a0204"; g.lineWidth = lwO; g.strokeText(text, x, y);
    const rg = g.createLinearGradient(0, top, 0, bot);
    o.rim.forEach((s) => rg.addColorStop(s[0], s[1]));
    g.strokeStyle = rg; g.lineWidth = fs * (o.rimW || 0.062); g.strokeText(text, x, y);
    g.strokeStyle = o.inner || "#200"; g.lineWidth = fs * 0.022; g.strokeText(text, x, y);
    // face with bevel + gloss on a temp canvas (source-atop keeps it inside the glyphs)
    const t = mkCanvas(g.canvas.width, g.canvas.height), tg = t.getContext("2d");
    tg.setTransform(g.getTransform());
    tg.font = g.font; tg.textAlign = g.textAlign; tg.textBaseline = "alphabetic"; tg.lineJoin = "round";
    const fg = tg.createLinearGradient(0, top, 0, bot);
    o.face.forEach((s) => fg.addColorStop(s[0], s[1]));
    tg.fillStyle = fg; tg.fillText(text, x, y);
    tg.globalCompositeOperation = "source-atop";
    tg.lineWidth = fs * 0.03;
    tg.strokeStyle = "rgba(255,255,255,0.85)"; tg.strokeText(text, x + fs * 0.012, y + fs * 0.017);
    tg.strokeStyle = "rgba(0,0,0,0.42)"; tg.strokeText(text, x - fs * 0.012, y - fs * 0.017);
    const w = m.width, lx = g.textAlign === "center" ? x - w / 2 : g.textAlign === "right" ? x - w : x;
    const gl = tg.createLinearGradient(0, top, 0, top + (bot - top) * 0.55);
    gl.addColorStop(0, "rgba(255,255,255,0.7)"); gl.addColorStop(0.75, "rgba(255,255,255,0.12)"); gl.addColorStop(1, "rgba(255,255,255,0)");
    tg.fillStyle = gl;
    tg.beginPath();
    tg.moveTo(lx - 20, top - 20); tg.lineTo(lx + w + 20, top - 20); tg.lineTo(lx + w + 20, top + (bot - top) * 0.36);
    tg.quadraticCurveTo(lx + w / 2, top + (bot - top) * 0.56, lx - 20, top + (bot - top) * 0.42);
    tg.closePath(); tg.fill();
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(t, 0, 0);
    g.restore();
    return { asc, dsc, w: m.width, bl: m.actualBoundingBoxLeft || 0, br: m.actualBoundingBoxRight || m.width };
  }
  function star4(g, x, y, r, a) {
    g.save(); g.globalAlpha = a == null ? 1 : a; g.globalCompositeOperation = "lighter";
    g.drawImage(glowSpr(C.white), x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
    g.fillStyle = "#fff";
    g.beginPath();
    g.moveTo(x, y - r); g.quadraticCurveTo(x + r * 0.08, y - r * 0.08, x + r, y);
    g.quadraticCurveTo(x + r * 0.08, y + r * 0.08, x, y + r);
    g.quadraticCurveTo(x - r * 0.08, y + r * 0.08, x - r, y);
    g.quadraticCurveTo(x - r * 0.08, y - r * 0.08, x, y - r);
    g.fill(); g.restore();
  }

  // ------------------------------------------------------------------ palettes for digits & text
  const PAL = {
    red: {
      face: [[0, "#fff6ee"], [0.16, "#ffc6aa"], [0.34, "#ff4a32"], [0.52, "#c00412"], [0.6, "#ff3a2a"], [0.82, "#ff9a74"], [1, "#7c0010"]],
      rim: [[0, "#fffbe0"], [0.28, "#ffd14a"], [0.55, "#a86400"], [0.75, "#ffe58a"], [1, "#7a4300"]],
      inner: "#3a0006", ext: ["#6a0610", "#1a0002"], glow: "rgba(255,50,16,0.95)", rgb: C.red,
    },
    blue: {
      face: [[0, "#f2fbff"], [0.16, "#aee4ff"], [0.34, "#3a9cff"], [0.52, "#0638b8"], [0.6, "#2a86ff"], [0.82, "#8ad6ff"], [1, "#001c64"]],
      rim: [[0, "#ffffff"], [0.28, "#d4e4f4"], [0.55, "#56708e"], [0.75, "#f4fbff"], [1, "#34465e"]],
      inner: "#00102e", ext: ["#06245a", "#000616"], glow: "rgba(40,140,255,0.95)", rgb: C.blue,
    },
    gold: {
      face: [[0, "#ffffff"], [0.16, "#fff3b0"], [0.36, "#ffc824"], [0.52, "#a85c00"], [0.6, "#ffcf3a"], [0.82, "#fff0a0"], [1, "#6e3a00"]],
      rim: [[0, "#fff0e0"], [0.28, "#ff6a3a"], [0.55, "#9a0a00"], [0.75, "#ff8a5a"], [1, "#5a0000"]],
      inner: "#3a1a00", ext: ["#5a2c00", "#140800"], glow: "rgba(255,186,30,1)", rgb: C.gold,
    },
    green: {
      face: [[0, "#f4fff4"], [0.16, "#b8ffc4"], [0.36, "#2ee06a"], [0.52, "#00782a"], [0.6, "#2ed060"], [0.82, "#a8ffb8"], [1, "#003a12"]],
      rim: [[0, "#fffbe0"], [0.28, "#ffd14a"], [0.55, "#a86400"], [0.75, "#ffe58a"], [1, "#7a4300"]],
      inner: "#002a0c", ext: ["#004a18", "#001006"], glow: "rgba(40,255,120,0.9)", rgb: C.green,
    },
    fire: {
      face: [[0, "#fffef0"], [0.2, "#fff07a"], [0.42, "#ffa21a"], [0.62, "#ff4a0a"], [0.8, "#d01800"], [1, "#6a0000"]],
      rim: [[0, "#fff6d0"], [0.35, "#ffd860"], [0.6, "#9a5800"], [0.8, "#ffe48a"], [1, "#6a3a00"]],
      inner: "#3a0800", ext: ["#4a0a00", "#100200"], glow: "rgba(255,90,10,0.95)", rgb: C.orange,
    },
    ice: {
      face: [[0, "#ffffff"], [0.2, "#d8f6ff"], [0.42, "#60c8ff"], [0.6, "#1a5adf"], [0.8, "#58b8ff"], [1, "#0a1a6a"]],
      rim: [[0, "#fffbe0"], [0.3, "#ffd34a"], [0.6, "#a06000"], [0.8, "#ffec9a"], [1, "#6a3a00"]],
      inner: "#000a2a", ext: ["#0a1a5a", "#000414"], glow: "rgba(60,170,255,0.95)", rgb: C.cyan,
    },
  };

  // ------------------------------------------------------------------ sprites built from fonts
  const SPR = { dig: [], next: null, logo: {}, push: null, ok: false };
  const SPR_K = 2.2;
  const DIG_FS = 146;
  let DIG_H = 100; // glyph height in units at scale 1 (measured)

  function buildGlyph(text, pal, fs, font, deco) {
    const K = SPR_K;
    const mctx = mkCanvas(4, 4).getContext("2d");
    mctx.font = fs + "px " + font;
    const m = mctx.measureText(text);
    const bl = m.actualBoundingBoxLeft || 0, br = m.actualBoundingBoxRight || m.width;
    const asc = m.actualBoundingBoxAscent || fs * 0.72, dsc = m.actualBoundingBoxDescent || 0;
    const gw = bl + br, gh = asc + dsc;
    const pad = Math.round(fs * 0.2), dep = fs * 0.07;
    const cw = gw + pad * 2 + dep * 0.5, ch = gh + pad * 2 + dep;
    const c = mkCanvas(cw * K, ch * K), g = c.getContext("2d");
    g.scale(K, K);
    const ox = pad + bl, oy = pad + asc;
    fancyText(g, text, ox, oy, {
      K, size: fs, font, face: pal.face, rim: pal.rim, inner: pal.inner, ext: pal.ext, glow: pal.glow,
      glowBlur: 0.15, depth: 0.07, outline: 0.11,
    });
    star4(g, ox - bl + gw * 0.2, oy - asc + gh * 0.13, fs * 0.09, 0.95);
    if (deco === "seven") star4(g, ox - bl + gw * 0.82, oy - asc + gh * 0.62, fs * 0.07, 0.9);
    return { c, ax: pad + gw / 2, ay: pad + gh / 2, w: cw, h: ch, gh, gw };
  }
  function blurOf(sp) {
    const K2 = 1.0, extra = sp.gh * 0.7;
    const c = mkCanvas(sp.w * K2, (sp.h + extra) * K2), g = c.getContext("2d");
    const n = 32;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1) - 0.5;
      g.globalAlpha = 0.03 + 0.2 * Math.exp(-(f * 4.2) * (f * 4.2));
      g.drawImage(sp.c, 0, (extra / 2 + f * extra) * K2, sp.w * K2, sp.h * K2);
    }
    // brighten the core so a spinning reel still reads as glowing metal
    g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.22;
    g.drawImage(c, 0, 0);
    return { c, ax: sp.ax, ay: sp.ay + extra / 2, w: sp.w, h: sp.h + extra };
  }
  const FLAME_FIRE = ["255,240,170", "255,150,30", "230,40,0", "150,0,0"];
  const FLAME_BLUE = ["230,250,255", "90,200,255", "20,80,255", "0,0,120"];
  const FLAME_GREEN = ["240,255,230", "120,255,140", "0,170,60", "0,60,20"];
  function flameShape(g, x, y, w, h, lean, a, pal) {
    const P4 = pal || FLAME_FIRE;
    const gr = g.createLinearGradient(0, y, 0, y - h);
    gr.addColorStop(0, "rgba(" + P4[0] + "," + a + ")");
    gr.addColorStop(0.3, "rgba(" + P4[1] + "," + a * 0.9 + ")");
    gr.addColorStop(0.7, "rgba(" + P4[2] + "," + a * 0.55 + ")");
    gr.addColorStop(1, "rgba(" + P4[3] + ",0)");
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x - w / 2, y);
    g.bezierCurveTo(x - w * 0.62, y - h * 0.35, x - w * 0.15 + lean * 0.4, y - h * 0.62, x + lean, y - h);
    g.bezierCurveTo(x + w * 0.12 + lean * 0.4, y - h * 0.55, x + w * 0.66, y - h * 0.35, x + w / 2, y);
    g.quadraticCurveTo(x, y + w * 0.25, x - w / 2, y);
    g.fill();
  }
  function drawCrest(g, x, y, r, K) {
    g.save();
    // flame tongues around the crest
    g.save(); g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      g.save(); g.translate(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92); g.rotate(a + Math.PI / 2);
      flameShape(g, 0, 0, r * 0.34, r * (0.38 + 0.18 * ((i * 7) % 3) / 2), 0, 0.85);
      g.restore();
    }
    g.restore();
    g.shadowColor = "rgba(255,120,0,0.9)"; g.shadowBlur = r * 0.35 * K;
    g.fillStyle = "#1a0200"; g.beginPath(); g.arc(x, y, r * 1.08, 0, TAU); g.fill();
    g.shadowBlur = 0;
    const ring = g.createLinearGradient(x - r, y - r, x + r, y + r);
    ring.addColorStop(0, "#fffbe0"); ring.addColorStop(0.25, "#ffd24a"); ring.addColorStop(0.5, "#8a5400");
    ring.addColorStop(0.72, "#ffe58a"); ring.addColorStop(1, "#7a4300");
    g.fillStyle = ring; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    const disc = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r * 0.86);
    disc.addColorStop(0, "#e8301a"); disc.addColorStop(0.55, "#9a0806"); disc.addColorStop(1, "#300000");
    g.fillStyle = disc; g.beginPath(); g.arc(x, y, r * 0.84, 0, TAU); g.fill();
    g.strokeStyle = "rgba(255,220,120,0.9)"; g.lineWidth = r * 0.04;
    g.beginPath(); g.arc(x, y, r * 0.76, 0, TAU); g.stroke();
    // notches on the ring (family-crest look)
    g.fillStyle = "#5a2a00";
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      g.save(); g.translate(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92); g.rotate(a);
      g.beginPath(); g.moveTo(-r * 0.05, 0); g.lineTo(0, -r * 0.05); g.lineTo(r * 0.05, 0); g.lineTo(0, r * 0.05); g.fill();
      g.restore();
    }
    fancyText(g, T("lcd.crest"), x, y + r * 0.42, {
      K, size: r * 1.24, font: FONT_BRUSH, align: "center",
      face: [[0, "#ffffff"], [0.3, "#fff2a0"], [0.6, "#ffc21a"], [1, "#a85a00"]],
      rim: [[0, "#3a0000"], [1, "#200000"]], rimW: 0.02, inner: "#300", ext: ["#3a0000", "#100000"], depth: 0.05,
      outline: 0.1, glow: "rgba(255,200,60,0.7)", glowBlur: 0.12,
    });
    // gloss
    const gl = g.createLinearGradient(0, y - r, 0, y);
    gl.addColorStop(0, "rgba(255,255,255,0.45)"); gl.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gl; g.beginPath(); g.ellipse(x, y - r * 0.38, r * 0.7, r * 0.42, 0, 0, TAU); g.fill();
    g.restore();
  }
  function buildLogo(variant) {
    const K = SPR_K, w = 300, h = 86;
    const c = mkCanvas(w * K, h * K), g = c.getContext("2d");
    g.scale(K, K);
    // flame wings behind the title
    g.save(); g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 22; i++) {
      const fx0 = 18 + (i / 21) * 264, d = Math.abs(fx0 - 150) / 150;
      flameShape(g, fx0, 64, 26, 30 + 26 * (1 - d) + 10 * Math.sin(i * 2.3), (fx0 - 150) * 0.12, 0.5);
    }
    g.restore();
    const fireF = PAL.fire;
    if (variant === "rush") {
      fancyText(g, T("lcd.logoL"), 104, 62, { K, size: 46, font: FONT_BRUSH, align: "right", face: fireF.face, rim: fireF.rim, inner: fireF.inner, ext: fireF.ext, glow: "rgba(255,90,10,0.8)", outline: 0.14 });
      fancyText(g, "RUSH", 110, 62, { K, size: 46, font: FONT_DIGIT, align: "left", face: PAL.ice.face, rim: PAL.ice.rim, inner: PAL.ice.inner, ext: PAL.ice.ext, glow: "rgba(60,170,255,0.9)", outline: 0.13 });
      star4(g, 246, 22, 9, 1); star4(g, 120, 24, 6, 0.9);
    } else {
      fancyText(g, T("lcd.logoL"), 116, 62, { K, size: 46, font: FONT_BRUSH, align: "right", face: fireF.face, rim: fireF.rim, inner: fireF.inner, ext: fireF.ext, glow: "rgba(255,90,10,0.8)", outline: 0.14 });
      fancyText(g, T("lcd.logoR"), 184, 62, { K, size: 46, font: FONT_BRUSH, align: "left", face: fireF.face, rim: fireF.rim, inner: fireF.inner, ext: fireF.ext, glow: "rgba(255,90,10,0.8)", outline: 0.14 });
      drawCrest(g, 150, 43, 30, K);
      star4(g, 272, 36, 7, 0.9);
    }
    return { c, w, h, ax: w / 2, ay: h / 2 };
  }
  function buildPush() {
    const K = SPR_K, S = 120;
    const c = mkCanvas(S * K, S * K), g = c.getContext("2d");
    g.scale(K, K);
    const x = S / 2, y = S / 2, r = 48;
    g.shadowColor = "rgba(255,40,20,0.9)"; g.shadowBlur = 14 * K;
    g.fillStyle = "#200"; g.beginPath(); g.arc(x, y, r + 4, 0, TAU); g.fill();
    g.shadowBlur = 0;
    const ring = g.createLinearGradient(x - r, y - r, x + r, y + r);
    ring.addColorStop(0, "#ffffff"); ring.addColorStop(0.3, "#b8c4d0"); ring.addColorStop(0.55, "#4a5868");
    ring.addColorStop(0.8, "#eef4fa"); ring.addColorStop(1, "#56606c");
    g.fillStyle = ring; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.fillStyle = "#1a0000"; g.beginPath(); g.arc(x, y, r * 0.82, 0, TAU); g.fill();
    const dome = g.createRadialGradient(x - r * 0.25, y - r * 0.35, r * 0.05, x, y, r * 0.8);
    dome.addColorStop(0, "#ffd0c0"); dome.addColorStop(0.25, "#ff4a2a"); dome.addColorStop(0.7, "#b00800"); dome.addColorStop(1, "#4a0000");
    g.fillStyle = dome; g.beginPath(); g.arc(x, y, r * 0.77, 0, TAU); g.fill();
    g.font = "26px " + FONT_DIGIT; g.textAlign = "center"; g.lineJoin = "round";
    g.lineWidth = 6; g.strokeStyle = "#3a0000"; g.strokeText("PUSH", x, y + 9);
    const tf = g.createLinearGradient(0, y - 12, 0, y + 10);
    tf.addColorStop(0, "#ffffff"); tf.addColorStop(0.6, "#fff0b0"); tf.addColorStop(1, "#ffb020");
    g.fillStyle = tf; g.fillText("PUSH", x, y + 9);
    const gl = g.createLinearGradient(0, y - r * 0.8, 0, y);
    gl.addColorStop(0, "rgba(255,255,255,0.7)"); gl.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gl; g.beginPath(); g.ellipse(x, y - r * 0.36, r * 0.55, r * 0.3, 0, 0, TAU); g.fill();
    return { c, w: S, h: S, ax: S / 2, ay: S / 2 };
  }
  function buildSprites() {
    for (let d = 1; d <= 9; d++) {
      const pal = d === 7 ? PAL.gold : d % 2 ? PAL.red : PAL.blue;
      const sp = buildGlyph(String(d), pal, DIG_FS, FONT_DIGIT, d === 7 ? "seven" : null);
      sp.blur = blurOf(sp);
      SPR.dig[d] = sp;
    }
    DIG_H = SPR.dig[8].gh;
    const nx = buildGlyph(T("lcd.next"), PAL.green, DIG_FS * 0.9, FONT_DIGIT, null);
    nx.blur = blurOf(nx);
    SPR.next = nx;
    SPR.logo.main = buildLogo("main");
    SPR.logo.rush = buildLogo("rush");
    SPR.push = buildPush();
    SPR.ok = true;
  }
  function drawSpr(ctx, sp, x, y, s) {
    ctx.drawImage(sp.c, x - sp.ax * s, y - sp.ay * s, sp.w * s, sp.h * s);
  }

  // ------------------------------------------------------------------ image slots
  const IMG = {};
  const IMG_FILES = { bg_normal: "bg_normal.jpg", bg_rush: "bg_rush.jpg", hero: "hero.png", rival: "rival.png", cutin_hero: "cutin_hero.png", jackpot: "jackpot.png", cab_dragon: "cab_dragon.png",
    pose_slash: "pose_slash.png", pose_victory: "pose_victory.png", step1: "step1.jpg", step2: "step2.jpg", step3: "step3.jpg",
    bg_sp: "bg_sp.jpg", bg_battle: "bg_battle.jpg", bg_spsp: "bg_spsp.jpg", bg_bonus: "bg_bonus.jpg", bg_jitan: "bg_jitan.jpg", bg_jackpot: "bg_jackpot.jpg",
    // 神龍 (the living gold dragon: the good omen), the jackpot illustration, the 龍兵 and the
    // round-by-round journey scenes of the bonus
    shinryu: "shinryu.png", jackpot_art: "jackpot_art.jpg", fly_head: "fly_head.png", fly_body: "fly_body.png", fly_tail: "fly_tail.png" };
  // The flying 神龍 of 龍神リーチ: a long serpent built from three parts that dev/make_fly_parts.py cuts out
  // of two pictures: the head up to the top of the neck's arch (join: where the body goes on, as fractions of
  // the part), a straightened stretch of the body (its centre line bodyMid down) laid back and forth along
  // len units of body (slim of the picture's thickness; fat times that after the neck), keeping it to 35%
  // of the way and then tapering to taper of it, and the tail tuft (attach: where the thin
  // tail enters it). A wave runs from the head down the body (waves along it, amp units, speed rad/s)
  // while it crosses the LCD in dur seconds, its head headH units tall.
  const FLY = { dur: 3.8, headH: 124, len: 380, slim: 0.8, fat: 1.0, taper: 0.22, tilt: 0.22, step: 3, waves: 1.4, amp: 16, speed: 6.5,
    join: [0.942, 0.335], bodyMid: 0.608, attach: [0, 0.911] };
  for (let i = 1; i <= 6; i++) IMG_FILES["minion" + i] = "minion" + i + ".png";
  for (let i = 1; i <= 10; i++) IMG_FILES["round" + i] = "round" + i + ".jpg";
  // the gold dragon on the LCD: the living 神龍, else the cabinet's statue
  const goldDragon = () => IMG.shinryu || IMG.cab_dragon;
  let imgPending = 0;
  function loadImages(base) {
    for (const k in IMG_FILES) {
      imgPending++;
      const im = new Image();
      im.onload = () => { IMG[k] = im.naturalWidth > 0 ? im : null; imgPending--; };
      im.onerror = () => { IMG[k] = null; imgPending--; };
      im.src = base + IMG_FILES[k];
    }
  }
  // ------------------------------------------------------------------ video slots (optional AI clips)
  // assets/vid_<name>.mp4 plays muted behind the telops during a key 演出; a missing file is skipped.
  const VID_FILES = { kokuchi: "vid_kokuchi.mp4", win: "vid_win.mp4", rush: "vid_rush.mp4", jackpot: "vid_jackpot.mp4",
    sp: "vid_sp.mp4", spsp: "vid_spsp.mp4", round: "vid_round.mp4", round2: "vid_round2.mp4", round3: "vid_round3.mp4",
    battle: "vid_battle.mp4", lose: "vid_lose.mp4", round4: "vid_round4.mp4", round5: "vid_round5.mp4", round6: "vid_round6.mp4",
    awaken: "vid_awaken.mp4" };
  const ROUND_CLIPS = ["round", "round2", "round3", "round4", "round5", "round6"];
  // Where the canvas carries the key content (777, the RUSH logo) the clip is screened over it.
  const VID_SCREEN = { jackpot: true, rush: true };
  const VID = {};
  let vidLayer = null;
  // Clips first load only their headers; the rest follows one clip at a time, the most common 演出
  // first, so a phone does not fetch every clip at once on opening the page.
  const VID_ORDER = ["kokuchi", "sp", "battle", "win", "lose", "spsp", "jackpot", "rush", "awaken", "round", "round2", "round3", "round4", "round5", "round6"];
  const VID_GAP = 2.5;   // seconds between preloads
  function loadVideos(base) {
    for (const k in VID_FILES) {
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "metadata";
      v.className = "pkl-vid";
      if (VID_SCREEN[k]) { v.style.mixBlendMode = "screen"; v.classList.add("scr"); }
      if (k.startsWith("round")) v.classList.add("pip");   // bonus rounds: a framed window, the boss stays in view
      // Usable at once: iOS Safari loads no media data before play(), so waiting for loadeddata
      // would skip every clip there. A missing or unplayable file fires error and is dropped.
      VID[k] = v;
      v.addEventListener("error", () => { VID[k] = null; v.remove(); }, { once: true });
      v.addEventListener("ended", () => v.classList.remove("on"));
      v.src = base + VID_FILES[k];
      vidLayer.appendChild(v);
    }
    const order = VID_ORDER.concat(Object.keys(VID_FILES).filter((k) => VID_ORDER.indexOf(k) < 0));
    order.forEach((k, i) => setTimeout(() => { if (VID[k]) VID[k].preload = "auto"; }, (2 + i * VID_GAP) * 1000));
  }
  function playClip(name) {
    const v = VID[name];
    if (!v) return null;
    try { v.currentTime = 0; } catch (e) { /* not seekable yet: plays from where it is */ }
    v.playbackRate = clamp(clk.scale, 0.5, 4);   // keeps pace with the 演出 speed setting
    v.classList.add("on");
    const p = v.play();
    if (p && p.catch) p.catch(() => { v.classList.remove("on"); v.dispatchEvent(new Event("ended")); });
    return v;
  }
  // Plays a clip and resolves when it ends (or after max seconds); null when there is no clip.
  function playClipToEnd(name, max) {
    const v = playClip(name);
    if (!v) return null;
    return new Promise((res) => {
      let done = false;
      const fin = () => { if (done) return; done = true; v.removeEventListener("ended", fin); v.classList.remove("on"); res(); };
      v.addEventListener("ended", fin);
      wait(max).then(fin);
    });
  }
  // A white flash above the clips (the canvas flash sits under them).
  let whiteEl = null;
  function white(a, sec) {
    if (!whiteEl) return;
    whiteEl.style.transition = "opacity " + (sec / clk.scale).toFixed(3) + "s";
    whiteEl.style.opacity = String(a);
  }
  function drawCover(ctx, im, x, y, w, h) {
    const s = Math.max(w / im.naturalWidth, h / im.naturalHeight);
    const iw = im.naturalWidth * s, ih = im.naturalHeight * s;
    ctx.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }
  // AI dragon art (rival.png, or the gold statue cab_dragon.png) in place of a drawn dragon: h tall,
  // centred on (cx, cy), facing left like the art (flip: facing right). Returns the mouth, roughly.
  function drawArtDragon(ctx, im, cx, cy, h, flip) {
    const w = (h * im.naturalWidth) / im.naturalHeight;
    ctx.save();
    ctx.translate(cx, cy);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(im, -w / 2, -h / 2, w, h);
    ctx.restore();
    return { mx: cx + (flip ? 0.3 : -0.3) * w, my: cy - 0.12 * h };
  }
  // The flying 神龍 (FLY), its head centred on (hx, hy), at time t. Drawn from the tail forward: the
  // tuft, the body slice by slice along the wave, then the head turned with the neck. Returns the mouth.
  function drawFlyDragon(ctx, hx, hy, t) {
    const head = IMG.fly_head, body = IMG.fly_body, tail = IMG.fly_tail;
    const k = FLY.headH / head.naturalHeight, hw = head.naturalWidth * k, hh = FLY.headH;
    const bt = body.naturalHeight * k * FLY.slim, bw = body.naturalWidth * k, n = body.naturalWidth;
    const wave = (d) => FLY.amp * (0.15 + 0.85 * d / FLY.len) * Math.sin((d / FLY.len) * FLY.waves * TAU - t * FLY.speed);
    const slope = (d) => Math.atan2(wave(d + 1) - wave(d - 1), 2);
    const jx = hx - hw / 2 + FLY.join[0] * hw, jy = hy - hh / 2 + FLY.join[1] * hh;   // where the body leaves the neck
    // the tail tuft
    const tw = tail.naturalWidth * k * FLY.slim, th = tail.naturalHeight * k * FLY.slim;
    ctx.save(); ctx.translate(jx + FLY.len, jy + wave(FLY.len)); ctx.rotate(slope(FLY.len));
    ctx.drawImage(tail, -FLY.attach[0] * tw, -FLY.attach[1] * th, tw, th);
    ctx.restore();
    // the body: slices of the straightened stretch, back and forth along it so it never jumps
    const sw = FLY.step * 1.8, src = Math.min(n, sw / k);
    for (let d = FLY.len; d > -FLY.step; d -= FLY.step) {
      const q = d / bw, f = q - Math.floor(q), u = Math.floor(q) % 2 ? 1 - f : f;
      const e = clamp((d / FLY.len - 0.35) / 0.65, 0, 1), neck = clamp(d / 40, 0, 1);   // from the neck's own width
      const thick = bt * (1 + (FLY.fat - 1) * neck) * (1 - (1 - FLY.taper / FLY.fat) * e * e * (3 - 2 * e));
      ctx.save(); ctx.translate(jx + d, jy + wave(d)); ctx.rotate(slope(d));
      ctx.drawImage(body, u * (n - src), 0, src, body.naturalHeight, -sw / 2, -thick * FLY.bodyMid, sw, thick);
      ctx.restore();
    }
    // the head, turned with the neck (and up by tilt: the picture looks down)
    ctx.save(); ctx.translate(jx, jy + wave(0)); ctx.rotate(slope(0) * 0.8 + FLY.tilt);
    ctx.drawImage(head, -FLY.join[0] * hw, -FLY.join[1] * hh, hw, hh);
    ctx.restore();
    return { mx: jx - FLY.join[0] * hw + 0.03 * hw, my: jy + wave(0) + (0.68 - FLY.join[1]) * hh };
  }
  function drawContain(ctx, im, x, y, w, h, alignBottom) {
    const s = Math.min(w / im.naturalWidth, h / im.naturalHeight);
    const iw = im.naturalWidth * s, ih = im.naturalHeight * s;
    ctx.drawImage(im, x + (w - iw) / 2, alignBottom ? y + h - ih : y + (h - ih) / 2, iw, ih);
  }

  // ------------------------------------------------------------------ art: dragon
  const DPAL = {
    fire: { body: "#b8180d", dark: "#3a0302", belly: "#ffcf70", bellyLine: "#a8561a", fin: "#ff8a1a", finDark: "#8a2000", hi: "rgba(255,180,120,0.5)", horn: "#ffeec0", hornDark: "#7a4a18", eye: "#fff36a", glow: "255,90,20", mouth: "#3a0000", scale: "rgba(70,0,0,0.6)" },
    gold: { body: "#e3a422", dark: "#5a3000", belly: "#fff4c4", bellyLine: "#b07a20", fin: "#ff5a1a", finDark: "#8a1800", hi: "rgba(255,252,210,0.6)", horn: "#fffbe8", hornDark: "#9a7028", eye: "#ff2a0a", glow: "255,190,60", mouth: "#5a0a00", scale: "rgba(120,60,0,0.5)" },
    shadow: { body: "#1a0505", dark: "#000000", belly: "#2e0906", bellyLine: "#000000", fin: "#4a0c04", finDark: "#000000", hi: "rgba(255,110,40,0.45)", horn: "#3a0e06", hornDark: "#000000", eye: "#ff7a1a", glow: "255,60,10", mouth: "#000000", scale: "rgba(0,0,0,0.4)" },
    azure: { body: "#1d4fae", dark: "#06163a", belly: "#cfefff", bellyLine: "#4a7ab0", fin: "#56d8ff", finDark: "#0a4a8a", hi: "rgba(190,240,255,0.55)", horn: "#f0fbff", hornDark: "#5a7a9a", eye: "#ffe14a", glow: "80,180,255", mouth: "#001030", scale: "rgba(0,10,50,0.5)" },
  };
  const HEAD = {
    mane: new Path2D("M -2 -14 C -16 -28 -34 -28 -54 -36 C -42 -25 -44 -16 -62 -10 C -47 -5 -45 3 -60 11 C -43 11 -34 17 -27 30 C -20 19 -11 14 -2 12 Z"),
    horn: new Path2D("M 8 -17 C -4 -31 -22 -41 -48 -46 C -31 -37 -17 -27 0 -12 Z"),
    hornB: new Path2D("M -20 -35 C -25 -46 -23 -54 -16 -62 C -15 -52 -13 -45 -9 -38 Z"),
    upper: new Path2D("M -6 -13 C 2 -21 14 -23 22 -20 C 30 -17 36 -15 46 -13 C 54 -12 60 -12 65 -8 C 69 -5 68 -1 64 1 L 30 3 C 22 5 12 9 4 12 L -6 14 Z"),
    jaw: new Path2D("M 16 3 L 58 6 C 61 8 60 12 56 13 L 26 15 C 16 17 6 17 -4 13 Z"),
    brow: new Path2D("M 12 -16 L 40 -17 L 33 -23 L 28 -19.5 L 22 -28 L 18 -19.5 Z"),
    eye: new Path2D("M 18 -11 C 22 -16 30 -16 34 -12 C 30 -9 22 -8 18 -11 Z"),
    cheek: new Path2D("M 6 4 L -13 9 L 2 10 L -9 19 L 8 13 Z"),
    nose: new Path2D("M 56 -12 C 60 -16 64 -14 63 -10 C 61 -11 59 -11 56 -12 Z"),
  };
  // o: x,y (head), sc, dir (1 faces right), t, len, w0, ang, curl, amp, wave, spd, pal, alpha, glow, simple, jaw
  function drawDragon(ctx, o) {
    const pal = DPAL[o.pal || "fire"];
    const N = o.simple ? 16 : 40;
    const len = o.len || 300, W0 = o.w0 || 16, t = o.t || 0;
    const ds = len / N;
    const px = new Array(N + 1), py = new Array(N + 1), ang = new Array(N + 1), wd = new Array(N + 1);
    let x = 0, y = 0;
    const amp = o.amp != null ? o.amp : 0.5, wave = o.wave || 1.6, spd = o.spd || 3;
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const a = (o.ang || 0) + (o.curl || 0) * s + amp * Math.sin(wave * TAU * s - t * spd) * (0.25 + 0.75 * s);
      ang[i] = a; px[i] = x; py[i] = y;
      wd[i] = W0 * (s < 0.1 ? 0.8 + (0.2 * s) / 0.1 : Math.pow(1 - (s - 0.1) / 0.9, 0.85)) + 0.6;
      x -= Math.cos(a) * ds; y -= Math.sin(a) * ds;
    }
    const nx = (i) => Math.sin(ang[i]), ny = (i) => -Math.cos(ang[i]);
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale((o.sc || 1) * (o.dir || 1), o.sc || 1);
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    // aura
    if (o.glow) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = rgba(pal.glow, 0.13 * (o.glow === true ? 1 : o.glow));
      for (let i = 0; i < N; i += 1) {
        ctx.lineWidth = wd[i] * 2 + 16;
        ctx.beginPath(); ctx.moveTo(px[i], py[i]); ctx.lineTo(px[i + 1], py[i + 1]); ctx.stroke();
      }
      ctx.restore();
    }
    // dorsal fins
    ctx.fillStyle = pal.fin; ctx.strokeStyle = pal.finDark; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 2; i < N - 1; i += o.simple ? 2 : 2) {
      const w = wd[i], fh = w * 0.95 + 3;
      const bx0 = px[i - 1] + nx(i - 1) * wd[i - 1] * 0.7, by0 = py[i - 1] + ny(i - 1) * wd[i - 1] * 0.7;
      const bx1 = px[i + 1] + nx(i + 1) * wd[i + 1] * 0.7, by1 = py[i + 1] + ny(i + 1) * wd[i + 1] * 0.7;
      const tx = px[i] + nx(i) * (w + fh) + Math.cos(ang[i]) * fh * 0.9;
      const ty = py[i] + ny(i) * (w + fh) + Math.sin(ang[i]) * fh * 0.9;
      ctx.moveTo(bx0, by0); ctx.quadraticCurveTo((bx0 + tx) / 2, (by0 + ty) / 2 - 1, tx, ty); ctx.lineTo(bx1, by1);
    }
    ctx.fill(); if (!o.simple) ctx.stroke();
    // legs
    if (!o.simple) {
      [0.2, 0.55].forEach((s, k) => {
        const i = Math.round(s * N), w = wd[i];
        const bx = px[i] - nx(i) * w * 0.5, by = py[i] - ny(i) * w * 0.5;
        const sw = Math.sin(t * 4 + k * 2) * 0.4;
        const kx = bx - nx(i) * w * 1.3 + Math.cos(ang[i]) * w * (0.3 + sw), ky = by - ny(i) * w * 1.3 + Math.sin(ang[i]) * w * (0.3 + sw);
        const fx2 = kx + Math.cos(ang[i]) * w * 0.9, fy2 = ky + Math.sin(ang[i]) * w * 0.9;
        ctx.strokeStyle = pal.dark; ctx.lineWidth = w * 0.62;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(kx, ky); ctx.lineTo(fx2, fy2); ctx.stroke();
        ctx.strokeStyle = pal.body; ctx.lineWidth = w * 0.46;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(kx, ky); ctx.lineTo(fx2, fy2); ctx.stroke();
        ctx.strokeStyle = pal.horn; ctx.lineWidth = 1.6;
        for (let c = -1; c <= 1; c++) {
          const ca = ang[i] + c * 0.5 + 0.4;
          ctx.beginPath(); ctx.moveTo(fx2, fy2);
          ctx.quadraticCurveTo(fx2 + Math.cos(ca) * w * 0.5, fy2 + Math.sin(ca) * w * 0.5, fx2 + Math.cos(ca + 0.6) * w * 0.75, fy2 + Math.sin(ca + 0.6) * w * 0.75);
          ctx.stroke();
        }
      });
    }
    // body
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const X = px[i] + nx(i) * wd[i], Y = py[i] + ny(i) * wd[i]; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
    for (let i = N; i >= 0; i--) ctx.lineTo(px[i] - nx(i) * wd[i], py[i] - ny(i) * wd[i]);
    ctx.closePath();
    ctx.fillStyle = pal.body; ctx.fill();
    ctx.strokeStyle = pal.dark; ctx.lineWidth = 1.5; ctx.stroke();
    // belly band
    ctx.beginPath();
    for (let i = 1; i <= N; i++) { const X = px[i] - nx(i) * wd[i] * 0.96, Y = py[i] - ny(i) * wd[i] * 0.96; i > 1 ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
    for (let i = N; i >= 1; i--) ctx.lineTo(px[i] - nx(i) * wd[i] * 0.3, py[i] - ny(i) * wd[i] * 0.3);
    ctx.closePath(); ctx.fillStyle = pal.belly; ctx.fill();
    if (!o.simple) {
      ctx.strokeStyle = pal.bellyLine; ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let i = 2; i < N; i++) {
        ctx.moveTo(px[i] - nx(i) * wd[i] * 0.95, py[i] - ny(i) * wd[i] * 0.95);
        ctx.lineTo(px[i] - nx(i) * wd[i] * 0.32, py[i] - ny(i) * wd[i] * 0.32);
      }
      ctx.stroke();
      // scales
      ctx.strokeStyle = pal.scale; ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let i = 1; i < N - 1; i++) {
        const w = wd[i];
        for (let r = 0; r < 2; r++) {
          const off = r ? 0.62 : 0.12, sh = (i % 2) * 0.25;
          const cx0 = px[i] + nx(i) * w * (off + sh * 0.3), cy0 = py[i] + ny(i) * w * (off + sh * 0.3);
          const rr = w * 0.3;
          ctx.moveTo(cx0 + Math.cos(ang[i] + 1.9) * rr, cy0 + Math.sin(ang[i] + 1.9) * rr);
          ctx.arc(cx0, cy0, rr, ang[i] + 1.9, ang[i] + 4.4, true);
        }
      }
      ctx.stroke();
    }
    // highlight ribbon along the top
    ctx.strokeStyle = pal.hi;
    for (let i = 0; i < N - 2; i++) {
      ctx.lineWidth = wd[i] * 0.34;
      ctx.beginPath();
      ctx.moveTo(px[i] + nx(i) * wd[i] * 0.55, py[i] + ny(i) * wd[i] * 0.55);
      ctx.lineTo(px[i + 1] + nx(i + 1) * wd[i + 1] * 0.55, py[i + 1] + ny(i + 1) * wd[i + 1] * 0.55);
      ctx.stroke();
    }
    // tail flame
    {
      const i = N, a = ang[N];
      ctx.save(); ctx.translate(px[i], py[i]); ctx.rotate(a + Math.PI / 2);
      ctx.globalCompositeOperation = "lighter";
      for (let k = -1; k <= 1; k++) flameShape(ctx, k * 5, 2, 12, 30 + (k ? 0 : 12) + Math.sin(t * 9 + k) * 5, k * 8, 0.85);
      ctx.restore();
    }
    // head
    {
      const hs = W0 / 16;
      ctx.save(); ctx.translate(px[0], py[0]); ctx.rotate(ang[0]); ctx.scale(hs, hs);
      const jaw = o.jaw != null ? o.jaw : 0.18 + 0.06 * Math.sin(t * 5);
      if (!o.simple) {
        ctx.fillStyle = pal.fin; ctx.strokeStyle = pal.finDark; ctx.lineWidth = 1;
        ctx.fill(HEAD.mane); ctx.stroke(HEAD.mane);
      }
      ctx.fillStyle = pal.hornDark; ctx.save(); ctx.translate(5, -2); ctx.fill(HEAD.horn); ctx.restore();
      ctx.fillStyle = pal.horn; ctx.strokeStyle = pal.hornDark; ctx.lineWidth = 0.8;
      ctx.fill(HEAD.horn); ctx.stroke(HEAD.horn); ctx.fill(HEAD.hornB); ctx.stroke(HEAD.hornB);
      // mouth interior + lower jaw
      ctx.save(); ctx.translate(16, 4); ctx.rotate(jaw); ctx.translate(-16, -4);
      ctx.fillStyle = pal.mouth; ctx.beginPath(); ctx.moveTo(16, 3); ctx.lineTo(64, 0); ctx.lineTo(58, 8); ctx.closePath();
      ctx.restore();
      ctx.save();
      ctx.fillStyle = pal.mouth; ctx.beginPath(); ctx.moveTo(14, 4);
      ctx.lineTo(64, 0); ctx.lineTo(16 + Math.cos(jaw) * 44, 4 + Math.sin(jaw) * 44 + 4); ctx.closePath(); ctx.fill();
      ctx.translate(16, 4); ctx.rotate(jaw); ctx.translate(-16, -4);
      if (!o.simple) {
        ctx.fillStyle = "#fffbe8"; ctx.beginPath();
        for (let tx = 28; tx < 56; tx += 5) { ctx.moveTo(tx, 6); ctx.lineTo(tx + 2.4, 1.8); ctx.lineTo(tx + 4.8, 6); }
        ctx.fill();
      }
      ctx.fillStyle = pal.belly; ctx.strokeStyle = pal.dark; ctx.lineWidth = 1.2;
      ctx.fill(HEAD.jaw); ctx.stroke(HEAD.jaw);
      ctx.restore();
      if (!o.simple) {
        ctx.fillStyle = "#fffbe8"; ctx.beginPath();
        for (let tx = 31; tx < 62; tx += 5) { ctx.moveTo(tx, 1.5); ctx.lineTo(tx + 2.4, 6.5); ctx.lineTo(tx + 4.8, 1.5); }
        ctx.fill();
        ctx.fillStyle = pal.body; ctx.fill(HEAD.cheek);
      }
      const hg = ctx.createLinearGradient(0, -22, 0, 12);
      hg.addColorStop(0, pal.hi.replace(/[\d.]+\)$/, "1)")); hg.addColorStop(0.35, pal.body); hg.addColorStop(1, pal.dark);
      ctx.fillStyle = o.simple ? pal.body : hg; ctx.strokeStyle = pal.dark; ctx.lineWidth = 1.4;
      ctx.fill(HEAD.upper); ctx.stroke(HEAD.upper);
      ctx.fillStyle = pal.dark; ctx.fill(HEAD.brow); ctx.fill(HEAD.nose);
      ctx.fillStyle = pal.eye; ctx.fill(HEAD.eye);
      ctx.fillStyle = "#000"; ctx.fillRect(26, -15, 1.6, 6);
      ctx.globalCompositeOperation = "lighter";
      drawGlow(ctx, pal.glow, 26, -12, o.simple ? 16 : 12, 0.9 * (o.alpha == null ? 1 : o.alpha));
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
      if (!o.simple) {
        // whiskers
        ctx.strokeStyle = pal.fin; ctx.lineWidth = 1.8;
        const wv = Math.sin(t * 3) * 10, wv2 = Math.cos(t * 2.6) * 10;
        ctx.beginPath(); ctx.moveTo(62, -7);
        ctx.bezierCurveTo(40, -40 + wv, 0, -28 - wv, -46, -52 + wv2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(56, 8);
        ctx.bezierCurveTo(30, 34 + wv2, -8, 24 + wv, -52, 42 - wv); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
    // head position in screen space (for effects like fire breath)
    const sc = o.sc || 1, dir = o.dir || 1, hs2 = W0 / 16;
    const mx = px[0] + Math.cos(ang[0]) * 62 * hs2, my = py[0] + Math.sin(ang[0]) * 62 * hs2 + 4 * hs2;
    return { hx: o.x + px[0] * sc * dir, hy: o.y + py[0] * sc, mx: o.x + mx * sc * dir, my: o.y + my * sc };
  }

  // ------------------------------------------------------------------ art: warrior (original silhouette)
  const WAR = {
    cape: "M -46 -134 C -84 -126 -118 -96 -142 -40 L -128 -44 L -140 -8 L -116 -22 L -114 4 L -94 -10 L -84 6 L -62 -4 L -50 0 Z",
    torso: "M -46 2 C -50 -30 -56 -60 -62 -94 C -66 -112 -60 -128 -40 -138 L -12 -148 L 14 -147 L 42 -136 C 60 -126 66 -110 60 -92 C 54 -60 48 -30 44 2 Z",
    neck: "M -10 -146 L -8 -166 L 12 -168 L 16 -146 Z",
    head: "M -14 -170 C -20 -186 -14 -204 4 -208 C 20 -210 30 -200 30 -188 L 37 -178 L 31 -175 C 32 -170 30 -164 26 -160 C 18 -154 6 -154 -2 -158 C -8 -161 -12 -165 -14 -170 Z",
    hair: "M -16 -184 C -32 -194 -46 -192 -62 -186 C -50 -198 -44 -206 -42 -214 C -54 -218 -62 -226 -66 -236 C -48 -230 -34 -232 -24 -236 C -28 -246 -26 -254 -18 -262 C -10 -248 0 -242 8 -240 C 12 -248 18 -254 26 -256 C 24 -244 26 -234 30 -226 C 38 -228 44 -226 52 -220 C 40 -214 34 -208 31 -198 C 22 -206 8 -210 -4 -207 Z",
    padR: "M 28 -136 C 46 -150 74 -144 82 -122 C 84 -110 78 -100 68 -96 C 66 -110 56 -120 38 -122 Z",
    padL: "M -34 -138 C -56 -150 -82 -138 -86 -116 C -86 -104 -80 -98 -72 -96 C -70 -110 -60 -120 -44 -124 Z",
    armR: "M 52 -112 C 68 -96 74 -80 72 -64 C 70 -54 62 -50 54 -52 L 32 -68 C 26 -72 28 -82 34 -84 L 50 -76 C 52 -88 48 -98 44 -106 Z",
    armL: "M -58 -110 C -68 -92 -68 -72 -60 -58 C -52 -50 -38 -52 -26 -60 L 16 -72 C 24 -74 26 -84 20 -88 L -26 -80 C -34 -76 -42 -78 -44 -88 C -46 -98 -50 -104 -52 -112 Z",
    fist: "M 12 -90 C 20 -96 34 -94 38 -86 C 41 -77 35 -70 24 -70 C 15 -70 10 -79 12 -90 Z",
    sash: "M -48 -16 L 46 -18 L 46 -5 L -48 -3 Z",
    band: "M -16 -193 L 31 -197 L 32 -190 L -15 -186 Z",
    lines: "M -30 -120 C -10 -110 20 -110 40 -122 M -36 -72 C -10 -64 20 -64 42 -72 M 40 -128 C 56 -134 70 -128 77 -116 M -40 -130 C -56 -136 -72 -128 -80 -116 M -4 -146 L 2 -112 M -48 -40 C -20 -34 20 -34 44 -40",
  };
  const WARP = {};
  function warPath(k) { return WARP[k] || (WARP[k] = new Path2D(WAR[k])); }
  function warriorBody() {
    const p = new Path2D();
    ["cape", "torso", "neck", "head", "hair", "padR", "padL", "armR", "armL", "fist"].forEach((k) => p.addPath(warPath(k)));
    return p;
  }
  function buildWarrior(variant) {
    const K = 2, ox = 170, oy = 276, w = 280, h = 300;
    const c = mkCanvas(w * K, h * K), g = c.getContext("2d");
    g.scale(K, K); g.translate(ox, oy);
    const body = warriorBody();
    const gold = variant === "gold";
    const rimA = gold ? "#fff0a0" : "#ffb04a", rimB = gold ? "#ffe680" : "#ff5a1a";
    const glow = gold ? "rgba(255,210,80,0.95)" : "rgba(255,90,20,0.9)";
    g.save(); g.shadowColor = glow; g.shadowBlur = 18 * K; g.fillStyle = "#000"; g.fill(body); g.fill(body); g.restore();
    g.save(); g.translate(3.6, -2.2); g.fillStyle = rimA; g.fill(body); g.restore();
    g.save(); g.translate(-3, -1.6); g.fillStyle = rimB; g.globalAlpha = 0.8; g.fill(body); g.restore();
    const df = g.createLinearGradient(0, -260, 0, 0);
    df.addColorStop(0, gold ? "#3a2410" : "#2e1214"); df.addColorStop(0.5, gold ? "#1e1206" : "#160809"); df.addColorStop(1, "#070304");
    g.fillStyle = df; g.fill(body);
    // light from the fire behind (right side) and a cool fill from the left, kept inside the silhouette
    g.save(); g.clip(body);
    const kl = g.createLinearGradient(-60, 0, 90, 0);
    kl.addColorStop(0, "rgba(0,0,0,0)"); kl.addColorStop(0.55, "rgba(0,0,0,0)");
    kl.addColorStop(0.85, gold ? "rgba(255,200,90,0.32)" : "rgba(255,110,30,0.3)"); kl.addColorStop(1, gold ? "rgba(255,230,140,0.55)" : "rgba(255,150,60,0.5)");
    g.fillStyle = kl; g.fillRect(-170, -280, 300, 300);
    const fl = g.createLinearGradient(-150, 0, -20, 0);
    fl.addColorStop(0, gold ? "rgba(255,170,60,0.28)" : "rgba(120,40,160,0.22)"); fl.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = fl; g.fillRect(-170, -280, 300, 300);
    const tl = g.createRadialGradient(10, -200, 5, 10, -200, 90);
    tl.addColorStop(0, gold ? "rgba(255,230,150,0.25)" : "rgba(255,140,60,0.18)"); tl.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = tl; g.fillRect(-170, -280, 300, 300);
    // face lit by the fire in front of him
    const fc = g.createRadialGradient(36, -178, 2, 30, -180, 30);
    fc.addColorStop(0, gold ? "rgba(255,236,170,0.75)" : "rgba(255,170,90,0.7)"); fc.addColorStop(0.5, gold ? "rgba(255,200,100,0.3)" : "rgba(255,110,40,0.28)"); fc.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = fc; g.fillRect(-170, -280, 300, 300);
    g.restore();
    // facial planes (brow, nose, cheek, jaw) picked out by the rim light
    g.strokeStyle = gold ? "rgba(255,240,190,0.85)" : "rgba(255,190,120,0.8)"; g.lineWidth = 1.3; g.lineCap = "round";
    g.beginPath();
    g.moveTo(17, -186.5); g.lineTo(31, -186);
    g.moveTo(32, -183); g.lineTo(36.5, -178.5); g.lineTo(32, -176.5);
    g.moveTo(29, -170); g.quadraticCurveTo(27, -163, 19, -159.5);
    g.moveTo(22, -171); g.lineTo(27, -170);
    g.stroke();
    // armour detail
    g.lineCap = "round";
    g.strokeStyle = gold ? "rgba(255,210,110,0.6)" : "rgba(255,110,50,0.5)"; g.lineWidth = 1.5;
    g.stroke(warPath("lines")); g.stroke(warPath("padR")); g.stroke(warPath("padL")); g.stroke(warPath("armR"));
    g.strokeStyle = gold ? "rgba(255,240,180,0.45)" : "rgba(255,170,90,0.4)"; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-28, -232); g.quadraticCurveTo(-36, -214, -50, -200);
    g.moveTo(-10, -246); g.quadraticCurveTo(-12, -226, -24, -212);
    g.moveTo(12, -240); g.quadraticCurveTo(8, -224, 0, -212);
    g.moveTo(34, -224); g.quadraticCurveTo(26, -212, 18, -206);
    g.stroke();
    g.fillStyle = gold ? "#b07a10" : "#9a0c0c"; g.fill(warPath("sash")); g.fill(warPath("band"));
    g.strokeStyle = gold ? "rgba(255,240,170,0.8)" : "rgba(255,140,70,0.75)"; g.lineWidth = 0.9; g.stroke(warPath("band")); g.stroke(warPath("sash"));
    return { c, w, h, ox, oy };
  }
  function warriorSpr(v) { const k = "war_" + v; return cache[k] || (cache[k] = buildWarrior(v)); }
  // o: x,y (bottom centre), sc, flip, sword (rad), t, alpha, rim:'fire'|'gold', dim, aura
  function drawWarrior(ctx, o) {
    const sc = o.sc || 1, t = o.t || 0;
    ctx.save();
    ctx.translate(o.x, o.y); ctx.rotate(o.rot || 0); ctx.scale(sc * (o.flip ? -1 : 1), sc);
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    if (o.aura) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      const ac = o.rim === "gold" ? C.gold : C.orange;
      drawGlow(ctx, ac, -10, -120, 190, 0.35 * o.aura * (0.85 + 0.15 * Math.sin(t * 9)));
      ctx.restore(); ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    }
    // headband ribbons
    ctx.strokeStyle = "#a80c0c"; ctx.lineCap = "round";
    for (let k = 0; k < 2; k++) {
      ctx.beginPath(); ctx.moveTo(-14, -190 + k * 3);
      for (let j = 1; j <= 12; j++) {
        const X = -14 - j * 7.5, Y = -190 + k * 3 + j * (1.4 + k * 0.8) + Math.sin(j * 0.7 - t * 9 + k) * j * 0.55;
        ctx.lineTo(X, Y);
      }
      ctx.lineWidth = 3.4 - k; ctx.stroke();
    }
    const sp = warriorSpr(o.rim === "gold" ? "gold" : "fire");
    ctx.drawImage(sp.c, -sp.ox, -sp.oy, sp.w, sp.h);
    if (o.dim) {
      if (!sp.dark) { sp.dark = mkCanvas(sp.c.width, sp.c.height); const dg = sp.dark.getContext("2d"); dg.drawImage(sp.c, 0, 0); dg.globalCompositeOperation = "source-in"; dg.fillStyle = "#050208"; dg.fillRect(0, 0, sp.dark.width, sp.dark.height); }
      ctx.globalAlpha = (o.alpha == null ? 1 : o.alpha) * o.dim * 0.8; ctx.drawImage(sp.dark, -sp.ox, -sp.oy, sp.w, sp.h);
      ctx.globalAlpha = (o.alpha == null ? 1 : o.alpha) * (1 - o.dim * 0.6);
    }
    // sword
    const sw = o.sword == null ? -1.05 : o.sword;
    ctx.save(); ctx.translate(25, -80); ctx.rotate(sw);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = o.rim === "gold" ? "rgba(255,220,120,0.45)" : "rgba(255,140,60,0.4)"; ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(186, 0); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#1a0a06"; ctx.fillRect(-16, -3.5, 36, 7);
    ctx.strokeStyle = "#8a1a0a"; ctx.lineWidth = 1.2;
    ctx.beginPath(); for (let i = -14; i < 18; i += 5) { ctx.moveTo(i, -3.5); ctx.lineTo(i + 3, 3.5); } ctx.stroke();
    ctx.fillStyle = "#d8a030"; ctx.beginPath(); ctx.ellipse(21, 0, 3, 10, 0, 0, TAU); ctx.fill();
    const bg = ctx.createLinearGradient(0, -4, 0, 4);
    bg.addColorStop(0, "#ffffff"); bg.addColorStop(0.45, "#cfd8e4"); bg.addColorStop(0.55, "#7a8698"); bg.addColorStop(1, "#e8eef6");
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(23, -3.6); ctx.lineTo(176, -2.4); ctx.lineTo(192, 0.6); ctx.lineTo(176, 2.8); ctx.lineTo(23, 3.6); ctx.closePath(); ctx.fill();
    ctx.restore();
    // eyes
    if (o.dim == null || o.dim < 0.6) {
      ctx.globalCompositeOperation = "lighter";
      const ec = o.rim === "gold" ? C.gold : "255,220,120";
      drawGlow(ctx, ec, 25, -184, 10, 0.95);
      ctx.fillStyle = "#fffbe0"; ctx.globalAlpha = 1;
      ctx.fillRect(21, -185, 8, 2); ctx.fillRect(31, -184.5, 3, 1.6);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ art: effects
  function lightning(ctx, x0, y0, x1, y1, seed, c, w, a) {
    const pts = [[x0, y0]];
    const n = 9, dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
    for (let i = 1; i < n; i++) {
      const f = i / n, off = (hash1(seed * 31 + i) - 0.5) * L * 0.22;
      pts.push([x0 + dx * f + nx * off, y0 + dy * f + ny * off]);
    }
    pts.push([x1, y1]);
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = a == null ? 1 : a;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    [[w * 4, rgba(c, 0.18)], [w * 2, rgba(c, 0.5)], [w * 0.8, "rgba(255,255,255,0.95)"]].forEach((s) => {
      ctx.strokeStyle = s[1]; ctx.lineWidth = s[0]; ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
    });
    ctx.restore();
  }
  function slashArc(ctx, cx, cy, r, a0, a1, wdt, u, c) {
    // crescent sweeping from a0 to a1; u = progress 0..1 (draw-on then fade)
    const head = clamp(u * 1.6, 0, 1), tail = clamp((u - 0.35) * 1.6, 0, 1);
    if (head <= tail) return;
    const s0 = lerp(a0, a1, tail), s1 = lerp(a0, a1, head);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const steps = 24;
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const f = i / steps, a = lerp(s0, s1, f), ww = wdt * Math.sin(f * Math.PI) * (pass ? 0.45 : 1);
        const X = cx + Math.cos(a) * (r + ww), Y = cy + Math.sin(a) * (r + ww);
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      }
      for (let i = steps; i >= 0; i--) {
        const a = lerp(s0, s1, i / steps);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fillStyle = pass ? "rgba(255,255,255,0.95)" : rgba(c, 0.75);
      ctx.fill();
    }
    ctx.restore();
  }
  function speedLines(ctx, cx, cy, n, c, a, r0, seed) {
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = rgba(c, a); ctx.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const h1 = hash1(seed * 977 + i * 13), h2 = hash1(seed * 131 + i * 7 + 3), h3 = hash1(i * 29 + seed);
      const ang = h1 * TAU, ra = r0 + h2 * 60, rb = 460;
      ctx.lineWidth = 0.6 + h3 * 2.6;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * ra, cy + Math.sin(ang) * ra);
      ctx.lineTo(cx + Math.cos(ang) * rb, cy + Math.sin(ang) * rb); ctx.stroke();
    }
    ctx.restore();
  }
  function hLines(ctx, y0, y1, n, c, a, phase, speed) {
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = rgba(c, a); ctx.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const hy = hash1(i * 53 + 7), hl = hash1(i * 17 + 3), hs = hash1(i * 71 + 11);
      const len = 40 + hl * 140, y = lerp(y0, y1, hy);
      const x = W + 200 - (((phase * speed * (0.7 + hs * 0.6)) + hl * 900) % (W + 400));
      ctx.lineWidth = 0.8 + hs * 2.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
    }
    ctx.restore();
  }
  function ring(ctx, x, y, r, w, c, a) {
    if (a <= 0) return;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = rgba(c, a * 0.35); ctx.lineWidth = w * 3; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.strokeStyle = rgba(c, a); ctx.lineWidth = w; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.restore();
  }
  function hueRgb(h) {
    const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return f(0) + "," + f(8) + "," + f(4);
  }

  // ------------------------------------------------------------------ particles
  const P = { back: [], front: [] };
  function emit(layer, o) {
    const arr = P[layer] || P.front;
    if (arr.length > 650) return null;
    const p = { x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, drag: 0, life: 1, age: 0, s0: 4, s1: 4, a0: 1, a1: 0, rot: 0, vr: 0, type: "glow", col: C.gold, add: true, len: 10, wob: 0, ph: 0, fadeIn: 0 };
    for (const k in o) p[k] = o[k];
    arr.push(p);
    return p;
  }
  function updParticles(dt) {
    for (const k in P) {
      const arr = P[k];
      for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i];
        p.age += dt;
        if (p.age >= p.life) { arr[i] = arr[arr.length - 1]; arr.pop(); continue; }
        p.vx += p.ax * dt; p.vy += p.ay * dt;
        if (p.drag) { const f = Math.max(0, 1 - p.drag * dt); p.vx *= f; p.vy *= f; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.wob) p.x += Math.sin(p.age * 3 + p.ph) * p.wob * dt;
      }
    }
  }
  function drawParticles(ctx, arr) {
    if (!arr.length) return;
    ctx.save();
    let add = null;
    for (const p of arr) {
      const u = p.age / p.life, s = lerp(p.s0, p.s1, u);
      let a = lerp(p.a0, p.a1, u);
      if (p.fadeIn) a *= Math.min(1, p.age / p.fadeIn);
      if (a <= 0.004 || s <= 0) continue;
      if (add !== p.add) { ctx.globalCompositeOperation = p.add ? "lighter" : "source-over"; add = p.add; }
      ctx.globalAlpha = Math.min(1, a);
      switch (p.type) {
        case "glow": ctx.drawImage(glowSpr(p.col), p.x - s, p.y - s, 2 * s, 2 * s); break;
        case "soft": ctx.drawImage(softSpr(p.col), p.x - s, p.y - s, 2 * s, 2 * s); break;
        case "fire": ctx.drawImage(fireSpr(), p.x - s, p.y - s * 1.15, 2 * s, 2.3 * s); break;
        case "star":
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.drawImage(starSpr(p.col), -s, -s, 2 * s, 2 * s); ctx.restore(); break;
        case "spark": {
          const v = Math.hypot(p.vx, p.vy) || 1;
          ctx.strokeStyle = rgba(p.col, 1); ctx.lineWidth = s; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - (p.vx / v) * p.len, p.y - (p.vy / v) * p.len); ctx.stroke();
          break;
        }
        case "shard":
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = rgba(p.col, 1);
          ctx.beginPath(); ctx.moveTo(-s, -s * 0.4); ctx.lineTo(s * 0.8, -s * 0.7); ctx.lineTo(s * 0.3, s * 0.9); ctx.closePath(); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.beginPath(); ctx.moveTo(-s, -s * 0.4); ctx.lineTo(s * 0.8, -s * 0.7); ctx.lineTo(0, -s * 0.2); ctx.closePath(); ctx.fill();
          ctx.restore(); break;
        case "confetti":
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.age * 9 + p.ph));
          ctx.fillStyle = rgba(p.col, 1); ctx.fillRect(-s, -s * 0.5, 2 * s, s); ctx.restore(); break;
        case "smoke": ctx.drawImage(softSpr(p.col), p.x - s, p.y - s, 2 * s, 2 * s); break;
      }
    }
    ctx.restore();
  }
  function burst(layer, x, y, n, o) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(o.v0 || 60, o.v1 || 260);
      emit(layer, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ay: o.g || 0, drag: o.drag == null ? 1.5 : o.drag,
        life: rand(o.l0 || 0.5, o.l1 || 1.1), s0: rand(o.s0 || 1.5, o.s1 || 3.5), s1: o.se == null ? 0.3 : o.se,
        type: o.type || "spark", col: o.cols ? pick(o.cols) : o.col || C.gold, len: rand(6, o.len || 18),
        rot: rand(0, TAU), vr: rand(-8, 8), ph: rand(0, TAU), add: o.add == null ? true : o.add,
      });
    }
  }
  function fireBurst(x, y, n, R, layer) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(30, R || 200);
      emit(layer || "front", { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, ay: -60, drag: 2, life: rand(0.5, 1.1), s0: rand(10, 22), s1: rand(26, 40), a0: 0.95, a1: 0, type: "fire" });
    }
  }

  // ------------------------------------------------------------------ reels
  function makeReel(i) {
    return { i, pos: 0, vel: 0, vT: 0, acc: 8, st: "stop", s0: 0, sT: 0, sP0: 0, sV0: 0, sP1: 0, bT0: -9, bA: 0, kT0: -9, lay: { x: 0, y: 0, s: 1, a: 1 }, ov: null, fT0: -9, dim: 0, glow: 0 };
  }
  const reels = [makeReel(0), makeReel(1), makeReel(2)];
  const digitAt = (idx) => ((((Math.round(idx) % 9) + 9) % 9) + 1);
  const LAY = {
    normal: [[84, 172, 0.86, 1], [196, 172, 0.86, 1], [308, 172, 0.86, 1]],
    reach: [[48, 128, 0.52, 1], [196, 180, 1.28, 1], [344, 128, 0.52, 1]],
    corner: [[44, 62, 0.27, 1], [74, 62, 0.27, 1], [104, 62, 0.27, 1]],   // below the battle HP bars
    spFinal: [[46, 108, 0.44, 1], [196, 180, 1.42, 1], [346, 108, 0.44, 1]],
    hit: [[82, 170, 0.94, 1], [196, 170, 0.94, 1], [310, 170, 0.94, 1]],
    jackpot: [[76, 170, 1.06, 1], [196, 170, 1.06, 1], [316, 170, 1.06, 1]],
    hidden: [[84, 172, 0.86, 0], [196, 172, 0.86, 0], [308, 172, 0.86, 0]],
    rushN: [[94, 188, 0.74, 1], [196, 188, 0.74, 1], [298, 188, 0.74, 1]],
  };
  function layout(name, dur, ease) {
    const PL = LAY[name];
    reels.forEach((r, i) => tween(r.lay, { x: PL[i][0], y: PL[i][1], s: PL[i][2], a: PL[i][3] }, dur, ease || E.out));
  }
  function reelSpin(r, v) {
    if (r.st === "stop") r.kT0 = clk.t;
    r.st = "spin"; r.vT = v || 16; r.acc = 9; r.dim = 0;
  }
  function reelSpeed(r, v, acc) { r.vT = v; r.acc = acc || 3; }
  function reelSet(r, d) { r.st = "stop"; r.vel = 0; r.pos = d - 1 + 9 * Math.round(r.pos / 9); r.ov = null; r.bA = 0; }
  // Stop the reel on digit d (or 'NEXT' = the 続 symbol). Resolves when it lands.
  function reelStop(r, d, T) {
    T = T || 0.3;
    const v0 = Math.max(r.vel, 0.6);
    let target;
    if (v0 > 8) {
      // fast + blurred: shift the phase so the natural deceleration lands exactly
      const Dn = (v0 * T) / 2;
      const want = r.pos + Dn;
      if (d === "NEXT") target = Math.round(want);
      else { target = Math.round(want); let best = 99; for (let k = target - 5; k <= target + 5; k++) if (digitAt(k) === d && Math.abs(k - want) < Math.abs(best - want)) best = k; target = best; }
      r.pos = target - Dn;
    } else {
      const minD = Math.max(0.35, v0 * T * 0.36);
      target = Math.ceil(r.pos + minD);
      if (d !== "NEXT") while (digitAt(target) !== d) target++;
    }
    if (d === "NEXT") r.ov = { idx: target };
    const D = target - r.pos;
    const Tn = v0 > 8 ? T : clamp((2 * D) / v0, T * 0.7, T * 2.0);
    r.st = "stopping"; r.s0 = clk.t; r.sT = Tn; r.sP0 = r.pos; r.sV0 = v0; r.sP1 = target;
    return wait(Tn);
  }
  function updReel(r, dt) {
    if (r.st === "spin") {
      r.vel += (r.vT - r.vel) * Math.min(1, dt * r.acc);
      r.pos += r.vel * dt;
      if (r.ov && r.pos > r.ov.idx + 2) r.ov = null;
    } else if (r.st === "stopping") {
      const u = (clk.t - r.s0) / r.sT;
      if (u >= 1) {
        r.st = "stop"; r.pos = r.sP1; r.bT0 = clk.t; r.bA = clamp(r.sV0 / 30, 0.04, 0.16); r.fT0 = clk.t; r.vel = 0;
      } else {
        const h10 = u * u * u - 2 * u * u + u, h01 = -2 * u * u * u + 3 * u * u;
        const h10d = 3 * u * u - 4 * u + 1, h01d = -6 * u * u + 6 * u;
        r.pos = r.sP0 + r.sV0 * r.sT * h10 + (r.sP1 - r.sP0) * h01;
        r.vel = (r.sV0 * r.sT * h10d + (r.sP1 - r.sP0) * h01d) / r.sT;
      }
    }
  }
  function reelOffset(r) {
    let off = 0;
    const tb = clk.t - r.bT0;
    if (tb >= 0 && tb < 0.45) off += r.bA * Math.exp(-tb * 11) * Math.sin(tb * TAU * 4.2);
    const tk = clk.t - r.kT0;
    if (tk >= 0 && tk < 0.14) off -= 0.16 * Math.sin((tk / 0.14) * Math.PI);
    return off;
  }
  function drawReel(ctx, r, pulse) {
    const lay = r.lay;
    if (lay.a <= 0.01 || !SPR.dig[1]) return;
    const s = lay.s * (pulse || 1), cell = DIG_H * 1.1 * s;
    const pos = r.pos + reelOffset(r);
    const v = Math.abs(r.vel);
    const blur = r.st === "stop" ? 0 : clamp((v - 3.5) / 6, 0, 1);
    const base = Math.floor(pos);
    for (let k = base - 1; k <= base + 2; k++) {
      const off = pos - k, fall = Math.abs(off);
      if (r.st === "stop" && fall > 0.5) continue;
      let a = lay.a * clamp(1 - fall * 1.12, 0, 1) * (1 - r.dim * 0.55);
      if (a <= 0.01) continue;
      const y = lay.y + off * cell;
      const sp = r.ov && r.ov.idx === k ? SPR.next : SPR.dig[digitAt(k)];
      if (r.glow > 0 && fall < 0.5) {
        ctx.globalCompositeOperation = "lighter";
        drawGlow(ctx, sp === SPR.next ? C.green : digitAt(k) === 7 ? C.gold : digitAt(k) % 2 ? C.red : C.blue, lay.x, y, 70 * s, r.glow * a * (0.5 + 0.3 * Math.sin(clk.t * 9)));
        ctx.globalCompositeOperation = "source-over";
      }
      if (blur < 1) { ctx.globalAlpha = a * (1 - blur); drawSpr(ctx, sp, lay.x, y, s); }
      if (blur > 0) { ctx.globalAlpha = a * blur * 0.95; drawSpr(ctx, sp.blur, lay.x, y, s); }
      // landing flash
      const tf = clk.t - r.fT0;
      if (tf >= 0 && tf < 0.3 && fall < 0.5) {
        ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = a * 0.75 * (1 - tf / 0.3);
        drawSpr(ctx, sp, lay.x, y, s); ctx.globalCompositeOperation = "source-over";
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ holds (保留)
  const HOLD_SLOT_X = (i) => 160 - i * 27, HOLD_Y = 300;
  let holdView = [];       // [{c, x, born}]
  let holdSrc = { holds: [], rush: [] };
  const ped = { c: null, a: 0, x: CX, y: 298, s: 1, t0: -9, chT0: -9 };
  function holdSpr(c, hueStep) {
    const key = "h" + c + (c === "rainbow" ? hueStep : "");
    if (cache[key]) return cache[key];
    const K = 2.4, R = 16, S = R * 3;
    const cv = mkCanvas(S * K, S * K), g = cv.getContext("2d");
    g.scale(K, K); g.translate(S / 2, S / 2);
    const rgb = c === "rainbow" ? hueRgb(hueStep * 30) : HOLD_RGB[c] || C.blue;
    const glowA = c === "blue" ? 0.45 : c === "white" ? 0.4 : 0.85;
    g.drawImage(glowSpr(rgb), -R * 1.45, -R * 1.45, R * 2.9, R * 2.9);
    g.globalAlpha = glowA; g.drawImage(glowSpr(rgb), -R * 1.45, -R * 1.45, R * 2.9, R * 2.9); g.globalAlpha = 1;
    g.fillStyle = "#120600"; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
    const rim = g.createLinearGradient(-R, -R, R, R);
    if (c === "gold" || c === "rainbow") { rim.addColorStop(0, "#fffbe0"); rim.addColorStop(0.4, "#ffc21a"); rim.addColorStop(0.7, "#8a5000"); rim.addColorStop(1, "#ffe48a"); }
    else { rim.addColorStop(0, "#ffffff"); rim.addColorStop(0.4, "#b8c4d4"); rim.addColorStop(0.7, "#4a5668"); rim.addColorStop(1, "#e4ecf4"); }
    g.fillStyle = rim; g.beginPath(); g.arc(0, 0, R * 0.92, 0, TAU); g.fill();
    const [r0, g0, b0] = rgb.split(",").map(Number);
    const lite = "rgb(" + Math.min(255, r0 + 120) + "," + Math.min(255, g0 + 120) + "," + Math.min(255, b0 + 120) + ")";
    const dark = "rgb(" + Math.round(r0 * 0.3) + "," + Math.round(g0 * 0.3) + "," + Math.round(b0 * 0.3) + ")";
    const orb = g.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.05, 0, 0, R * 0.8);
    orb.addColorStop(0, "#ffffff"); orb.addColorStop(0.2, lite); orb.addColorStop(0.6, "rgb(" + rgb + ")"); orb.addColorStop(1, dark);
    g.fillStyle = orb; g.beginPath(); g.arc(0, 0, R * 0.76, 0, TAU); g.fill();
    if (c === "rainbow" && g.createConicGradient) {
      const cg = g.createConicGradient((hueStep / 12) * TAU, 0, 0);
      for (let i = 0; i <= 6; i++) cg.addColorStop(i / 6, "hsl(" + i * 60 + ",100%,55%)");
      g.fillStyle = cg; g.beginPath(); g.arc(0, 0, R * 0.76, 0, TAU); g.fill();
      const sh = g.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.05, 0, 0, R * 0.8);
      sh.addColorStop(0, "rgba(255,255,255,0.95)"); sh.addColorStop(0.35, "rgba(255,255,255,0.15)"); sh.addColorStop(1, "rgba(0,0,0,0.45)");
      g.fillStyle = sh; g.beginPath(); g.arc(0, 0, R * 0.76, 0, TAU); g.fill();
    }
    // flame emblem
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.beginPath(); g.moveTo(0, -R * 0.5); g.bezierCurveTo(R * 0.4, -R * 0.1, R * 0.32, R * 0.42, 0, R * 0.46);
    g.bezierCurveTo(-R * 0.32, R * 0.42, -R * 0.36, 0, -R * 0.1, -R * 0.18); g.bezierCurveTo(-R * 0.08, -R * 0.3, 0, -R * 0.36, 0, -R * 0.5); g.fill();
    g.fillStyle = "rgba(255,255,255,0.6)"; g.beginPath(); g.ellipse(-R * 0.22, -R * 0.38, R * 0.3, R * 0.14, -0.5, 0, TAU); g.fill();
    return (cache[key] = { c: cv, S });
  }
  function drawHoldIcon(ctx, c, x, y, r, a) {
    if (a <= 0.01) return;
    const hs = Math.floor(clk.t * 10) % 12;
    const sp = holdSpr(c, hs);
    const sz = (sp.S * r) / 16;
    ctx.globalAlpha = a;
    ctx.drawImage(sp.c, x - sz / 2, y - sz / 2, sz, sz);
    if (c === "gold" || c === "rainbow" || c === "red") {
      const ph = (clk.t * 1.3 + x * 0.01) % 1;
      if (c !== "red") star4(ctx, x + r * 0.55, y - r * 0.55, r * 0.55 * Math.sin(ph * Math.PI), a);
      ctx.globalCompositeOperation = "lighter";
      drawGlow(ctx, c === "rainbow" ? hueRgb(clk.t * 300) : HOLD_RGB[c], x, y, r * 2.2, a * (0.25 + 0.2 * Math.sin(clk.t * 8)));
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = 1;
  }
  function setHoldView(arr) {
    const cols = (arr || []).map((h) => (h && h.color) || "blue");
    const old = holdView.map((h) => h.c);
    let shift = 0;
    for (let s = 0; s <= old.length; s++) {
      let ok = true;
      for (let i = 0; i + s < old.length && i < cols.length; i++) if (old[i + s] !== cols[i]) { ok = false; break; }
      if (ok) { shift = s; break; }
    }
    const nv = [];
    for (let i = 0; i < cols.length; i++) {
      const prev = holdView[i + shift];
      if (prev && prev.c === cols[i]) nv.push(prev);
      else if (prev) { prev.c = cols[i]; prev.chT0 = clk.t; nv.push(prev); }
      else nv.push({ c: cols[i], x: HOLD_SLOT_X(i), born: clk.t, chT0: -9 });
    }
    holdView = nv;
  }
  function drawHolds(ctx) {
    if (fx.holdsA <= 0.01) return;
    const A = fx.holdsA;
    // pedestal
    ctx.save();
    const pa = A * Math.max(0.35, ped.a);
    const pg = ctx.createLinearGradient(0, ped.y + 4, 0, ped.y + 16);
    pg.addColorStop(0, "#fff0a0"); pg.addColorStop(0.4, "#c07a10"); pg.addColorStop(1, "#3a1a00");
    ctx.globalAlpha = pa; ctx.fillStyle = pg;
    ctx.beginPath(); ctx.ellipse(ped.x, ped.y + 10, 24, 7, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(255,240,180,0.9)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.globalCompositeOperation = "lighter";
    drawGlow(ctx, C.orange, ped.x, ped.y + 9, 30, pa * 0.45);
    ctx.globalCompositeOperation = "source-over";
    if (ped.c && ped.a > 0.01) {
      const tp = clk.t - ped.t0;
      const sIn = tp < 0.3 ? E.back(clamp(tp / 0.3, 0, 1)) : 1;
      const bob = Math.sin(clk.t * 3) * 1.2;
      drawHoldIcon(ctx, ped.c, ped.x, ped.y - 3 + bob, 13 * ped.s * sIn, A * ped.a);
      const tc = clk.t - ped.chT0;
      if (tc >= 0 && tc < 0.6) ring(ctx, ped.x, ped.y - 3, 14 + tc * 70, 3 * (1 - tc / 0.6), HOLD_RGB[ped.c] || C.white, 1 - tc / 0.6);
    }
    // pending holds
    holdView.forEach((h, i) => {
      const tx = HOLD_SLOT_X(i);
      h.x += (tx - h.x) * 0.22;
      if (Math.abs(tx - h.x) < 0.05) h.x = tx;
      const tb = clk.t - h.born;
      const sIn = tb < 0.28 ? E.back(clamp(tb / 0.28, 0, 1)) : 1;
      drawHoldIcon(ctx, h.c, h.x, HOLD_Y, 10 * sIn, A);
      const tc = clk.t - (h.chT0 || -9);
      if (tc >= 0 && tc < 0.5) ring(ctx, h.x, HOLD_Y, 10 + tc * 50, 2, HOLD_RGB[h.c] || C.white, 1 - tc / 0.5);
    });
    // empty slot markers
    ctx.globalAlpha = A * 0.35; ctx.fillStyle = "#000";
    for (let i = holdView.length; i < 4; i++) { ctx.beginPath(); ctx.arc(HOLD_SLOT_X(i), HOLD_Y, 4, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  // ------------------------------------------------------------------ fx state
  const fx = { shake: 0, sx: 0, sy: 0, flashA: 0, flashC: C.white, flashD: 3, dim: 0, gray: 0, vign: 0, vignC: C.red, vignP: 0, logoA: 1, logoY: 0, logoS: 1, holdsA: 1, tint: 0, tintC: C.orange };
  function flash(c, a, decay) { fx.flashC = c || C.white; fx.flashA = Math.max(fx.flashA, (a == null ? 1 : a) * (reduced ? 0.5 : 1)); fx.flashD = decay || 3; }
  function shake(a) { fx.shake = Math.max(fx.shake, a * (reduced ? 0.3 : 1)); }

  // ------------------------------------------------------------------ actors
  let actors = [];
  function addActor(layer, dur, draw, extra) {
    const a = { t0: clk.t, dur: dur == null ? Infinity : dur, layer, draw, kill: false };
    if (extra) for (const k in extra) a[k] = extra[k];
    actors.push(a);
    return a;
  }
  function drawActors(ctx, layer) {
    for (const a of actors) {
      if (a.layer !== layer || a.kill) continue;
      const age = clk.t - a.t0;
      ctx.save(); a.draw(ctx, age, a); ctx.restore();
    }
  }
  function killSeqActors() { actors.forEach((a) => { if (a.seq) a.kill = true; }); }

  // ------------------------------------------------------------------ backgrounds (static parts)
  const BGK = { normal: 1.4, sp: 1.2, battle: 1.3, rush: 0.7, jitan: 0.7, bonus: 0.7, spsp: 0.8, jackpot: 0.7, result: 0.8 };
  function bgSprite(id) {
    const key = "bg_" + id;
    if (cache[key]) return cache[key];
    const K = BGK[id] || 1, c = mkCanvas((W + 24) * K, (H + 24) * K), g = c.getContext("2d");
    g.scale(K, K); g.translate(12, 12);
    const save = rng; rng = mulberry32(1234 + id.length * 77);
    (BGB[id] || BGB.normal)(g, K);
    rng = save;
    return (cache[key] = c);
  }
  function drawBg(ctx, id) { ctx.drawImage(bgSprite(id), -12, -12, W + 24, H + 24); }
  // A scene's AI background when there is one (the result screen shares the bonus one), else the
  // drawn one.
  function sceneBg(ctx, id) {
    const im = IMG["bg_" + (id === "result" ? "bonus" : id)];
    if (im) drawCover(ctx, im, -12, -12, W + 24, H + 24); else drawBg(ctx, id);
  }
  function ridge(g, base, amp, freq, seed, fill, rim) {
    g.beginPath(); g.moveTo(-14, H + 14);
    for (let x = -14; x <= W + 14; x += 3) {
      const n = Math.abs(Math.sin(x * freq + seed)) * 0.55 + Math.abs(Math.sin(x * freq * 2.7 + seed * 2.1)) * 0.3 + Math.sin(x * freq * 7.3 + seed) * 0.08;
      g.lineTo(x, base - amp * n);
    }
    g.lineTo(W + 14, H + 14); g.closePath();
    g.fillStyle = fill; g.fill();
    if (rim) { g.strokeStyle = rim; g.lineWidth = 1.2; g.stroke(); }
  }
  function pagoda(g, x, y, s, col) {
    g.fillStyle = col;
    for (let i = 0; i < 4; i++) {
      const w = (34 - i * 6) * s, yy = y - i * 13 * s;
      g.beginPath(); g.moveTo(x - w, yy); g.quadraticCurveTo(x - w * 0.6, yy - 3 * s, x - w * 0.55, yy - 6 * s);
      g.lineTo(x + w * 0.55, yy - 6 * s); g.quadraticCurveTo(x + w * 0.6, yy - 3 * s, x + w, yy); g.closePath(); g.fill();
      g.fillRect(x - w * 0.42, yy - 1, w * 0.84, 8 * s);
    }
    g.fillRect(x - 1 * s, y - 62 * s, 2 * s, 14 * s);
  }
  function clouds(g, y, n, col, w0, h0) {
    for (let i = 0; i < n; i++) {
      const x = rand(-40, W + 40), yy = y + rand(-14, 14), w = rand(w0 * 0.6, w0 * 1.4), h = rand(h0 * 0.6, h0 * 1.3);
      const gr = g.createRadialGradient(x, yy, 0, x, yy, w);
      gr.addColorStop(0, col); gr.addColorStop(1, col.replace(/[\d.]+\)$/, "0)"));
      g.fillStyle = gr; g.save(); g.translate(x, yy); g.scale(1, h / w); g.translate(-x, -yy);
      g.beginPath(); g.arc(x, yy, w, 0, TAU); g.fill(); g.restore();
    }
  }
  function vGrad(g, stops) {
    const gr = g.createLinearGradient(0, -12, 0, H + 12);
    stops.forEach((s) => gr.addColorStop(s[0], s[1]));
    g.fillStyle = gr; g.fillRect(-12, -12, W + 24, H + 24);
  }
  function rGrad(g, x, y, r, stops) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    stops.forEach((s) => gr.addColorStop(s[0], s[1]));
    g.fillStyle = gr; g.fillRect(-12, -12, W + 24, H + 24);
  }
  const BGB = {
    normal(g, K) {
      vGrad(g, [[0, "#14020a"], [0.3, "#3a0614"], [0.55, "#7a160e"], [0.72, "#c4420e"], [0.82, "#6a1404"], [1, "#160200"]]);
      const sun = g.createRadialGradient(CX, 168, 10, CX, 168, 190);
      sun.addColorStop(0, "rgba(255,210,120,0.75)"); sun.addColorStop(0.25, "rgba(255,120,30,0.45)"); sun.addColorStop(1, "rgba(255,60,0,0)");
      g.fillStyle = sun; g.fillRect(-12, -12, W + 24, H + 24);
      clouds(g, 70, 14, "rgba(60,8,18,0.55)", 70, 16);
      clouds(g, 118, 12, "rgba(120,24,10,0.45)", 60, 12);
      ridge(g, 238, 70, 0.012, 1.3, "#4a0c12", "rgba(255,140,60,0.45)");
      pagoda(g, 300, 200, 0.9, "#2a0408");
      pagoda(g, 82, 214, 0.6, "#2a0408");
      ridge(g, 268, 60, 0.018, 4.1, "#1c0306", "rgba(255,100,30,0.6)");
      const gr = g.createLinearGradient(0, 270, 0, H + 12);
      gr.addColorStop(0, "rgba(10,0,0,0)"); gr.addColorStop(1, "#080000"); g.fillStyle = gr; g.fillRect(-12, 270, W + 24, 70);
      // lava cracks
      g.save(); g.shadowColor = "rgba(255,90,0,1)"; g.shadowBlur = 6 * K; g.strokeStyle = "rgba(255,150,40,0.9)"; g.lineWidth = 1.3;
      for (let i = 0; i < 9; i++) {
        let x = rand(0, W), y = rand(286, 330);
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 6; k++) { x += rand(-22, 22); y += rand(-5, 5); g.lineTo(x, y); }
        g.stroke();
      }
      g.restore();
    },
    sp(g, K) {
      vGrad(g, [[0, "#02030a"], [0.3, "#08183a"], [0.6, "#1c1648"], [0.82, "#4a0c22"], [1, "#0a0004"]]);
      // moon
      rGrad(g, 292, 84, 170, [[0, "rgba(200,225,255,0.55)"], [0.3, "rgba(90,130,220,0.22)"], [1, "rgba(0,0,0,0)"]]);
      const mg = g.createRadialGradient(282, 74, 4, 292, 84, 46);
      mg.addColorStop(0, "#ffffff"); mg.addColorStop(0.6, "#dfeaff"); mg.addColorStop(1, "#8aa6d8");
      g.save(); g.shadowColor = "rgba(180,210,255,0.9)"; g.shadowBlur = 24 * K;
      g.fillStyle = mg; g.beginPath(); g.arc(292, 84, 44, 0, TAU); g.fill(); g.restore();
      g.fillStyle = "rgba(120,140,190,0.35)";
      [[278, 70, 8], [304, 96, 11], [300, 66, 5], [270, 98, 6]].forEach((m) => { g.beginPath(); g.arc(m[0], m[1], m[2], 0, TAU); g.fill(); });
      clouds(g, 96, 16, "rgba(14,22,52,0.85)", 80, 16);
      clouds(g, 40, 14, "rgba(30,40,90,0.6)", 70, 14);
      clouds(g, 250, 18, "rgba(60,14,44,0.7)", 90, 20);
      ridge(g, 296, 46, 0.016, 2.2, "#06030e", "rgba(140,180,255,0.5)");
      pagoda(g, 70, 270, 0.7, "#06030e");
    },
    battle(g, K) {
      vGrad(g, [[0, "#120004"], [0.35, "#3a0606"], [0.62, "#9a2a08"], [0.72, "#ff8a2a"], [0.76, "#5a1004"], [1, "#0e0101"]]);
      clouds(g, 60, 16, "rgba(20,2,4,0.75)", 80, 18);
      clouds(g, 150, 10, "rgba(200,60,10,0.25)", 70, 10);
      // ruins
      g.fillStyle = "#140202";
      for (let i = 0; i < 8; i++) {
        const x = i * 54 + rand(-10, 10), h = rand(14, 48), w = rand(10, 26);
        g.fillRect(x, 232 - h, w, h + 4);
        g.beginPath(); g.moveTo(x - 3, 232 - h); g.lineTo(x + w / 2, 232 - h - rand(4, 12)); g.lineTo(x + w + 3, 232 - h); g.fill();
      }
      ridge(g, 246, 18, 0.03, 3.3, "#0a0101", "rgba(255,120,30,0.7)");
      g.save(); g.shadowColor = "rgba(255,90,0,1)"; g.shadowBlur = 5 * K; g.strokeStyle = "rgba(255,140,40,0.85)"; g.lineWidth = 1.2;
      for (let i = 0; i < 7; i++) {
        let x = rand(0, W), y = rand(262, 320); g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 5; k++) { x += rand(-20, 20); y += rand(-4, 4); g.lineTo(x, y); }
        g.stroke();
      }
      g.restore();
    },
    rush(g) {
      rGrad(g, CX, 160, 300, [[0, "#f0fcff"], [0.08, "#7ae0ff"], [0.24, "#2a6cf0"], [0.5, "#1c147a"], [0.8, "#0a0330"], [1, "#04001a"]]);
    },
    jitan(g) {
      rGrad(g, CX, 160, 300, [[0, "#fff2d6"], [0.08, "#ffb04a"], [0.26, "#d0306a"], [0.55, "#4a0a5a"], [1, "#0e0016"]]);
    },
    bonus(g) {
      rGrad(g, CX, 160, 300, [[0, "#fffbe4"], [0.1, "#ffd44a"], [0.3, "#ff8a1a"], [0.6, "#a8180a"], [1, "#200200"]]);
    },
    spsp(g) {
      rGrad(g, CX, 200, 320, [[0, "#ffe9a0"], [0.15, "#ff8a1a"], [0.38, "#c8140a"], [0.7, "#3a0002"], [1, "#0a0000"]]);
    },
    jackpot(g) {
      rGrad(g, CX, 170, 300, [[0, "#ffffff"], [0.12, "#fff2a8"], [0.3, "#ffb81a"], [0.6, "#d2400a"], [1, "#3a0600"]]);
    },
    result(g) {
      rGrad(g, CX, 150, 300, [[0, "#3a5ab0"], [0.35, "#141c5a"], [1, "#03030f"]]);
    },
  };

  // ------------------------------------------------------------------ scenes (animated)
  let scene = { id: "normal", t0: 0, opt: {} }, prevScene = null, fadeT0 = 0, fadeDur = 0;
  function setScene(id, fade, opt) {
    if (scene.id === id && !opt) return;
    prevScene = scene; scene = { id, t0: clk.t, opt: opt || {} }; fadeT0 = clk.t; fadeDur = fade || 0;
    if (!fadeDur) prevScene = null;
  }
  const baseLay = () => (mode === "rush" || mode === "jitan" ? "rushN" : "normal");
  const modeScene = () => (mode === "rush" ? "rush" : mode === "jitan" ? "jitan" : mode === "bonus" ? "bonus" : "normal");
  const SCN = {
    normal: {
      draw(ctx, age) {
        if (IMG.bg_normal) drawCover(ctx, IMG.bg_normal, -12, -12, W + 24, H + 24); else drawBg(ctx, "normal");
        drawRays(ctx, CX, 150, C.orange, age * 0.05, 0.16, 430, 18, true);
        // a shadow dragon drifting through the clouds of the drawn sky (the AI background has its
        // own scenery, and the drawn dragon looked out of place on it)
        if (!IMG.bg_normal) {
          const u = ((age * 0.035) % 1);
          drawDragon(ctx, { x: lerp(W + 140, -160, u), y: 112 + Math.sin(age * 0.5) * 10, sc: 0.62, dir: -1, t: age * 0.9, len: 360, amp: 0.4, wave: 1.2, spd: 2, pal: "shadow", alpha: 0.55, simple: false });
        }
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        drawGlow(ctx, C.orange, CX, H + 30, 230, 0.22 + 0.08 * Math.sin(age * 2.2));
        ctx.restore();
      },
      emit(dt) {
        if (rng() < dt * 11) emit("back", { x: rand(0, W), y: H + 4, vx: rand(-8, 8), vy: rand(-28, -66), life: rand(2.6, 4.6), s0: rand(1.2, 2.8), s1: 0.4, a0: 0.95, a1: 0, col: pick([C.ember, C.gold, C.orange]), wob: 18, ph: rand(0, TAU), fadeIn: 0.3 });
      },
    },
    rush: {
      draw(ctx, age) {
        if (IMG.bg_rush) drawCover(ctx, IMG.bg_rush, -12, -12, W + 24, H + 24); else drawBg(ctx, "rush");
        drawRays(ctx, CX, 160, C.cyan, age * 0.35, 0.3, 430, 20, true);
        drawRays(ctx, CX, 160, C.gold, -age * 0.22, 0.14, 430, 14, true);
        speedLines(ctx, CX, 160, 34, C.white, 0.35, 70, Math.floor(age * 24));
        for (let k = 0; k < 3; k++) {
          const u = ((age * 0.7 + k / 3) % 1);
          ring(ctx, CX, 160, 20 + u * 260, 2.5, C.gold, (1 - u) * 0.55);
        }
      },
      emit(dt) {
        const n = dt * 46;
        for (let i = 0; i < n || (i === 0 && rng() < n); i++) {
          if (i >= n && rng() > n % 1) break;
          const a = rand(0, TAU), sp = rand(260, 520);
          emit("back", { x: CX + Math.cos(a) * 30, y: 160 + Math.sin(a) * 30, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ax: Math.cos(a) * 300, ay: Math.sin(a) * 300, life: 0.9, s0: rand(1, 2.4), s1: rand(1.5, 3), a0: 0.1, a1: 1, type: "spark", len: rand(18, 46), col: pick([C.white, C.cyan, C.gold, C.cyan]) });
        }
      },
    },
    jitan: {
      draw(ctx, age) {
        sceneBg(ctx, "jitan");
        drawRays(ctx, CX, 160, C.orange, age * 0.2, 0.3, 430, 18, true);
        speedLines(ctx, CX, 160, 20, C.white, 0.25, 90, Math.floor(age * 16));
      },
      emit(dt) {
        if (rng() < dt * 20) { const a = rand(0, TAU), sp = rand(160, 300); emit("back", { x: CX, y: 160, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1.2, s0: 1.5, s1: 2.5, a0: 0.2, a1: 0.9, type: "spark", len: 24, col: pick([C.gold, C.pink, C.white]) }); }
      },
    },
    bonus: {
      draw(ctx, age) {
        sceneBg(ctx, "bonus");
        drawRays(ctx, CX, 150, C.gold, age * 0.18, 0.4, 440, 18, true);
        if (gal.cur) drawGallery(ctx);
        else drawWarrior(ctx, { x: CX - 10, y: H + 34, sc: 1.02, t: age, rim: "gold", aura: 1, sword: -1.25 + Math.sin(age * 1.5) * 0.04 });
        if (boss.on) drawBoss(ctx);
        if (awaken.on) drawAwaken(ctx);
        ctx.save(); ctx.globalCompositeOperation = "lighter"; drawGlow(ctx, C.orange, CX, H + 20, 240, 0.35); ctx.restore();
      },
      emit(dt) {
        if (rng() < dt * 14) emit("back", { x: rand(0, W), y: -6, vx: rand(-10, 10), vy: rand(40, 90), life: rand(2.5, 4), s0: rand(4, 7), s1: 2, a0: 0.9, a1: 0, type: "star", col: C.gold, vr: rand(-2, 2) });
        if (rng() < dt * 22) emit("back", { x: rand(0, W), y: H + 10, vx: rand(-6, 6), vy: rand(-50, -90), ay: -10, life: rand(0.8, 1.4), s0: rand(14, 24), s1: rand(26, 36), a0: 0.5, a1: 0, type: "fire" });
      },
    },
    sp: {
      draw(ctx, age, opt) {
        sceneBg(ctx, "sp");
        const drift = (age * 18) % (W + 200);
        ctx.save(); ctx.globalAlpha = 0.5;
        for (let i = 0; i < 6; i++) {
          const x = ((i * 120 + drift) % (W + 240)) - 120, y = 60 + (i % 3) * 70;
          ctx.drawImage(softSpr("30,40,80"), x - 90, y - 24, 180, 48);
        }
        ctx.restore();
        // scheduled lightning
        const c = opt.c === "gold" ? C.gold : opt.c === "red" ? C.red : opt.c === "rainbow" ? hueRgb(age * 200) : C.cyan;
        const lt = [0.15, 1.3, 2.5, 3.2, 4.6, 5.8];
        for (let k = 0; k < lt.length; k++) {
          const d = age - lt[k];
          if (d >= 0 && d < 0.22) {
            const x0 = 40 + hash1(k * 9) * 312;
            lightning(ctx, x0, -10, x0 + (hash1(k * 5) - 0.5) * 120, 200 + hash1(k) * 90, k * 7 + Math.floor(d * 30), c, 2.4, 1 - d / 0.22);
            ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.25 * (1 - d / 0.22); ctx.fillStyle = rgba(c, 1); ctx.fillRect(-12, -12, W + 24, H + 24); ctx.restore();
          }
        }
        ctx.save(); ctx.globalCompositeOperation = "lighter"; drawGlow(ctx, c, CX, 182, 170, 0.18 + 0.06 * Math.sin(age * 4)); ctx.restore();
      },
      emit(dt) {
        if (rng() < dt * 30) emit("back", { x: rand(-20, W + 40), y: -10, vx: -60, vy: rand(380, 520), life: 0.8, s0: 0.8, s1: 0.8, a0: 0.35, a1: 0.2, type: "spark", len: 18, col: "160,190,255" });
      },
    },
    battle: {
      draw(ctx, age) {
        sceneBg(ctx, "battle");
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        drawGlow(ctx, C.orange, CX, 236, 260, 0.25 + 0.08 * Math.sin(age * 3));
        ctx.restore();
      },
      emit(dt) {
        if (rng() < dt * 22) emit("back", { x: rand(0, W), y: H + 6, vx: rand(-14, 30), vy: rand(-40, -90), life: rand(1.6, 3), s0: rand(1, 2.4), s1: 0.3, col: pick([C.ember, C.gold]), wob: 24, ph: rand(0, TAU) });
        if (rng() < dt * 16) emit("back", { x: rand(0, W), y: 238 + rand(-6, 6), vx: rand(-5, 5), vy: rand(-20, -40), ay: -6, life: rand(0.8, 1.4), s0: rand(8, 14), s1: rand(16, 24), a0: 0.55, a1: 0, type: "fire" });
      },
    },
    spsp: {
      draw(ctx, age) {
        sceneBg(ctx, "spsp");
        drawRays(ctx, CX, 190, C.gold, age * 0.5, 0.45, 450, 20, true);
        drawRays(ctx, CX, 190, C.red, -age * 0.32, 0.35, 450, 12, true);
        // rainbow halo
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU + age * 0.8;
          drawGlow(ctx, hueRgb((i * 22.5 + age * 120) % 360), CX + Math.cos(a) * 128, 186 + Math.sin(a) * 104, 26, 0.38);
        }
        ctx.restore();
      },
      emit(dt) {
        const n = dt * 40;   // fewer, a touch bigger: lighter for a phone
        for (let i = 0; i < Math.floor(n) + (rng() < n % 1 ? 1 : 0); i++)
          emit("back", { x: rand(-20, W + 20), y: H + 20, vx: rand(-10, 10), vy: rand(-90, -170), ay: -20, life: rand(0.9, 1.6), s0: rand(18, 28), s1: rand(32, 50), a0: 0.72, a1: 0, type: "fire" });
      },
    },
    jackpot: {
      draw(ctx, age) {
        sceneBg(ctx, "jackpot");
        drawRays(ctx, CX, 172, C.white, age * 0.6, 0.5, 450, 22, true);
        drawRays(ctx, CX, 172, C.gold, -age * 0.4, 0.4, 450, 16, true);
        if (IMG.jackpot_art) {   // the hero and the 神龍, full screen with a slow push in
          const z = 1 + 0.04 * Math.min(1, age / 6);
          ctx.save(); ctx.translate(CX, H / 2); ctx.scale(z, z); ctx.translate(-CX, -H / 2);
          drawCover(ctx, IMG.jackpot_art, 0, 0, W, H); ctx.restore();
          ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(0, 0, W, H);   // the 777 stays readable
        } else if (IMG.jackpot) { ctx.globalAlpha = 0.85; drawContain(ctx, IMG.jackpot, 0, 20, W, H - 20, true); ctx.globalAlpha = 1; }
        else {
          drawDragon(ctx, { x: CX + 6, y: 84, sc: 0.95, dir: 1, t: age * 0.6, len: 470, w0: 17, ang: 0.1, curl: -5.4, amp: 0.12, wave: 1, spd: 1, pal: "gold", glow: true, alpha: 0.9 });
        }
      },
      emit(dt) {
        if (rng() < dt * 26) emit("front", { x: rand(0, W), y: -8, vx: rand(-20, 20), vy: rand(60, 120), ay: 30, life: rand(2, 3.4), s0: rand(2.5, 4.5), s1: 3, a0: 1, a1: 0.3, type: "confetti", col: pick([C.gold, C.red, C.white, C.yellow, C.pink]), ph: rand(0, TAU), vr: rand(-3, 3), add: false });
        if (rng() < dt * 16) emit("front", { x: rand(20, W - 20), y: rand(20, H - 40), life: rand(0.5, 0.9), s0: 0, s1: rand(8, 14), a0: 1, a1: 0, type: "star", col: C.gold, vr: 2 });
      },
    },
    result: {
      draw(ctx, age) {
        sceneBg(ctx, "result");
        drawRays(ctx, CX, 150, C.blue, age * 0.1, 0.25, 430, 16, true);
      },
      emit(dt) {
        if (rng() < dt * 10) emit("back", { x: rand(0, W), y: H + 4, vy: rand(-20, -40), life: 4, s0: 1.6, s1: 0.4, col: C.gold, wob: 12, ph: rand(0, TAU) });
      },
    },
  };
  function drawScenes(ctx) {
    const u = fadeDur > 0 ? u01(clk.t, fadeT0, fadeDur) : 1;
    if (prevScene && u < 1) {
      const sc0 = SCN[prevScene.id];
      if (sc0) { ctx.save(); sc0.draw(ctx, clk.t - prevScene.t0, prevScene.opt); ctx.restore(); }
    } else prevScene = null;
    const sc = SCN[scene.id];
    if (sc) { ctx.save(); ctx.globalAlpha = u; sc.draw(ctx, clk.t - scene.t0, scene.opt); ctx.restore(); }
  }

  // ------------------------------------------------------------------ DOM: styles, telops, HUD
  const CSS = `
.pkl-root{position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;border-radius:${LL.r}px;background:#0a0204;contain:strict;
  -webkit-user-select:none;user-select:none;}
.pkl-cv{position:absolute;left:0;top:0;width:${W}px;height:${H}px;display:block;}
.pkl-ov{position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;}
.pkl-vid{position:absolute;left:0;top:0;width:${W}px;height:${H}px;object-fit:cover;opacity:0;transition:opacity .25s;pointer-events:none;}
.pkl-vid.on{opacity:1;}
.pkl-white{position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:#fff;opacity:0;pointer-events:none;}
.pkl-vid.scr.on{opacity:.6;}   /* screened clips are bright: keep the 777 under them readable */
.pkl-vid.pip{left:${Math.round(W * 0.03)}px;top:${Math.round(H * 0.19)}px;width:${Math.round(W * 0.6)}px;height:${Math.round(H * 0.56)}px;border:2px solid #ffd27a;border-radius:10px;box-shadow:0 0 18px rgba(255,170,50,.75);}
.pkl-t{position:absolute;left:0;top:0;white-space:nowrap;line-height:1.08;pointer-events:none;font-family:${FONT_DIGIT};
  will-change:transform,opacity;opacity:0;letter-spacing:.02em;}
.pkl-t>span{position:relative;display:block;color:var(--bk);-webkit-text-stroke:var(--sw,.22em) var(--bk);
  text-shadow:0 .06em 0 var(--bk),0 .1em 0 var(--bk2),0 0 .28em var(--gl),0 0 .6em var(--gl);}
.pkl-t>span::after{content:attr(data-t);position:absolute;left:0;top:0;background:var(--gr);-webkit-background-clip:text;background-clip:text;
  color:transparent;-webkit-text-stroke:.025em var(--hl);text-shadow:none;}
.pkl-s{position:relative;opacity:1;will-change:auto;}
.g-gold{--gr:linear-gradient(180deg,#fffef4 0%,#fff1a0 22%,#ffc21f 46%,#b45a00 60%,#ffd25a 78%,#fff6cf 100%);--bk:#3a1500;--bk2:#180700;--gl:rgba(255,170,30,.9);--hl:#fff9d8;}
.g-red{--gr:linear-gradient(180deg,#fff4ee 0%,#ffb0a0 22%,#ff3a24 46%,#9a0008 62%,#ff5a3a 82%,#ffc0a0 100%);--bk:#2a0000;--bk2:#100000;--gl:rgba(255,40,20,.9);--hl:#ffe8d8;}
.g-blue{--gr:linear-gradient(180deg,#f2fbff 0%,#a8e0ff 22%,#2a90ff 46%,#002a8a 62%,#3aa0ff 82%,#c8f0ff 100%);--bk:#000a2a;--bk2:#000414;--gl:rgba(40,140,255,.9);--hl:#e8f8ff;}
.g-cyan{--gr:linear-gradient(180deg,#ffffff 0%,#c8f6ff 25%,#40d0ff 50%,#0a60c0 66%,#60e0ff 86%,#e0fbff 100%);--bk:#001428;--bk2:#000814;--gl:rgba(60,200,255,.9);--hl:#ffffff;}
.g-green{--gr:linear-gradient(180deg,#f4fff4 0%,#b0ffc0 25%,#20d060 50%,#006a20 66%,#40e070 86%,#d0ffd8 100%);--bk:#001a08;--bk2:#000a04;--gl:rgba(40,255,120,.85);--hl:#f0fff0;}
.g-rainbow{--gr:linear-gradient(180deg,rgba(255,255,255,.75),rgba(255,255,255,0) 48%),linear-gradient(90deg,#ff3b3b,#ffb13b,#fff23b,#4bff6b,#3bd5ff,#6b5bff,#ff4bd8,#ff3b3b);
  --bk:#1a0030;--bk2:#0a0018;--gl:rgba(255,255,255,.85);--hl:#ffffff;}
.g-silver{--gr:linear-gradient(180deg,#ffffff 0%,#e4ecf4 30%,#8a9ab0 52%,#4a5668 62%,#dce6f0 85%,#ffffff 100%);--bk:#0a1018;--bk2:#04080c;--gl:rgba(160,200,255,.7);--hl:#ffffff;}
.g-gray{--gr:linear-gradient(180deg,#e8e8f0 0%,#a0a4b4 40%,#50546a 62%,#8a8ea0 100%);--bk:#000000;--bk2:#000000;--gl:rgba(70,90,160,.7);--hl:#ffffff;}
.g-kokuchi{--gr:linear-gradient(180deg,#ffffff 0%,#fffbd0 35%,#ffe040 60%,#ff8a00 100%);--bk:#000000;--bk2:#2a0000;--gl:rgba(255,30,0,1);--hl:#ffffff;--sw:.26em;}
.g-fire{--gr:linear-gradient(180deg,#fffef0 0%,#fff07a 22%,#ffa21a 44%,#ff4a0a 64%,#c81200 82%,#ff8a3a 100%);--bk:#2a0400;--bk2:#100100;--gl:rgba(255,90,10,.9);--hl:#fff6d0;}
.pkl-hud{position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;opacity:0;}
.pkl-box{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:linear-gradient(180deg,rgba(10,20,60,.82),rgba(4,6,24,.88));border:2px solid #ffd24a;border-radius:10px;
  box-shadow:0 0 10px rgba(80,160,255,.7),inset 0 0 10px rgba(80,160,255,.45);}
.pkl-lbl{font-family:${FONT_TC};font-weight:900;font-size:11px;color:#fff3c0;letter-spacing:.08em;text-shadow:0 1px 0 #000,0 0 6px rgba(255,180,40,.8);line-height:1;}
.pkl-aim{position:absolute;left:300px;top:242px;width:84px;height:30px;border-radius:8px;opacity:0;
  background:linear-gradient(180deg,#ff4a2a,#a00a00);border:2px solid #ffe08a;box-shadow:0 0 12px rgba(255,80,20,.9);
  display:flex;align-items:center;justify-content:center;font-family:${FONT_DIGIT};font-size:15px;color:#fff;
  text-shadow:0 2px 0 #4a0000,0 0 6px rgba(255,255,255,.6);letter-spacing:.02em;}
.pkl-aim b{display:inline-block;font-size:17px;color:#fff6a0;margin-left:3px;}
.pkl-gain{position:absolute;left:0;width:${W}px;text-align:center;}
`;
  let root = null, cv = null, ctx = null, ov = null, telLayer = null;
  const hud = {};
  let telops = [];
  function injectCss() {
    if (document.getElementById("pkl-css")) return;
    const st = document.createElement("style"); st.id = "pkl-css"; st.textContent = CSS;
    document.head.appendChild(st);
  }
  function mkText(text, cls, size, font, stat) {
    const el = document.createElement("div");
    el.className = "pkl-t g-" + (cls || "gold") + (stat ? " pkl-s" : "");
    el.style.fontSize = size + "px";
    if (size < 20) el.style.setProperty("--sw", ".12em"); else if (size < 30) el.style.setProperty("--sw", ".15em");
    if (font) el.style.fontFamily = font;
    const sp = document.createElement("span"); sp.textContent = text; sp.setAttribute("data-t", text);
    el.appendChild(sp);
    return el;
  }
  function setText(el, text) { const sp = el.firstChild; if (sp.textContent !== text) { sp.textContent = text; sp.setAttribute("data-t", text); } }
  // o: x,y,size,cls,font,dur,anim,rot,inD,outD,pulse,jitter,stay
  function telop(text, o) {
    o = o || {};
    const el = mkText(text, o.cls, o.size || 48, o.font);
    telLayer.appendChild(el);
    const tp = { el, t0: clk.t, o, x: o.x == null ? CX : o.x, y: o.y == null ? 168 : o.y, dur: o.dur || 1.2, endT: null, lastT: "", lastO: -1 };
    telops.push(tp);
    updTelop(tp);
    return tp;
  }
  function telopOut(tp, d) { if (!tp || tp.dead) return; tp.endT = clk.t; tp.outD = d || 0.2; }
  function clearTelops() { telops.forEach((t) => t.el.remove()); telops = []; }
  function updTelop(tp) {
    const o = tp.o, age = clk.t - tp.t0, inD = o.inD || 0.24;
    let s = 1, a = 1, x = tp.x, y = tp.y, r = o.rot || 0;
    const ui = clamp(age / inD, 0, 1);
    switch (o.anim || "slam") {
      case "slam": s = lerp(2.6, 1, E.back(ui)); a = ui; break;
      case "pop": s = E.back(ui) * 1; a = Math.min(1, ui * 2); break;
      case "zoom": s = lerp(0.2, 1, E.out(ui)); a = ui; break;
      case "drop": y = tp.y - 70 * (1 - E.elastic(ui)); a = Math.min(1, ui * 3); break;
      case "stamp": s = lerp(3.2, 1, E.out(ui)); r = lerp(-24, o.rot || -8, E.out(ui)); a = ui; break;
      case "slideL": x = lerp(W + 220, tp.x, E.out(ui)); a = 1; break;
      case "rise": y = tp.y + 30 * (1 - E.out(ui)); a = ui; break;
      case "fade": a = ui; break;
    }
    if (o.pulse && ui >= 1) s *= 1 + o.pulse * Math.sin((age - inD) * 9);
    if (o.jitter) { x += (hash1(Math.floor(clk.t * 60)) - 0.5) * o.jitter; y += (hash1(Math.floor(clk.t * 60) + 9) - 0.5) * o.jitter; }
    if (o.drift) y += o.drift * Math.max(0, age - inD);
    // outro
    let outU = 0;
    if (tp.endT != null) outU = clamp((clk.t - tp.endT) / tp.outD, 0, 1);
    else if (!o.stay && age > tp.dur - (o.outD || 0.2)) outU = clamp((age - (tp.dur - (o.outD || 0.2))) / (o.outD || 0.2), 0, 1);
    if (outU > 0) {
      if ((o.anim || "slam") === "slideL") x = lerp(tp.x, -240, E.in(outU));
      else s *= 1 + 0.25 * outU;
      a *= 1 - outU;
    }
    const tr = "translate(" + x.toFixed(2) + "px," + y.toFixed(2) + "px) translate(-50%,-50%) rotate(" + r.toFixed(2) + "deg) scale(" + s.toFixed(4) + ")";
    if (tr !== tp.lastT) { tp.el.style.transform = tr; tp.lastT = tr; }
    const ao = Math.round(a * 1000) / 1000;
    if (ao !== tp.lastO) { tp.el.style.opacity = ao; tp.lastO = ao; }
    if (o.cls === "rainbow") tp.el.firstChild.style.setProperty("--x", "0");
    return outU >= 1;
  }
  function updTelops() {
    if (!telops.length) return;
    const keep = [];
    for (const tp of telops) { if (updTelop(tp)) { tp.el.remove(); tp.dead = true; } else keep.push(tp); }
    telops = keep;
  }
  function buildHud() {
    // RUSH / 時短 HUD
    const r = document.createElement("div"); r.className = "pkl-hud";
    const st = document.createElement("div"); st.className = "pkl-box"; st.style.cssText = "left:14px;top:78px;width:74px;height:64px;";
    hud.stLbl = document.createElement("div"); hud.stLbl.className = "pkl-lbl"; hud.stLbl.textContent = T("lcd.stLeft");
    hud.stNum = mkText("11", "cyan", 38, FONT_DIGIT, true);
    st.appendChild(hud.stLbl); st.appendChild(hud.stNum);
    const sk = document.createElement("div"); sk.className = "pkl-box"; sk.style.cssText = "left:290px;top:78px;width:74px;height:64px;";   // clear of the cabinet sub display
    hud.skNum = mkText(T("lcd.streakN", { n: 1 }), "gold", 26, FONT_DIGIT, true);
    hud.skLbl = document.createElement("div"); hud.skLbl.className = "pkl-lbl"; hud.skLbl.textContent = T("lcd.streakLbl");
    sk.appendChild(hud.skLbl); sk.appendChild(hud.skNum);
    const gn = document.createElement("div"); gn.style.cssText = "position:absolute;left:16px;top:252px;";
    hud.rGain = mkText("TOTAL 0", "gold", 16, FONT_DIGIT, true);
    hud.rGain.style.display = "inline-block";
    gn.appendChild(hud.rGain);
    r.appendChild(st); r.appendChild(sk); r.appendChild(gn);
    hud.rush = r; hud.stBox = st; hud.skBox = sk;
    // Bonus HUD
    const b = document.createElement("div"); b.className = "pkl-hud";
    const top = document.createElement("div"); top.className = "pkl-gain"; top.style.top = "10px";
    hud.bRound = mkText("ROUND 1", "gold", 34, FONT_DIGIT, true); hud.bRound.style.display = "inline-block";
    hud.bOf = mkText("/10R", "silver", 20, FONT_DIGIT, true); hud.bOf.style.display = "inline-block"; hud.bOf.style.marginLeft = "4px";
    top.appendChild(hud.bRound); top.appendChild(hud.bOf);
    const gb = document.createElement("div"); gb.className = "pkl-gain"; gb.style.top = "228px";
    hud.bLbl = document.createElement("div"); hud.bLbl.className = "pkl-lbl"; hud.bLbl.textContent = T("lcd.gainLbl"); hud.bLbl.style.fontSize = "14px";
    hud.bGain = mkText("0", "gold", 40, FONT_DIGIT, true); hud.bGain.style.display = "inline-block";
    gb.appendChild(hud.bLbl); gb.appendChild(hud.bGain);
    b.appendChild(top); b.appendChild(gb);
    hud.bonus = b;
    // 右打ち sign
    const aim = document.createElement("div"); aim.className = "pkl-aim"; aim.textContent = T("lcd.aim"); aim.appendChild(document.createElement("b")).textContent = "➡";
    hud.aim = aim; hud.aimArrow = aim.querySelector("b");
    ov.appendChild(r); ov.appendChild(b); ov.appendChild(aim);
    hud.rushA = 0; hud.bonusA = 0; hud.aimA = 0;
  }
  const hudState = { rushOn: false, bonusOn: false, aimOn: false, stPopT: -9, skPopT: -9, gainDisp: 0, gainTo: 0, gainFrom: 0, gainT0: 0, roundPopT: -9 };
  function setOp(el, key, v) { v = Math.round(v * 100) / 100; if (hud[key + "_l"] !== v) { el.style.opacity = v; hud[key + "_l"] = v; } }
  function updHud(dt) {
    const k = Math.min(1, dt * 10);
    hud.rushA += ((hudState.rushOn && !hudHide ? 1 : 0) - hud.rushA) * k;
    hud.bonusA += ((hudState.bonusOn && !hudHide ? 1 : 0) - hud.bonusA) * k;
    hud.aimA += ((hudState.aimOn && !aimHide ? 1 : 0) - hud.aimA) * k;
    setOp(hud.rush, "r", hud.rushA); setOp(hud.bonus, "b", hud.bonusA);
    setOp(hud.aim, "a", hud.aimA * (0.75 + 0.25 * Math.sin(clk.t * 8)));
    if (hud.aimA > 0.01) {
      const ax = "translateX(" + (Math.sin(clk.t * 9) * 3).toFixed(1) + "px)";
      if (hud.aimArrow._l !== ax) { hud.aimArrow.style.transform = ax; hud.aimArrow._l = ax; }
    }
    // st / streak pops
    const pop = (el, t0, key) => {
      const u = clk.t - t0, s = u >= 0 && u < 0.35 ? 1 + 0.45 * Math.sin((u / 0.35) * Math.PI) : 1;
      const tr = "scale(" + s.toFixed(3) + ")";
      if (hud[key] !== tr) { el.style.transform = tr; hud[key] = tr; }
    };
    pop(hud.stNum, hudState.stPopT, "stp"); pop(hud.skNum, hudState.skPopT, "skp"); pop(hud.bRound, hudState.roundPopT, "rdp");
    // bonus gain count-up
    if (hudState.gainDisp !== hudState.gainTo) {
      const u = clamp((clk.t - hudState.gainT0) / 0.9, 0, 1);
      hudState.gainDisp = Math.round(lerp(hudState.gainFrom, hudState.gainTo, E.out2(u)));
      setText(hud.bGain, fmt(hudState.gainDisp));
    }
  }
  const fmt = (n) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let hudHide = false, aimHide = false;

  // ------------------------------------------------------------------ module state
  let mode = "normal";
  let aimSide = "left";
  let rushInfo = { st: 11, streak: 0, gained: 0 };
  let curOpts = null;
  let pushWaiter = null;
  const renda = { on: false, n: 0, g: 0, auto: false, lastAuto: 0, onHit: null };
  let kpx = 2, lastW = 0, frameN = 0;

  // ------------------------------------------------------------------ logo + overlays
  function logoVariant() { return mode === "rush" ? "rush" : "main"; }
  function drawLogo(ctx) {
    if (fx.logoA <= 0.01 || !SPR.logo.main || mode === "bonus") return;
    const sp = SPR.logo[logoVariant()];
    const x = CX, y = 39 + fx.logoY, s = 0.96 * fx.logoS;
    ctx.save();
    ctx.globalAlpha = fx.logoA;
    ctx.drawImage(sp.c, x - sp.ax * s, y - sp.ay * s, sp.w * s, sp.h * s);
    // light sweep (masked to the logo)
    const per = 4.2, ph = (clk.t % per) / 0.9;
    if (ph < 1) {
      const tmp = cache.logoTmp || (cache.logoTmp = mkCanvas(sp.c.width, sp.c.height));
      const tg = tmp.getContext("2d");
      tg.globalCompositeOperation = "source-over"; tg.clearRect(0, 0, tmp.width, tmp.height);
      tg.drawImage(sp.c, 0, 0);
      tg.globalCompositeOperation = "source-in";
      const bx = lerp(-0.3, 1.3, ph) * tmp.width;
      const gr = tg.createLinearGradient(bx - 60, 0, bx + 60, tmp.height * 0.4);
      gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, "rgba(255,255,255,0.85)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      tg.fillStyle = gr; tg.fillRect(0, 0, tmp.width, tmp.height);
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(tmp, x - sp.ax * s, y - sp.ay * s, sp.w * s, sp.h * s);
      ctx.globalCompositeOperation = "source-over";
    }
    // crest sparkle
    if (logoVariant() === "main") {
      const a = clk.t * 1.8;
      star4(ctx, x + Math.cos(a) * 28 * s, y + 4 * s + Math.sin(a) * 28 * s, 5 + 3 * Math.sin(clk.t * 5), fx.logoA);
    }
    ctx.restore();
  }
  function drawOverlays(ctx) {
    if (fx.dim > 0.005) { ctx.globalAlpha = fx.dim; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); }
    if (fx.gray > 0.005) {
      ctx.save(); ctx.globalCompositeOperation = "saturation"; ctx.globalAlpha = fx.gray; ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    if (fx.tint > 0.005) {
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = fx.tint; ctx.fillStyle = rgba(fx.tintC, 1); ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    if (fx.vign > 0.005) {
      const p = fx.vignP ? 0.7 + 0.3 * Math.sin(clk.t * fx.vignP) : 1;
      ctx.globalAlpha = fx.vign * p; ctx.drawImage(vignSpr(fx.vignC), 0, 0, W, H);
    }
    // screen inset shading (always)
    ctx.globalAlpha = 0.55; ctx.drawImage(vignSpr("0,0,0"), -30, -26, W + 60, H + 52);
    if (fx.flashA > 0.005) {
      ctx.globalAlpha = Math.min(1, fx.flashA); ctx.fillStyle = rgba(fx.flashC, 1); ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ main loop
  function render() {
    if (!ctx) return;
    ctx.setTransform(kpx, 0, 0, kpx, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(fx.sx, fx.sy);
    drawScenes(ctx);
    drawActors(ctx, "back");
    drawParticles(ctx, P.back);
    drawLogo(ctx);
    drawActors(ctx, "under");
    const pulse = hitPulse.on ? 1 + 0.035 * Math.sin((clk.t - hitPulse.t0) * 10) : 1;
    drawReel(ctx, reels[0], pulse); drawReel(ctx, reels[2], pulse); drawReel(ctx, reels[1], pulse);
    drawActors(ctx, "mid");
    drawParticles(ctx, P.front);
    drawActors(ctx, "front");
    drawHolds(ctx);
    ctx.restore();
    drawActors(ctx, "top");
    drawOverlays(ctx);
    const tr = fx.sx || fx.sy ? "translate(" + fx.sx.toFixed(1) + "px," + fx.sy.toFixed(1) + "px)" : "";
    if (ov._tr !== tr) { ov.style.transform = tr; ov._tr = tr; }
  }
  const hitPulse = { on: false, t0: 0 };
  function update(dt) {
    updTweens();
    for (const r of reels) updReel(r, dt);
    updParticles(dt);
    const sc = SCN[scene.id];
    if (sc && sc.emit) sc.emit(dt, clk.t - scene.t0, scene.opt);
    for (const a of actors) if (a.upd && !a.kill) a.upd(dt, clk.t - a.t0, a);
    actors = actors.filter((a) => !a.kill && clk.t - a.t0 < a.dur);
    fx.shake *= Math.exp(-dt * 6.5);
    if (fx.shake < 0.05) fx.shake = 0;
    fx.sx = (rng() * 2 - 1) * fx.shake; fx.sy = (rng() * 2 - 1) * fx.shake;
    fx.flashA = Math.max(0, fx.flashA - dt * fx.flashD);
    if (fx.logoA > 0.3 && mode !== "bonus" && rng() < dt * 6)
      emit("back", { x: rand(70, 322), y: rand(42, 60), vx: rand(-6, 6), vy: rand(-18, -34), life: rand(1, 1.8), s0: rand(1, 2.2), s1: 0.3, col: pick([C.ember, C.gold]), wob: 10, ph: rand(0, TAU) });
    if (renda.on && renda.auto && clk.t - renda.lastAuto > 0.13) { renda.lastAuto = clk.t; rendaHit(true); }
    renda.g = Math.max(0, renda.g - dt * 0.25);
    updTelops();
    updHud(dt);
  }
  function step(dtReal) {
    const dt = dtReal * clk.scale;
    clk.t += dt;
    if (waits.length) {
      const due = [], keep = [];
      for (const w of waits) (w.at <= clk.t + 1e-9 ? due : keep).push(w);
      if (due.length) { waits = keep; due.sort((a, b) => a.at - b.at).forEach((w) => w.res()); }
    }
    update(dt);
  }
  let raf = 0, lastTs = 0, manual = false;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (manual) return;
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 1 / 60;
    lastTs = ts;
    if (++frameN % 60 === 0) resize();
    step(dt);
    if (!clipCovers()) render();
  }
  // An opaque clip that fills the LCD hides the canvas, so it is not drawn meanwhile (a phone then
  // only plays the video). Screened clips and the round window show the canvas, so they keep it.
  function clipCovers() {
    for (const k in VID) {
      const v = VID[k];
      if (v && !VID_SCREEN[k] && !k.startsWith("round") && v.classList.contains("on") && !v.paused && v.readyState >= 2) return true;
    }
    return false;
  }
  function resize() {
    if (!root) return;
    const rc = root.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let k = rc.width > 0 ? (rc.width / W) * dpr : 2;
    k = clamp(Math.round(k * 20) / 20, 0.5, 3);
    if (k !== kpx || !lastW) {
      kpx = k; lastW = rc.width;
      cv.width = Math.round(W * k); cv.height = Math.round(H * k);
    }
  }

  // ------------------------------------------------------------------ helpers for sequences
  function mkEmit(opts) {
    return function (name) { try { if (opts && opts.onEvent) opts.onEvent(name); } catch (e) { console.error(e); } };
  }
  function norm(sc) {
    const s = Object.assign({ hit: false, kind: null, final: [1, 2, 3], holdColor: "blue", holdChangeTo: null, pseudo: 0, stepup: 0, gun: false, cutin: null, kokuchi: false, reach: null, fast: false, mode: mode === "bonus" ? "normal" : mode }, sc || {});
    s.final = (s.final || [1, 2, 3]).map((d) => clamp(Math.round(d) || 1, 1, 9));
    if (s.final[0] === s.final[2] && !s.reach) s.reach = { type: "normal", color: "blue", push: false, revive: false };
    if (s.reach) s.reach = Object.assign({ type: "normal", color: "blue", push: false, revive: false }, s.reach);
    if (s.reach && s.final[0] !== s.final[2]) s.final[2] = s.final[0];
    if (s.reach && s.reach.revive && !s.hit) s.reach.revive = false;
    return s;
  }
  const near = (d) => ((d % 9) + 1); // the digit after d (前後ハズレ look)
  function resetStage(keepScene) {
    killSeqActors(); clearTelops();
    tween(fx, { dim: 0, gray: 0, vign: 0, tint: 0 }, 0.2);
    fx.vignP = 0; hitPulse.on = false;
    reels.forEach((r) => { r.glow = 0; r.dim = 0; });
    renda.on = false; renda.onHit = null; pushWaiter = null;
    white(0, 0.1);
    if (!keepScene) setScene(modeScene(), 0.25);
  }
  function pedIn(c) { ped.c = c; ped.a = 1; ped.t0 = clk.t; ped.s = 1; }
  function pedOut() { tween(ped, { a: 0 }, 0.3); }
  function stopE(i, d, T, ctxs) {
    const p = reelStop(reels[i], d, T);
    return p.then(() => { ctxs.emit("reelStop" + ctxs.stops++); });
  }
  function waitPush(sec, auto) {
    return new Promise((res) => {
      let done = false;
      const fin = (v) => { if (done) return; done = true; if (pushWaiter && pushWaiter.fin === fin) pushWaiter = null; res(v); };
      pushWaiter = { fin };
      wait(sec).then(() => fin("timeout"));
      if (auto) wait(0.75).then(() => fin("auto"));
    });
  }
  function rendaHit(auto) {
    renda.n++; renda.g = Math.min(1, renda.g + 0.09);
    const bx = rand(220, 340), by = rand(110, 210);
    burst("front", bx, by, 6, { cols: [C.gold, C.white, C.orange], v0: 80, v1: 220, l0: 0.2, l1: 0.45, s0: 1, s1: 2.4, len: 14 });
    shake(1.5);
    if (renda.onHit) renda.onHit();
    if (!auto && curOpts && curOpts.onPush) try { curOpts.onPush("renda"); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ 予告 effects
  const STEP_COL = [null, C.blue, C.green, C.red, C.gold, "rainbow"];
  function stepPanelDraw(ctx, age, a) {
    if (!a.lvl) return;
    const lv = a.lvl, t1 = clk.t - a.t1;
    let s = t1 < 0.22 ? lerp(1.5, 1, E.back(clamp(t1 / 0.22, 0, 1))) : 1;
    let al = Math.min(1, t1 / 0.08);
    if (a.out != null) { const u = clamp((clk.t - a.out) / 0.2, 0, 1); s *= 1 + u * 0.4; al *= 1 - u; }
    const c = lv === 5 ? hueRgb(clk.t * 240) : STEP_COL[lv];
    const x = CX, y = 170, w = 214, h = 124;
    ctx.translate(x, y); ctx.scale(s, s); ctx.globalAlpha = al;
    ctx.save(); ctx.globalCompositeOperation = "lighter"; drawGlow(ctx, c, 0, 0, 170, 0.55); ctx.restore();
    ctx.globalAlpha = al;
    // frame
    const fr = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    if (lv >= 4) { fr.addColorStop(0, "#fffbe0"); fr.addColorStop(0.3, "#ffc21a"); fr.addColorStop(0.6, "#7a4200"); fr.addColorStop(1, "#ffe58a"); }
    else { fr.addColorStop(0, "#ffffff"); fr.addColorStop(0.35, "#aab8c8"); fr.addColorStop(0.65, "#3a4658"); fr.addColorStop(1, "#e8eef6"); }
    ctx.fillStyle = "#000"; roundRect(ctx, -w / 2 - 5, -h / 2 - 5, w + 10, h + 10, 14); ctx.fill();
    ctx.fillStyle = fr; roundRect(ctx, -w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 12); ctx.fill();
    const ig = ctx.createRadialGradient(0, 0, 10, 0, 0, w * 0.6);
    ig.addColorStop(0, rgba(c, 1)); ig.addColorStop(0.5, rgba(c, 0.55)); ig.addColorStop(1, "rgba(0,0,0,0.95)");
    ctx.fillStyle = "#050208"; roundRect(ctx, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 9); ctx.fill();
    ctx.save(); roundRect(ctx, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 9); ctx.clip();
    ctx.fillStyle = ig; ctx.fillRect(-w / 2, -h / 2, w, h);
    speedLines(ctx, 0, 0, 26, C.white, 0.25, 30, Math.floor(clk.t * 20));
    // content per level (each step hotter than the last)
    const tt = clk.t;
    const art = lv <= 3 && IMG["step" + lv];
    if (art) {   // AI art for STEP 1-3, breathing slightly (the drawn flames looked plain)
      const z = 1.04 + 0.03 * Math.sin(tt * 3);
      ctx.save(); ctx.scale(z, z); drawCover(ctx, art, -w / 2, -h / 2, w, h); ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = "lighter"; drawGlow(ctx, c === "rainbow" ? C.gold : c, 0, 0, 120, 0.25); ctx.restore();
    }
    ctx.globalCompositeOperation = "lighter";
    if (art) { /* drawn above */ } else if (lv === 1) {
      for (let i = 0; i < 7; i++) flameShape(ctx, -84 + i * 28, 62, 34, 70 + 26 * Math.sin(tt * 9 + i * 1.7), Math.sin(tt * 5 + i) * 6, 0.85, FLAME_BLUE);
    } else if (lv === 2) {
      for (let i = 0; i < 7; i++) flameShape(ctx, -84 + i * 28, 62, 34, 80 + 26 * Math.sin(tt * 10 + i * 1.3), Math.sin(tt * 6 + i) * 8, 0.85, FLAME_GREEN);
      ctx.strokeStyle = "rgba(220,255,230,0.7)"; ctx.lineWidth = 2.5;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(0, 0, 16 + i * 13, tt * 5 + i, tt * 5 + i + 3.6); ctx.stroke(); }
    } else if (lv === 3) {
      for (let i = 0; i < 7; i++) flameShape(ctx, -84 + i * 28, 62, 36, 90 + 26 * Math.sin(tt * 11 + i), 0, 0.8);
      ctx.globalCompositeOperation = "source-over";
      // a dragon's eye opening in the fire
      const op = clamp((tt - a.t1) / 0.25, 0, 1);
      ctx.save(); ctx.scale(1, 0.15 + 0.85 * E.out(op));
      ctx.fillStyle = "#2a0000"; ctx.beginPath(); ctx.ellipse(0, -4, 78, 30, 0, 0, TAU); ctx.fill();
      const eg = ctx.createRadialGradient(0, -4, 2, 0, -4, 60);
      eg.addColorStop(0, "#fffbd0"); eg.addColorStop(0.35, "#ffd21a"); eg.addColorStop(0.8, "#ff5a00"); eg.addColorStop(1, "#a01000");
      ctx.fillStyle = eg; ctx.beginPath(); ctx.ellipse(0, -4, 70, 26, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(0, -4, 7, 25, 0, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.globalCompositeOperation = "lighter"; drawGlow(ctx, C.red, 0, 0, 100, 0.55);
    } else if (lv === 4) {
      drawRays(ctx, 0, 0, C.gold, tt * 1.5, 0.6, 200, 16, true);
      ctx.globalCompositeOperation = "source-over";
      if (IMG.hero) {   // the AI warrior from the waist up
        const im = IMG.hero, sh = im.naturalHeight * 0.58, dh = 150, dw = (dh * im.naturalWidth) / sh;
        ctx.drawImage(im, 0, 0, im.naturalWidth, sh, -dw / 2, -h / 2 + 2, dw, dh);
      } else drawWarrior(ctx, { x: 6, y: 128, sc: 0.62, t: tt, rim: "gold", aura: 1 });
    } else {
      drawRays(ctx, 0, 0, hueRgb(tt * 200), tt * 2, 0.7, 220, 20, true);
      ctx.globalCompositeOperation = "source-over";
      if (goldDragon()) drawArtDragon(ctx, goldDragon(), 0, 12, 150, false);
      else drawDragon(ctx, { x: -40, y: -14, sc: 0.62, dir: -1, t: tt * 1.4, len: 300, w0: 16, ang: -0.25, curl: -4.2, amp: 0.15, pal: "gold", glow: true, jaw: 0.42 });
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
    // badge
    ctx.fillStyle = "#000"; roundRect(ctx, -w / 2 - 8, -h / 2 - 12, 86, 28, 8); ctx.fill();
    const bg2 = ctx.createLinearGradient(0, -h / 2 - 10, 0, -h / 2 + 14);
    if (lv >= 4) { bg2.addColorStop(0, "#fff0a0"); bg2.addColorStop(1, "#b06a00"); } else { bg2.addColorStop(0, "#ffffff"); bg2.addColorStop(1, "#6a7a90"); }
    ctx.fillStyle = bg2; roundRect(ctx, -w / 2 - 6, -h / 2 - 10, 82, 24, 7); ctx.fill();
    ctx.font = "14px " + FONT_DIGIT; ctx.textAlign = "left"; ctx.lineJoin = "round";
    ctx.fillStyle = "#1a0a00"; ctx.fillText(T("lcd.step"), -w / 2 + 2, -h / 2 + 8);
    ctx.font = "22px " + FONT_DIGIT;
    ctx.lineWidth = 4; ctx.strokeStyle = "#1a0a00"; ctx.strokeText(String(lv), -w / 2 + 52, -h / 2 + 11);
    ctx.fillStyle = lv === 5 ? "rgb(" + hueRgb(tt * 300) + ")" : lv >= 3 ? "#ff3a1a" : "#ffffff"; ctx.fillText(String(lv), -w / 2 + 52, -h / 2 + 11);
    // sheen sweep
    const sw = (clk.t - a.t1) / 0.45;
    if (sw > 0 && sw < 1) {
      ctx.save(); roundRect(ctx, -w / 2, -h / 2, w, h, 10); ctx.clip();
      const bx = lerp(-w, w, sw);
      const sg = ctx.createLinearGradient(bx - 40, -h / 2, bx + 40, h / 2);
      sg.addColorStop(0, "rgba(255,255,255,0)"); sg.addColorStop(0.5, "rgba(255,255,255,0.55)"); sg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = sg; ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function shardBurst(x, y, c, n) {
    for (let i = 0; i < (n || 26); i++) {
      const a = rand(0, TAU), sp = rand(80, 320);
      emit("front", { x: x + rand(-90, 90), y: y + rand(-50, 50), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, ay: 500, life: rand(0.5, 0.9), s0: rand(4, 10), s1: rand(3, 8), a0: 1, a1: 0.2, type: "shard", col: c === "rainbow" ? hueRgb(rand(0, 360)) : c, rot: rand(0, TAU), vr: rand(-10, 10), add: false });
    }
  }
  async function stepupFx(n, ctxs) {
    const panel = addActor("front", Infinity, stepPanelDraw, { lvl: 0, t1: clk.t, seq: true });
    for (let i = 1; i <= n; i++) {
      if (panel.lvl) shardBurst(CX, 170, STEP_COL[panel.lvl]);
      panel.lvl = i; panel.t1 = clk.t;
      flash(i === 5 ? C.white : STEP_COL[i], 0.35 + i * 0.07, 5); shake(1 + i * 0.8);
      ctxs.emit("stepup:" + i);
      if (i === 5) telop(T("lcd.step5"), { x: 290, y: 116, size: 54, cls: "rainbow", anim: "stamp", rot: 10, dur: 0.85 });
      await wait(i === n ? 0.8 : 0.5);
    }
    panel.out = clk.t; await wait(0.2); panel.kill = true;
  }
  // Tinted, downsized copy of an art image (cached), so the 群龍 swarm is not 13 clones.
  function tinted(im, col, a) {
    const key = "tint" + im.src + col + a;
    if (cache[key]) return cache[key];
    const h = Math.min(320, im.naturalHeight), w = (h * im.naturalWidth) / im.naturalHeight;
    const c = mkCanvas(w, h), g = c.getContext("2d");
    g.drawImage(im, 0, 0, c.width, c.height);
    if (a > 0) { g.globalCompositeOperation = "source-atop"; g.globalAlpha = a; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height); }
    c.naturalWidth = c.width; c.naturalHeight = c.height;   // drawn like an <img> by drawArtDragon
    return (cache[key] = c);
  }
  function gunFx(ctxs) {
    const ds = [];
    // depth: far ones small, dark and slow; near ones big and bright; every fourth one gold
    for (let i = 0; i < 13; i++) {
      const z = rand(0, 1);
      ds.push({ y: 96 + (i % 7) * 26 + rand(-10, 10), ph: rand(0, TAU), z, sc: lerp(0.2, 0.52, z), dl: (i % 5) * 0.11 + rand(0, 0.12),
        sp: lerp(0.8, 1.25, z) * rand(0.95, 1.05), amp: rand(8, 22), gold: i % 4 === 0 });
    }
    ds.sort((a, b) => a.z - b.z);
    const art = (d) => {
      if (d.gold) return goldDragon() ? tinted(goldDragon(), "#ffcf5a", 0) : tinted(IMG.rival, "#ffc23a", 0.45);
      return d.z < 0.35 ? tinted(IMG.rival, "#2a0604", 0.55) : d.z < 0.7 ? tinted(IMG.rival, "#ff7a1a", 0.18) : tinted(IMG.rival, "#000", 0);
    };
    const pos = (d, age) => {
      const u = ((age - d.dl) / 1.2) * d.sp, a = u * 6 + d.ph;
      return { u, x: lerp(-120, W + 120, u), y: d.y + Math.sin(a) * d.amp - u * 26, tilt: Math.atan2(Math.cos(a) * d.amp * 6 - 26, W + 240) };
    };
    addActor("front", 2.0, (ctx, age) => {
      const k = Math.sin(clamp(age / 2, 0, 1) * Math.PI);
      ctx.globalAlpha = 0.6 * k; ctx.fillStyle = "#1a0200"; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
      hLines(ctx, 60, 280, 18, C.orange, 0.35 * k, age, 900);
      for (const d of ds) {
        const p = pos(d, age);
        if (p.u < 0 || p.u > 1) continue;
        if (IMG.rival) {   // flying right, nose following its path
          ctx.save(); ctx.globalAlpha = lerp(0.75, 1, d.z);
          ctx.translate(p.x, p.y); ctx.rotate(p.tilt); ctx.translate(-p.x, -p.y);
          drawArtDragon(ctx, art(d), p.x - 60 * d.sc, p.y, 270 * d.sc, true);
          ctx.restore();
        }
        else drawDragon(ctx, { x: p.x, y: p.y, sc: d.sc, dir: 1, simple: true, pal: d.gold ? "gold" : "fire", t: age * 2.5 + d.ph, len: 260, amp: 0.5, wave: 1.4, spd: 6, glow: 1.6, ang: -0.15 });
      }
    }, {
      seq: true,
      upd(dt, age) {
        for (const d of ds) {
          const p = pos(d, age);
          if (p.u < 0 || p.u > 1 || rng() > dt * 30) continue;
          emit("front", { x: p.x - 6, y: p.y, vx: rand(-60, -20), vy: rand(-20, 20), life: rand(0.3, 0.6), s0: 6 + d.sc * 20, s1: 2, a0: 0.8, a1: 0, type: "fire" });
        }
      },
    });
    shake(3);
    telop(T("lcd.gun"), { x: 330, y: 92, size: 46, cls: "fire", font: FONT_BRUSH, anim: "stamp", rot: 8, dur: 1.6 });
    ctxs.emit("gun");
  }
  function cutinFx(col, ctxs) {
    const c = col === "gold" ? C.gold : col === "red" ? C.red : C.blue;
    addActor("front", 1.3, (ctx, age) => {
      const ui = clamp(age / 0.16, 0, 1), uo = clamp((age - 1.1) / 0.2, 0, 1);
      const off = lerp(W + 40, 0, E.out(ui)) - lerp(0, W + 80, E.in(uo));
      ctx.translate(off, 0);
      const y0 = 108, y1 = 238, sk = 34;
      ctx.save();
      ctx.beginPath(); ctx.moveTo(-40, y0 + sk); ctx.lineTo(W + 40, y0); ctx.lineTo(W + 40, y1 - sk); ctx.lineTo(-40, y1); ctx.closePath();
      ctx.fillStyle = "#000"; ctx.fill();
      ctx.save(); ctx.clip();
      const gr = ctx.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, rgba(c, 1)); gr.addColorStop(0.5, col === "gold" ? "#5a2a00" : col === "red" ? "#3a0000" : "#000a3a"); gr.addColorStop(1, rgba(c, 1));
      ctx.fillStyle = gr; ctx.fillRect(-40, y0 - 10, W + 80, y1 - y0 + 20);
      hLines(ctx, y0, y1, 34, C.white, 0.5, age, 1600);
      if (col === "gold") drawRays(ctx, 90, 170, C.gold, age * 2, 0.5, 260, 18, true);
      if (IMG.cutin_hero) drawContain(ctx, IMG.cutin_hero, -10, 126, 200, 150);   // centred: the face stays inside the band
      else {
        ctx.save(); ctx.globalCompositeOperation = "lighter"; drawGlow(ctx, col === "gold" ? C.gold : C.orange, 120, 170, 120, 0.55); ctx.restore();
        drawWarrior(ctx, { x: 84, y: 452, sc: 1.55, t: age, rim: col === "gold" ? "gold" : "fire", sword: -0.6, rot: -0.08 });
      }
      ctx.restore();
      ctx.strokeStyle = col === "gold" ? "#fff0a0" : "#ffffff"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-40, y0 + sk); ctx.lineTo(W + 40, y0); ctx.moveTo(W + 40, y1 - sk); ctx.lineTo(-40, y1); ctx.stroke();
      ctx.restore();
    }, { seq: true });
    const txt = T(col === "gold" ? "lcd.cutinGold" : col === "red" ? "lcd.cutinRed" : "lcd.cutinBlue");
    telop(txt, { x: 280, y: 172, size: col === "gold" ? 32 : 36, cls: col === "gold" ? "rainbow" : col === "red" ? "red" : "blue", anim: "slideL", inD: 0.2, dur: 1.25, rot: -6 });
    flash(c, 0.5, 4); shake(4);
    ctxs.emit("cutin");
  }
  function kokuchiFx(ctxs) {
    playClip("kokuchi");
    flash(C.white, 1, 2.2); shake(12);
    addActor("top", 1.5, (ctx, age) => {
      const u = clamp(age / 1.5, 0, 1), k = 1 - E.in(u);
      ctx.globalAlpha = 0.75 * k;
      const gr = ctx.createRadialGradient(CX, 168, 10, CX, 168, 260);
      gr.addColorStop(0, "rgba(255,250,220,0.95)"); gr.addColorStop(0.25, "rgba(255,190,40,0.75)"); gr.addColorStop(1, "rgba(40,22,0,0.95)");   // the 神龍's gold
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      speedLines(ctx, CX, 168, 50, C.white, 0.6 * k, 40, Math.floor(age * 30));
      for (let i = 0; i < 3; i++) {
        const d = age - i * 0.25;
        if (d >= 0 && d < 0.25) lightning(ctx, rand(40, 352), -10, CX + rand(-40, 40), 168, i * 11 + Math.floor(d * 40), C.gold, 3, 1 - d / 0.25);
      }
    }, { seq: true });
    fireBurst(CX, 168, 30, 260, "front");
    telop(T("lcd.kokuchi"), { x: CX, y: 168, size: 88, cls: "kokuchi", font: FONT_POP, anim: "slam", inD: 0.16, dur: 1.4, jitter: 6 });
    ctxs.emit("kokuchi");
  }
  function holdChangeFx(to, ctxs) {
    addActor("front", 0.6, (ctx, age) => {
      const u = age / 0.6;
      if (u < 0.35) lightning(ctx, ped.x + 30, 120, ped.x, ped.y - 4, 3 + Math.floor(age * 40), HOLD_RGB[to] || C.white, 2.4, 1 - u / 0.35);
    }, { seq: true });
    ped.c = to; ped.chT0 = clk.t;
    burst("front", ped.x, ped.y - 4, 22, { cols: [HOLD_RGB[to] || C.white, C.white], v0: 60, v1: 200, l0: 0.3, l1: 0.7, s0: 1, s1: 2.4 });
    flash(HOLD_RGB[to] || C.white, 0.25, 4); shake(2);
    telop(T("lcd.holdChange"), { x: CX, y: 246, size: 30, dur: 1.4, cls: to === "rainbow" ? "rainbow" : to === "gold" ? "gold" : to === "red" ? "red" : to === "green" ? "green" : "blue", anim: "pop" });
    ctxs.emit("holdChange");
  }
  function sealFx(n) {
    addActor("mid", 1.0, (ctx, age) => {
      const ui = clamp(age / 0.2, 0, 1), uo = clamp((age - 0.8) / 0.2, 0, 1);
      const s = lerp(2.4, 1, E.out(ui)) * (1 + uo * 0.3);
      ctx.globalAlpha = ui * (1 - uo);
      ctx.translate(CX, 176); ctx.scale(s, s); ctx.rotate(-0.12);
      ctx.save(); ctx.globalCompositeOperation = "lighter"; drawGlow(ctx, C.red, 0, 0, 90, 0.6); ctx.restore();
      ctx.scale(1.18, 1.18);
      ctx.fillStyle = "#1a0000"; ctx.beginPath(); ctx.arc(0, 0, 52, 0, TAU); ctx.fill();
      const rg = ctx.createLinearGradient(-50, -50, 50, 50);
      rg.addColorStop(0, "#fffbe0"); rg.addColorStop(0.4, "#ffc21a"); rg.addColorStop(0.7, "#7a4200"); rg.addColorStop(1, "#ffe58a");
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, 49, 0, TAU); ctx.fill();
      const dg = ctx.createRadialGradient(-12, -14, 4, 0, 0, 44);
      dg.addColorStop(0, "#ff6a4a"); dg.addColorStop(0.6, "#b00808"); dg.addColorStop(1, "#4a0000");
      ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(0, 0, 42, 0, TAU); ctx.fill();
    }, { seq: true });
    telop("×" + n, { x: CX, y: 178, size: 62, cls: "gold", anim: "stamp", rot: -7, dur: 1.0, inD: 0.2 });
    telop(T("lcd.pseudo"), { x: CX, y: 96, size: 24, cls: "silver", anim: "pop", dur: 1.0 });
    addActor("front", 0.5, (ctx, age) => ring(ctx, CX, 176, 50 + age * 400, 6 * (1 - age / 0.5), C.gold, 1 - age / 0.5), { seq: true });
  }
  async function pseudoCycle(n, ctxs) {
    const a = randi(1, 9); let b = randi(1, 9); if (b === a) b = near(a);
    ctxs.stops = 0;
    await stopE(0, a, 0.22, ctxs); await wait(0.22);
    await stopE(2, b, 0.22, ctxs); await wait(0.26);
    reelSpeed(reels[1], 7, 6); await wait(0.25);
    await stopE(1, "NEXT", 0.42, ctxs);
    reels[1].glow = 1;
    await wait(0.2);
    sealFx(n); flash(C.white, 0.6, 4); shake(6);
    ctxs.emit("pseudo:" + n);
    await wait(1.0);
    reels[1].glow = 0;
    reels.forEach((r) => reelSpin(r, 16));
    await wait(0.75);
  }

  // ------------------------------------------------------------------ reach sequences
  const REACH_CLS = { blue: "blue", red: "red", gold: "gold", rainbow: "rainbow" };
  async function pushFinish(ctxs) {
    const btn = addActor("top", Infinity, (ctx, age, a) => {
      const ui = clamp(age / 0.22, 0, 1);
      let s = E.back(ui) * (1 + 0.06 * Math.sin(age * 14));
      if (a.hitT != null) { const u = clamp((clk.t - a.hitT) / 0.25, 0, 1); s *= 1 + u * 0.6; ctx.globalAlpha = 1 - u; }
      for (let k = 0; k < 3; k++) { const u = (age * 1.6 + k / 3) % 1; ring(ctx, CX, 196, 50 + u * 70, 3, C.red, (1 - u) * 0.8 * (a.hitT == null ? 1 : 0)); }
      ctx.translate(CX, 196); ctx.scale(s, s);
      drawSpr(ctx, SPR.push, 0, 0, 1);
    }, { seq: true });
    const tp = telop("PUSH!!", { x: CX, y: 118, size: 40, cls: "red", font: FONT_POP, anim: "pop", stay: true, pulse: 0.06 });
    ctxs.emit("pushPrompt");
    const auto = !!(ctxs.opts && ctxs.opts.autoPush);
    const res = await waitPush(auto ? 3 : 6, auto);
    btn.hitT = clk.t; telopOut(tp, 0.15);
    if (res !== "push" && ctxs.opts && ctxs.opts.onPush) try { ctxs.opts.onPush("auto"); } catch (e) { /* ignore */ }
    ctxs.emit("pushHit");
    flash(C.white, 0.9, 4); shake(6);
    burst("front", CX, 196, 30, { cols: [C.white, C.gold, C.red], v0: 120, v1: 360, s0: 1.5, s1: 3 });
    await wait(0.3);
    btn.kill = true;
  }
  async function reviveFx(ctxs, cls) {
    tween(fx, { dim: 0.55, gray: 0.8 }, 0.25);
    await wait(0.9);
    flash(C.white, 1, 2.5); shake(10);
    tween(fx, { dim: 0, gray: 0 }, 0.2);
    telop(T("lcd.revive"), { x: CX, y: 92, size: 58, cls: cls || "rainbow", anim: "slam", dur: 1.6, jitter: 3 });
    addActor("back", 1.6, (ctx, age) => drawRays(ctx, CX, 180, hueRgb(age * 300), age * 2, 0.6 * (1 - age / 1.6), 460, 20, true), { seq: true });
    ctxs.emit("revive");
  }
  async function finalStopCenter(S, r, ctxs, T) {
    const rv = S.hit && r.revive;
    const d = S.hit && !rv ? S.final[1] : rv ? near(S.final[1]) : S.final[1];
    await stopE(1, d, T || 0.9, ctxs);
    if (rv) {
      await reviveFx(ctxs);
      // shatter the miss digit and drop in the hit one
      shardBurst(reels[1].lay.x, reels[1].lay.y, C.gold, 30);
      reelSpin(reels[1], 18); await wait(0.25);
      ctxs.stops = 2; // the centre reel lands again: re-emit reelStop2
      await stopE(1, S.final[1], 0.3, ctxs);
    }
  }
  async function reachSeq(S, ctxs) {
    const r = S.reach, rushy = S.mode !== "normal";
    ctxs.emit("reach");
    flash(C.white, 0.35, 5);
    const rc = REACH_CLS[r.color] || "red";
    const rt = telop(T("lcd.reach"), { x: CX, y: 92, size: 46, cls: rc, anim: "slam", dur: rushy ? 1.0 : 1.5 });
    tween(fx, { vign: 0.55 }, 0.3); fx.vignC = r.color === "blue" ? C.blue : r.color === "gold" ? C.gold : C.red; fx.vignP = 6;
    reels[0].glow = reels[2].glow = 1;
    layout("reach", 0.45, E.back);
    reelSpeed(reels[1], 6, 4);
    if (r.type === "normal") {
      await wait(rushy ? 0.5 : 1.0);
      reelSpeed(reels[1], 3, 2);
      await wait(rushy ? 0.3 : 0.9);
      if (r.push) await pushFinish(ctxs);
      await finalStopCenter(S, r, ctxs, rushy ? 0.6 : 1.1);
      return;
    }
    await wait(rushy ? 0.6 : 1.1);
    telopOut(rt, 0.1);
    // ---- development (リーチ発展)
    ctxs.emit("reachUp");
    flash(C.white, 1, 3); shake(6);
    tween(fx, { vign: 0, logoA: 0 }, 0.25);
    reels[0].glow = reels[2].glow = 0;
    layout("corner", 0.35);
    reelSpeed(reels[1], 12, 6);
    if (r.type === "sp") await spSeq(S, r, ctxs);
    else if (r.type === "battle") { await battleSeq(S, r, ctxs); return; }
    else await spspSeq(S, r, ctxs);
    if (r.push) await pushFinish(ctxs);
    await finalStopCenter(S, r, ctxs, 1.0);
  }
  async function spSeq(S, r, ctxs) {
    setScene("sp", 0.15, { c: r.color });
    // The 神龍 flies across, right to left, its body moving (the fly sprite). Without it, the clip
    // of the 神龍 in the storm fills the LCD instead.
    const fly = IMG.fly_head && IMG.fly_body && IMG.fly_tail;
    const clip = fly ? null : playClip("sp");
    const pal = r.color === "gold" || r.color === "rainbow" ? "gold" : r.color === "blue" ? "azure" : "fire";
    const glowCol = pal === "azure" ? C.cyan : pal === "gold" ? C.gold : C.orange;
    addActor("back", 4.4, (ctx, age, a) => {
      const u = clamp(age / 4.1, 0, 1), ue = 0.35 * u + 0.65 * E.io(u);
      let d;
      const sd = IMG.shinryu || IMG.rival;
      // Once the clip shows, it is the 神龍; the drawn one only stands in while it loads (or without it).
      if (clip && !clip.paused && clip.readyState >= 2) a.clipSeen = true;
      if (a.clipSeen) { a.mx = null; return; }
      if (fly) {   // the long 神龍 swims in from the right, head first, and its tail leaves on the left
        const v = clamp(age / FLY.dur, 0, 1), ve = 0.55 * v + 0.45 * E.io(v);
        const hw = (FLY.headH * IMG.fly_head.naturalWidth) / IMG.fly_head.naturalHeight, back = (FLY.join[0] - 0.5) * hw + FLY.len + 80;
        const x = lerp(W + hw / 2 + 10, -back - 10, ve), y = 168 + Math.sin(age * 1.3) * 8 - Math.sin(v * Math.PI) * 18;
        ctx.save(); ctx.globalCompositeOperation = "lighter"; drawGlow(ctx, glowCol, x, y, hw * 0.7, 0.45); ctx.restore();
        d = drawFlyDragon(ctx, x, y, age);
      } else if (sd) {
        // the 神龍 (龍神), lit in the reach colour: a still picture, so it rises into place and
        // breathes there instead of sliding across like a cut-out
        const rise = E.out(clamp(age / 0.9, 0, 1)), al = clamp(age / 0.5, 0, 1) * (1 - clamp((age - 3.7) / 0.5, 0, 1));
        const x = CX + 40, y = 172 + (1 - rise) * 46 + Math.sin(age * 1.6) * 5, h = 270 * (0.8 + 0.2 * rise + 0.015 * Math.sin(age * 2.2));
        ctx.save(); ctx.globalAlpha = al;
        ctx.globalCompositeOperation = "lighter"; drawGlow(ctx, glowCol, x, y, 210 * (0.7 + 0.3 * rise), 0.5);
        ctx.globalCompositeOperation = "source-over";
        d = drawArtDragon(ctx, sd, x, y, h, false);
        ctx.restore();
      } else {
        const x = lerp(W + 90, -330, ue), y = 176 + Math.sin(age * 1.6) * 20 - Math.sin(u * Math.PI) * 34;
        d = drawDragon(ctx, { x, y, sc: 1.22, dir: -1, t: age * 1.4, len: 450, w0: 17, amp: 0.45, wave: 1.25, spd: 4, pal, glow: true, jaw: 0.25 + 0.2 * Math.sin(age * 5) });
      }
      a.mx = d.mx; a.my = d.my;
      if (age > 1.8 && age < 2.4) { ctx.globalCompositeOperation = "lighter"; drawGlow(ctx, C.white, d.mx, d.my, 70, 0.7 * Math.sin(((age - 1.8) / 0.6) * Math.PI)); }
    }, {
      seq: true,
      upd(dt, age, a) {
        if (a.mx == null || rng() > dt * 40) return;
        emit("back", { x: a.mx + rand(10, 60), y: a.my + rand(-30, 30), vx: rand(20, 80), vy: rand(-20, 20), life: rand(0.4, 0.8), s0: rand(1.5, 3), s1: 0.3, col: pal === "azure" ? C.cyan : C.gold });
      },
    });
    telop(T("lcd.spReach"), { x: CX, y: 98, size: 42, cls: REACH_CLS[r.color] || "red", anim: "slam", dur: 2.2, font: FONT_DIGIT });
    await wait(2.0); shake(5); flash(C.white, 0.35, 4);
    await wait(2.3);
    layout("spFinal", 0.45, E.back);
    reelSpeed(reels[1], 5, 4);
    reels[0].glow = reels[2].glow = 1;
    const sub = telop(T("lcd.spChance"), { x: CX, y: 64, size: 26, cls: REACH_CLS[r.color] || "red", anim: "pop", stay: true, pulse: 0.05 });
    await wait(0.6); reelSpeed(reels[1], 2.4, 2);
    await wait(1.0);
    telopOut(sub, 0.2);
  }
  async function spspSeq(S, r, ctxs) {
    setScene("spsp", 0.1);
    const clip = playClip("spsp");   // the 神龍 bursting into flames fills the LCD under the big 激アツ
    shake(10); flash(C.gold, 1, 2.5);
    addActor("back", Infinity, (ctx, age) => {
      if (goldDragon()) {   // the 神龍, breathing slightly
        ctx.save(); ctx.globalCompositeOperation = "lighter"; drawGlow(ctx, C.gold, CX, H / 2, 240, 0.45); ctx.restore();
        drawArtDragon(ctx, goldDragon(), CX, H / 2 + 8, H * (0.98 + 0.015 * Math.sin(age * 2)), false);
      } else drawDragon(ctx, { x: CX + 6, y: 92, sc: 0.98, dir: 1, t: age * 0.7, len: 480, w0: 17, ang: 0.1, curl: -5.4, amp: 0.1, wave: 1, spd: 1.2, pal: "gold", glow: true, alpha: 0.95, jaw: 0.3 });
    }, { seq: true });
    const big = telop(T("lcd.spsp"), { x: CX, y: 172, size: 112, cls: "rainbow", font: FONT_BRUSH, anim: "slam", stay: true, inD: 0.3, jitter: 4 });
    fireBurst(CX, 180, 40, 300, "front");
    await wait(1.7);
    if (clip) { clip.classList.remove("on"); setTimeout(() => clip.pause(), 400); }   // back to the reels
    telopOut(big, 0.2);
    telop(T("lcd.spspReach"), { x: CX, y: 54, size: 30, cls: "rainbow", anim: "drop", stay: true, inD: 0.5 });
    layout("spFinal", 0.45, E.back);
    reelSpeed(reels[1], 5, 4);
    reels[0].glow = reels[2].glow = 1;
    await wait(0.8); reelSpeed(reels[1], 2.2, 2);
    await wait(1.4);
  }
  async function battleSeq(S, r, ctxs) {
    setScene("battle", 0.15);
    const B = { hx: -140, hy: H + 26, hsc: 1.0, hs: -1.05, hRot: 0, hDim: 0, hAura: 0.4, hRim: "fire", hA: 1,
      dx: W + 200, dy: 128, dsc: 1.1, dJaw: 0.2, dA: 1, dDim: 0, hp1: 1, hp2: 1, hpA: 0, breath: 0,
      dash: 0, pose: null, dHitT: -9, hHitT: -9, pops: [] };
    let dHead = { mx: 0, my: 0 };
    const kick = (t0, px) => { const k = clk.t - t0; return k < 0.35 ? px * Math.exp(-k * 9) : 0; };   // knocked back by a hit
    addActor("back", Infinity, (ctx, age) => {
      if (B.dA > 0.01) {
        const dx = B.dx + kick(B.dHitT, 16), lit = 1 - (clk.t - B.dHitT) / 0.12;
        if (IMG.rival) {
          ctx.globalAlpha = B.dA; drawContain(ctx, IMG.rival, dx - 150, 50, 300, 270, true);
          if (lit > 0) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = B.dA * 0.6 * lit; drawContain(ctx, IMG.rival, dx - 150, 50, 300, 270, true); ctx.globalCompositeOperation = "source-over"; }
          ctx.globalAlpha = 1;
          dHead = { mx: dx - 80, my: 170 };
        }
        else dHead = drawDragon(ctx, { x: dx, y: B.dy, sc: B.dsc, dir: -1, t: age * 1.2, len: 400, w0: 18, ang: 0.35, curl: -2.2, amp: 0.3, wave: 1.1, spd: 2.6, pal: "fire", glow: true, alpha: B.dA, jaw: B.dJaw });
        if (B.dDim > 0) { ctx.globalAlpha = B.dDim * 0.5; ctx.fillStyle = "#000"; ctx.fillRect(dx - 80, 0, W, H); ctx.globalAlpha = 1; }
      }
      const hx = B.hx + kick(B.hHitT, -14);
      if (IMG.hero) {   // pivots at its feet and sinks like the drawn warrior (敗北: hy, hRot)
        const im = (B.pose === "slash" && IMG.pose_slash) || IMG.hero;
        const one = (x, a) => {
          ctx.save(); ctx.globalAlpha = a;
          ctx.translate(x, H); ctx.rotate(B.hRot); ctx.translate(0, B.hy - (H + 26));
          drawContain(ctx, im, -120, 40 - H, 240, 280, true);
          ctx.restore();
        };
        if (B.dash > 0.02) {   // afterimages while dashing
          ctx.save(); ctx.globalCompositeOperation = "lighter";
          for (let i = 3; i >= 1; i--) one(hx - i * 22, B.dash * 0.22 * (1 - i / 4));
          ctx.restore();
        }
        one(hx, B.hA * (1 - B.hDim * 0.6));
      }
      else drawWarrior(ctx, { x: hx, y: B.hy, sc: B.hsc, t: age, sword: B.hs, rot: B.hRot, dim: B.hDim, aura: B.hAura, rim: B.hRim, alpha: B.hA });
    }, { seq: true });
    // HP bars
    addActor("top", Infinity, (ctx) => {
      if (B.hpA <= 0.01) return;
      ctx.globalAlpha = B.hpA;
      const bar = (x, w, v, c1, c2, label, right) => {
        ctx.fillStyle = "rgba(0,0,0,0.75)"; roundRect(ctx, x - 2, 14, w + 4, 16, 5); ctx.fill();
        const gr = ctx.createLinearGradient(0, 16, 0, 28); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
        ctx.fillStyle = gr; const vw = w * clamp(v, 0, 1);
        roundRect(ctx, right ? x + w - vw : x, 16, Math.max(2, vw), 12, 4); ctx.fill();
        ctx.strokeStyle = "#ffe08a"; ctx.lineWidth = 1.2; roundRect(ctx, x - 2, 14, w + 4, 16, 5); ctx.stroke();
        // names sit at the inner (VS) ends, clear of the small corner digits at the top left
        ctx.font = "11px " + FONT_TC; ctx.textAlign = right ? "left" : "right"; ctx.lineWidth = 3; ctx.strokeStyle = "#000"; ctx.fillStyle = "#fff";
        ctx.strokeText(label, right ? x : x + w, 44); ctx.fillText(label, right ? x : x + w, 44);
      };
      bar(40, 128, B.hp1, "#9affb0", "#10a040", T("lcd.hero"), false);
      bar(224, 128, B.hp2, "#ffb08a", "#c01000", T("lcd.rival"), true);
      ctx.font = "16px " + FONT_DIGIT; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "#000"; ctx.fillStyle = "#ffd24a";
      ctx.strokeText("VS", CX, 29); ctx.fillText("VS", CX, 29);
    }, { seq: true });
    addActor("top", Infinity, (ctx) => drawPops(ctx, B.pops), { seq: true });
    const pop = (v, x, y, size, col) => { B.pops.push({ v, x, y, t: clk.t, size, col }); if (B.pops.length > 16) B.pops.shift(); };
    // fire breath emitter
    addActor("top", Infinity, () => {}, {
      seq: true,
      upd(dt) {
        if (B.breath <= 0) return;
        const n = dt * 70 * B.breath;
        for (let i = 0; i < n; i++) emit("front", { x: dHead.mx, y: dHead.my, vx: rand(-420, -300), vy: rand(-50, 60), ay: -40, drag: 0.8, life: rand(0.45, 0.7), s0: rand(6, 10), s1: rand(26, 40), a0: 0.95, a1: 0, type: "fire" });
      },
    });
    const film = playClipToEnd("battle", 3.4);   // the face-off on film, when there is a clip
    telop(T("lcd.battle"), { x: CX, y: 112, size: 44, cls: "fire", anim: "slam", dur: film ? 2.4 : 1.3 });
    tween(B, { hx: 96 }, 0.5, E.out); tween(B, { dx: 312 }, 0.55, E.out);
    await wait(0.9);
    if (film) await film;
    telop("VS", { x: CX, y: 176, size: 70, cls: "gold", anim: "stamp", dur: 0.8, rot: -8 });
    flash(C.white, 0.6, 4); shake(6);
    addActor("mid", 0.4, (ctx, age) => { for (let i = 0; i < 3; i++) lightning(ctx, CX, 40, CX + (i - 1) * 60, 300, i * 5 + Math.floor(age * 30), C.gold, 2, 1 - age / 0.4); }, { seq: true });
    await wait(0.7);
    tween(B, { hpA: 1 }, 0.3);
    // ---- clash phase with 連打
    renda.on = true; renda.n = 0; renda.g = 0.15; renda.auto = !!(ctxs.opts && ctxs.opts.autoPush); renda.lastAuto = clk.t;
    const rtp = telop(T("lcd.renda"), { x: CX, y: 252, size: 26, cls: "gold", font: FONT_POP, anim: "pop", stay: true, pulse: 0.08 });
    const gauge = addActor("top", Infinity, (ctx) => {
      ctx.fillStyle = "rgba(0,0,0,0.7)"; roundRect(ctx, 106, 268, 180, 12, 6); ctx.fill();
      const gr = ctx.createLinearGradient(106, 0, 286, 0); gr.addColorStop(0, "#ffb000"); gr.addColorStop(0.6, "#ff4a00"); gr.addColorStop(1, "#ff0040");
      ctx.fillStyle = gr; roundRect(ctx, 108, 270, 176 * renda.g, 8, 4); ctx.fill();
      ctx.strokeStyle = "#ffe08a"; ctx.lineWidth = 1.4; roundRect(ctx, 106, 268, 180, 12, 6); ctx.stroke();
    }, { seq: true });
    renda.onHit = () => {   // every PUSH lands a small hit of its own
      B.dHitT = clk.t; B.hp2 = Math.max(0.3, B.hp2 - 0.006);
      pop(10 + Math.floor(rng() * 90), rand(250, 330), rand(90, 180), 15);
    };
    // the hero dashes in with a flame slash
    const heroStrike = async () => {
      ctxs.emit("atk:hero");
      B.pose = "slash"; B.dash = 1;
      tween(B, { hx: 168, hs: 0.45 }, 0.16, E.out); tween(B, { dash: 0 }, 0.45);
      await wait(0.16);
      const cx0 = rand(260, 320), cy0 = rand(110, 170);
      addActor("mid", 0.45, (ctx, age) => slashArc(ctx, cx0 - 40, cy0 + 40, 110, -2.4, -0.4, 22, age / 0.45, C.orange), { seq: true });
      fireBurst(cx0, cy0, 14, 160, "front");
      burst("front", cx0, cy0, 22, { cols: [C.white, C.gold, C.orange], v0: 100, v1: 360, s0: 1.2, s1: 2.8, len: 22 });
      flash(C.white, 0.3, 6); shake(5);
      B.dHitT = clk.t; B.hp2 = Math.max(0.3, B.hp2 - 0.14);
      pop(800 + Math.floor(rng() * 700), cx0, cy0 - 24, 28);
      await wait(0.2);
      B.pose = null; tween(B, { hx: 96, hs: -1.05 }, 0.3, E.out);
      await wait(0.3);
    };
    // the dragon hits back: fire breath, then a claw swipe
    const dragonBreath = async () => {
      ctxs.emit("atk:dragon");
      tween(B, { dJaw: 0.55, dx: 300 }, 0.15);
      B.breath = 1;
      await wait(0.5);
      B.breath = 0; tween(B, { dJaw: 0.2, dx: 312 }, 0.25);
      shake(4); flash(C.orange, 0.3, 5);
      B.hHitT = clk.t; B.hp1 = Math.max(0.35, B.hp1 - 0.16);
      pop(300 + Math.floor(rng() * 400), 110, 130, 24, "#ff8a7a");
      await wait(0.3);
    };
    const dragonClaw = async () => {
      ctxs.emit("atk:dragon");
      tween(B, { dx: 236 }, 0.16, E.in);
      await wait(0.16);
      for (let i = 0; i < 3; i++) {
        const o = (i - 1) * 18;
        addActor("mid", 0.35, (ctx, age) => slashArc(ctx, 150 + o, 110 + o, 70, -0.9, 1.3, 12, age / 0.35, C.red), { seq: true });
      }
      flash(C.red, 0.35, 5); shake(6);
      B.hHitT = clk.t; B.hp1 = Math.max(0.35, B.hp1 - 0.16);
      pop(400 + Math.floor(rng() * 400), 104, 120, 24, "#ff8a7a");
      await wait(0.2);
      tween(B, { dx: 312 }, 0.3, E.out);
      await wait(0.25);
    };
    await heroStrike(); await dragonBreath(); await heroStrike(); await dragonClaw();
    renda.on = false; renda.onHit = null; telopOut(rtp, 0.15); gauge.kill = true;
    // ---- PUSH finish
    if (r.push) await pushFinish(ctxs); else await wait(0.3);
    const win = S.hit && !r.revive;
    // final exchange in slow motion: both charge, the frame holds as they meet, then the blow
    const sc0 = clk.scale;
    ctxs.emit("slowmo");
    tween(fx, { dim: 0.3 }, 0.1);
    const lines = addActor("top", Infinity, (ctx, age) => speedLines(ctx, CX, 170, 36, C.white, 0.35, 70, Math.floor(age * 40)), { seq: true });
    clk.scale = sc0 * 0.3;
    B.pose = "slash"; B.dash = 1;
    tween(B, { hx: 200, hs: 0.6 }, 0.22, E.in);
    tween(B, { dx: 260, dJaw: 0.6 }, 0.22, E.in);
    await wait(0.22);
    clk.scale = sc0 * 0.04; await wait(0.016);   // about 0.4 s frozen
    clk.scale = sc0;
    lines.kill = true; tween(fx, { dim: 0 }, 0.15);
    ctxs.emit("finalBlow");
    flash(C.white, 1, 2); shake(12);
    addActor("mid", 0.7, (ctx, age) => {
      const u = age / 0.7;
      slashArc(ctx, CX, 330, 300, -2.7, -0.45, 46, u, win ? C.gold : C.red);
      speedLines(ctx, CX, 170, 40, C.white, 0.5 * (1 - u), 50, Math.floor(age * 30));
    }, { seq: true });
    await wait(0.6);
    B.dash = 0;
    if (win) await battleWinFx(B, ctxs);
    else {
      // lose: the dragon's fire (on film, when there is a clip) and the hero falls
      B.pose = null;
      B.breath = 1.4; tween(B, { dx: 300, dJaw: 0.6, hx: 70 }, 0.2);
      const fire = playClipToEnd("lose", 3.4);
      await wait(0.6); B.breath = 0;
      tween(B, { hRot: -0.25, hy: H + 90, hDim: 0.85, hAura: 0, hp1: 0 }, 0.5, E.out);
      tween(B, { dJaw: 0.2, dx: 312 }, 0.4);
      shake(6);
      if (fire) await wait(1.0);   // 敗北 lands over the clip's last second
      telop(T("lcd.lose"), { x: CX, y: 150, size: 54, cls: "gray", anim: "drop", dur: S.hit ? 1.5 : 1.9, inD: 0.5 });
      tween(fx, { gray: 0.85, dim: 0.25 }, 0.4);
      ctxs.emit("battleLose");
      await wait(1.6);
      if (fire) await fire;
      if (S.hit && r.revive) {
        tween(fx, { gray: 0, dim: 0.5 }, 0.2);
        await wait(0.3);
        // heartbeat
        flash(C.red, 0.5, 3); shake(3); await wait(0.35); flash(C.red, 0.7, 3); shake(5); await wait(0.3);
        tween(fx, { dim: 0 }, 0.2);
        B.hRim = "gold";
        tween(B, { hRot: 0, hy: H + 26, hDim: 0, hAura: 1.2, hx: 110, hp1: 0.5 }, 0.35, E.back);
        flash(C.white, 1, 2.5); shake(10);
        telop(T("lcd.revive"), { x: CX, y: 92, size: 60, cls: "rainbow", anim: "slam", dur: 1.4, jitter: 3 });
        addActor("back", 2.2, (ctx, age) => drawRays(ctx, 110, 170, hueRgb(age * 300), age * 2, 0.55 * (1 - age / 2.2), 460, 20, true), { seq: true });
        ctxs.emit("revive");
        await wait(1.2);
        tween(B, { hx: 220, hs: 0.6 }, 0.18, E.in); await wait(0.18);
        flash(C.white, 1, 2); shake(12);
        addActor("mid", 0.7, (ctx, age) => slashArc(ctx, CX, 330, 300, -2.7, -0.45, 52, age / 0.7, C.gold), { seq: true });
        await wait(0.5);
        await battleWinFx(B, ctxs);
      } else {
        tween(fx, { gray: 0 }, 0.4);
      }
    }
    // reveal digits
    tween(B, { hpA: 0 }, 0.2);
    layout(S.hit ? "hit" : baseLay(), 0.35, E.back);
    await stopE(1, S.final[1], 0.25, ctxs);
    if (!S.hit) { reels.forEach((rr) => (rr.dim = 0.5)); }
  }
  async function battleWinFx(B, ctxs) {
    B.pose = null; B.hRim = "gold";
    const victory = () => {
      addActor("back", 2.0, (ctx, age) => drawRays(ctx, 120, 180, C.gold, age * 1.2, 0.6, 460, 18, true), { seq: true });
      telop(T("lcd.win"), { x: CX + 30, y: 142, size: 66, cls: "gold", anim: "slam", dur: 1.6, inD: 0.2 });
      ctxs.emit("battleWin");
    };
    if (VID.win) {
      // the final blow on film: white in, the whole clip, white out onto 勝利!!
      white(1, 0.12); await wait(0.14);
      Object.assign(B, { dA: 0, hp2: 0, hAura: 1.3, hx: 120, hs: -1.25 });
      const film = playClipToEnd("win", 3.6);
      white(0, 0.3);
      await film;
      white(1, 0.1); await wait(0.12);
      white(0, 0.5);
      victory();
      await wait(1.5);
      return;
    }
    // no clip: the dragon explodes on the canvas
    const ex = B.dx - 40, ey = B.dy + 20;
    fireBurst(ex, ey, 60, 320, "front");
    burst("front", ex, ey, 40, { cols: [C.gold, C.white, C.orange], v0: 150, v1: 480, s0: 1.5, s1: 3.5, len: 26 });
    shake(14); flash(C.gold, 0.9, 2.5);
    tween(B, { dA: 0, hpA: 1, hp2: 0 }, 0.6);
    tween(B, { hAura: 1.3, hx: 120, hs: -1.25 }, 0.4, E.out);
    victory();
    await wait(1.5);
  }

  // ------------------------------------------------------------------ main spin
  async function playSpinImpl(script, opts) {
    opts = opts || {};
    const S = norm(script);
    const ctxs = { emit: mkEmit(opts), opts, stops: 0 };
    curOpts = opts;
    clk.scale = opts.speed > 0 ? opts.speed : 1;
    try {
      resetStage();
      tween(fx, { logoA: 1 }, 0.25);
      layout(baseLay(), 0.25);
      ctxs.emit("spinStart");
      pedIn(S.holdColor);
      const rushy = S.mode !== "normal";
      const heavy = !!(S.reach || S.pseudo || S.stepup || S.gun || S.cutin || S.kokuchi || S.holdChangeTo);
      const fast = S.fast && !heavy;
      if (opts.skip) {
        reels.forEach((r) => reelSpin(r, 20));
        await wait(0.18);
        await Promise.all([stopE(0, S.final[0], 0.16, ctxs), stopE(2, S.final[2], 0.18, ctxs), stopE(1, S.final[1], 0.2, ctxs)]);
      } else {
        reels.forEach((r) => reelSpin(r, fast ? 20 : 16));
        if (fast) {
          await wait(rushy ? 0.3 : 0.38);
          await stopE(0, S.final[0], 0.16, ctxs); await wait(0.07);
          await stopE(2, S.final[2], 0.16, ctxs); await wait(0.07);
          await stopE(1, S.final[1], 0.16, ctxs);
        } else {
          const t0 = clk.t;
          if (S.holdChangeTo) { await wait(0.32); holdChangeFx(S.holdChangeTo, ctxs); await wait(0.55); }
          if (S.kokuchi) { await wait(0.15); kokuchiFx(ctxs); await wait(1.3); }
          if (S.stepup > 0) await stepupFx(Math.min(5, S.stepup), ctxs);
          if (S.gun) { gunFx(ctxs); await wait(1.75); }
          if (S.cutin) { cutinFx(S.cutin, ctxs); await wait(1.3); }
          const minRun = rushy ? 0.45 : 1.25;
          if (clk.t - t0 < minRun) await wait(minRun - (clk.t - t0));
          for (let p = 0; p < Math.min(3, S.pseudo || 0); p++) await pseudoCycle(p + 2, ctxs);
          ctxs.stops = 0;
          await stopE(0, S.final[0], 0.24, ctxs);
          await wait(rushy ? 0.12 : 0.38);
          await stopE(2, S.final[2], 0.24, ctxs);
          if (S.reach) await reachSeq(S, ctxs);
          else { await wait(rushy ? 0.1 : 0.32); await stopE(1, S.final[1], 0.26, ctxs); }
        }
      }
      if (S.hit) await hitConfirm(S, ctxs);
      else {
        ctxs.emit("miss");
        if (S.reach) { reels.forEach((r) => (r.dim = 0.5)); tween(fx, { vign: 0 }, 0.3); }
        await wait(S.reach ? 0.6 : fast ? 0.08 : 0.2);   // 保留短縮: the next spin follows almost at once
      }
    } finally {
      clk.scale = 1;
      curOpts = null;
      pedOut();
      if (!S.hit) {
        resetStage();
        tween(fx, { logoA: 1 }, 0.3);
        layout(baseLay(), 0.3);
        reels.forEach((r) => (r.dim = S.reach ? 0.25 : 0));
      }
    }
  }
  async function hitConfirm(S, ctxs) {
    ctxs.emit("hitConfirm");
    flash(C.white, 1, 2.2); shake(7);
    tween(fx, { vign: 0, gray: 0, dim: 0 }, 0.2);
    layout("hit", 0.3, E.back);
    hitPulse.on = true; hitPulse.t0 = clk.t;
    reels.forEach((r) => { r.glow = 1; r.dim = 0; });
    burst("front", CX, 172, 40, { cols: [C.gold, C.white, C.yellow], v0: 120, v1: 420, s0: 1.4, s1: 3.4, len: 22 });
    for (let i = 0; i < 12; i++) emit("front", { x: rand(30, W - 30), y: rand(110, 240), life: rand(0.5, 0.9), s0: 0, s1: rand(8, 14), a0: 1, a1: 0, type: "star", col: C.gold, vr: 3 });
    await wait(1.0);
  }

  // ------------------------------------------------------------------ jackpot / bonus / rush
  async function playJackpotImpl(script) {
    const S = norm(script);
    resetStage(true);
    hudHide = true;
    flash(C.white, 1, 1.4); shake(10);
    setScene("jackpot", 0);
    playClip("jackpot");
    tween(fx, { logoA: 0 }, 0.1);
    reels.forEach((r, i) => { reelSet(r, S.final[i]); r.glow = 1; r.dim = 0; });
    hitPulse.on = true; hitPulse.t0 = clk.t;
    reels.forEach((r, i) => { r.lay.x = LAY.jackpot[i][0]; r.lay.y = 172; r.lay.s = 2.6; r.lay.a = 0; });
    reels.forEach((r, i) => tween(r.lay, { s: LAY.jackpot[i][2], a: 1 }, 0.5, E.back));
    burst("front", CX, 172, 60, { cols: [C.gold, C.white, C.yellow, C.orange], v0: 160, v1: 520, s0: 1.6, s1: 3.6, len: 28 });
    fireBurst(CX, 190, 40, 320, "front");
    await wait(0.3);
    telop(T("lcd.jackpot"), { x: CX, y: 64, size: 62, cls: "gold", anim: "slam", stay: true, inD: 0.22, pulse: 0.03 });
    addActor("top", Infinity, (ctx, age) => {
      for (let i = 0; i < 5; i++) {
        const ph = (age * 1.5 + i * 0.37) % 1;
        star4(ctx, 70 + i * 63 + Math.sin(i * 2) * 10, 40 + ((i * 37) % 50), 9 * Math.sin(ph * Math.PI), 1);
      }
    }, { seq: true });
    await wait(1.0);
    const kind = S.kind || (S.mode === "normal" ? "3R" : "10R");
    const big = kind === "10R";
    telop(kind + " BONUS", { x: CX, y: 266, size: big ? 36 : 32, cls: big ? "rainbow" : kind === "6R" ? "red" : "gold", anim: "drop", stay: true, inD: 0.45 });
    if (S.final[0] === 7) telop("PREMIUM", { x: CX, y: 234, size: 20, cls: "rainbow", anim: "pop", stay: true });
    await wait(1.4);
    shake(3);
    await wait(0.6);
    hudHide = false;
  }
  // Bonus rounds: each round shows another piece of the AI art, slowly zooming (crossfaded), with
  // a line of its own (the round screen used to be one still picture: the user found it dull).
  // Each round shows the next scene of the hero's journey with the 神龍 (round1..round10, full
  // screen). The count runs on across bonuses, so a new bonus continues the journey instead of
  // starting it over; without those pictures the hero cut-outs take turns as before.
  const ROUND_ART = ["round1", "round2", "round3", "round4", "round5", "round6", "round7", "round8", "round9", "round10"];
  const GALLERY = ["hero", "pose_slash", "jackpot", "cutin_hero", "pose_victory", "cab_dragon"];
  const gal = { cur: null, prev: null, t0: 0, n: 0 };
  function galleryNext() {
    let have = ROUND_ART.filter((k) => IMG[k]);
    if (!have.length) have = GALLERY.filter((k) => IMG[k]);
    if (!have.length) return;
    gal.prev = gal.cur; gal.cur = have[gal.n++ % have.length]; gal.t0 = clk.t;
  }
  function drawGalleryImg(ctx, key, a, t) {
    const im = IMG[key];
    if (!im || a <= 0.01) return;
    if (key.startsWith("round")) {   // a scene: cover the screen, slow push in and drift
      const z = 1.04 + 0.06 * Math.min(1, t / 9), px = (gal.n % 2 ? 1 : -1) * 8 * Math.min(1, t / 9);
      ctx.save(); ctx.globalAlpha = a;
      ctx.translate(CX + px, H / 2); ctx.scale(z, z); ctx.translate(-CX, -H / 2);
      drawCover(ctx, im, 0, 0, W, H); ctx.restore();
      return;
    }
    const z = 1 + 0.07 * Math.min(1, t / 9), px = (gal.n % 2 ? 1 : -1) * 10 * Math.min(1, t / 9);
    const gx = boss.on ? W * 0.33 : CX, bw = boss.on ? W * 0.66 : W - 48;   // the boss takes the right third
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(gx + px, H); ctx.scale(z, z); ctx.translate(-gx, -H);
    drawContain(ctx, im, gx - bw / 2, 26, bw, H - 26, true);
    ctx.restore();
  }
  function drawGallery(ctx) {
    const t = clk.t - gal.t0, f = Math.min(1, t / 0.6);
    if (gal.prev && f < 1) drawGalleryImg(ctx, gal.prev, 1 - f, t + 9);
    drawGalleryImg(ctx, gal.cur, f, t);
  }
  // 大当り: the 炎龍王 was beaten to get here, so the first rounds fight one of its 龍兵 (a
  // different one each bonus) on the right with a life bar. Every PUSH hits it (LCD.push), and a
  // knockout earns a reward the shell pays. It has 9 hits per round before the last one; the last
  // round is the 神龍覚醒チャレンジ (below), and a 龍兵 still standing then withdraws.
  const boss = { on: false, hp: 1, max: 1, down: false, hitT: -9, downT: 0, pops: [], k: -1, flee: false };
  const BOSS_HP_PER_ROUND = 9, MINIONS = 6;
  let minionN = -1;
  function bossStart(rounds, round) {
    if (minionN < 0) minionN = Math.floor(rng() * MINIONS);
    const hp = Math.max(1, (rounds - round) * BOSS_HP_PER_ROUND), k = minionN++ % MINIONS;
    Object.assign(boss, { on: true, hp, max: hp, down: false, hitT: -9, pops: [], k, flee: false });
    telop(T("lcd.bossHint", { name: minionName(k) }), { x: CX, y: 108, size: 19, cls: "red", anim: "pop", dur: 2.6, inD: 0.6 });   // under the life bar
  }
  const minionName = (k) => T("lcd.minions").split("|")[k] || T("lcd.rival");
  function minionArt(k) {
    if (IMG["minion" + (k + 1)]) return IMG["minion" + (k + 1)];
    return IMG.rival ? tinted(IMG.rival, ["#3a0a00", "#5a1000", "#200a2a", "#2a2a2a", "#002a3a", "#3a2000"][k], 0.35) : null;   // until its art exists
  }
  function drawBoss(ctx) {
    const t = clk.t, bx = W - 84, by = 160;
    let al = 1;
    if (boss.down || boss.flee) { al = 1 - (t - boss.downT) / 1.1; if (al <= 0) return; }
    const k = t - boss.hitT, sh = k < 0.25 ? Math.sin(k * 90) * 9 * (1 - k / 0.25) : 0;
    const fx0 = boss.flee ? (t - boss.downT) * 160 : 0;   // a withdrawing 龍兵 slides off to the right
    const art = minionArt(boss.k);
    ctx.save();
    ctx.globalAlpha = al;
    if (art) drawArtDragon(ctx, art, bx + sh + fx0, by + Math.sin(t * 1.8) * 4, 205, false);
    else drawDragon(ctx, { x: bx - 50 + sh, y: by - 40, sc: 0.55, dir: -1, t: t, len: 260, amp: 0.3, pal: "fire", glow: true, jaw: 0.3 });
    if (k < 0.14) { ctx.globalCompositeOperation = "lighter"; drawGlow(ctx, C.white, bx, by - 20, 90, 0.8 * (1 - k / 0.14)); }
    ctx.restore();
    // life bar
    const x0 = W - 164, y0 = 70, bw = 150, f = boss.hp / boss.max;   // below the ROUND header
    ctx.save();
    ctx.globalAlpha = al;
    ctx.fillStyle = "rgba(0,0,0,0.65)"; roundRect(ctx, x0 - 3, y0 - 3, bw + 6, 16, 6); ctx.fill();
    const lg = ctx.createLinearGradient(x0, 0, x0 + bw, 0);
    lg.addColorStop(0, "#ff2a1a"); lg.addColorStop(1, "#ffb21a");
    ctx.fillStyle = lg; roundRect(ctx, x0, y0, Math.max(0.001, bw * f), 10, 4); ctx.fill();
    ctx.strokeStyle = "#ffd27a"; ctx.lineWidth = 1.5; roundRect(ctx, x0 - 3, y0 - 3, bw + 6, 16, 6); ctx.stroke();
    ctx.font = "900 12px " + FONT_TC; ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
    ctx.fillText(minionName(boss.k), x0, y0 - 5);
    ctx.restore();
    drawPops(ctx, boss.pops, al);
  }
  // Damage numbers rising from hits: { v, x, y, t, size?, col? }.
  function drawPops(ctx, pops, al) {
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineWidth = 4; ctx.strokeStyle = "#3a0000";
    for (const p of pops) {
      const a = clk.t - p.t;
      if (a > 0.7 || a < 0) continue;
      ctx.font = "900 " + (p.size || 22) + "px " + FONT_DIGIT;
      ctx.globalAlpha = (al == null ? 1 : al) * (1 - a / 0.7);
      const y = p.y - a * 46;
      ctx.strokeText(String(p.v), p.x, y); ctx.fillStyle = p.col || "#ffe14a"; ctx.fillText(String(p.v), p.x, y);
    }
    ctx.restore();
  }
  function bossHit() {
    if (!boss.on || boss.down || boss.flee) return null;
    boss.hp = Math.max(0, boss.hp - 1); boss.hitT = clk.t;
    boss.pops.push({ v: 80 + Math.floor(rng() * 170), t: clk.t, x: W - 96 + rand(-34, 34), y: 120 + rand(-24, 24) });
    if (boss.pops.length > 14) boss.pops.shift();
    burst("front", W - 100 + rand(-20, 20), 150 + rand(-30, 30), 10, { cols: [C.gold, C.white, C.orange], v0: 80, v1: 220, s0: 1, s1: 2.4, len: 16 });
    shake(2);
    if (boss.hp > 0) return "boss";
    boss.down = true; boss.downT = clk.t;
    fireBurst(W - 84, 150, 50, 260, "front"); flash(C.gold, 0.8, 3); shake(10);
    telop(T("lcd.bossDown"), { x: W - 96, y: 118, size: 44, cls: "gold", anim: "slam", dur: 1.8 });
    telop(T("lcd.bossReward", { n: 100 }), { x: W - 96, y: 166, size: 24, cls: "rainbow", anim: "pop", dur: 1.8, inD: 0.3 });
    return "bossDown";
  }
  // 神龍覚醒チャレンジ, the last round: the 神龍 sleeps in the dark behind a ring gauge that PUSH
  // fills (and that creeps up by itself). The result was decided with the jackpot (the next mode),
  // and playBonusEnd reveals it: awake = RUSH, still asleep = 時短.
  const awaken = { on: false, g: 0, t0: 0, res: null, resT: 0 };
  const AW = { x: CX, y: 150, r: 74 };
  function awakenStart() {
    Object.assign(awaken, { on: true, g: 0, t0: clk.t, res: null, resT: 0 });
    telop(T("lcd.awakenTitle"), { x: CX, y: 70, size: 26, cls: "rainbow", anim: "slam", stay: true });
    telop(T("lcd.awakenHint"), { x: CX, y: 262, size: 18, cls: "gold", anim: "pop", dur: 3, inD: 0.5 });
  }
  function awakenTap() {
    awaken.g = Math.min(0.92, awaken.g + 0.05);   // the last bit is the reveal's
    const a = -Math.PI / 2 + awaken.g * TAU;
    burst("front", AW.x + Math.cos(a) * AW.r, AW.y + Math.sin(a) * AW.r, 8, { cols: [C.gold, C.white], v0: 60, v1: 180, s0: 1, s1: 2.2, len: 12 });
    shake(1.2);
    return "awaken";
  }
  function drawAwaken(ctx) {
    const t = clk.t, im = goldDragon();
    if (awaken.res == null) awaken.g = Math.min(0.92, awaken.g + 0.0025);   // creeps up a little each frame
    const lit = awaken.res === true ? Math.min(1, (t - awaken.resT) / 0.4) : awaken.res === false ? 0 : awaken.g * 0.35;
    const fade = awaken.res === false ? Math.max(0, 1 - (t - awaken.resT) / 1.2) : 1;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0," + (0.55 * (1 - lit)).toFixed(3) + ")"; ctx.fillRect(0, 0, W, H);
    if (im) {   // asleep: dark; awake: gold and glowing
      const h = H * 0.9 * (1 + 0.02 * Math.sin(t * 2));
      ctx.globalAlpha = 0.9 * fade;
      drawArtDragon(ctx, tinted(im, "#000", 0.8), AW.x, H / 2 + 6, h, false);
      if (lit > 0) { ctx.globalAlpha = lit * fade; drawArtDragon(ctx, im, AW.x, H / 2 + 6, h, false); ctx.globalCompositeOperation = "lighter"; drawGlow(ctx, C.gold, AW.x, AW.y, 240, 0.6 * lit); }
    }
    ctx.restore();
    // the gauge ring
    const g = awaken.res === true ? 1 : awaken.g;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(AW.x, AW.y, AW.r, 0, TAU); ctx.stroke();
    const gr = ctx.createLinearGradient(AW.x - AW.r, 0, AW.x + AW.r, 0); gr.addColorStop(0, "#ffb000"); gr.addColorStop(1, "#fff2a0");
    ctx.strokeStyle = gr; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(AW.x, AW.y, AW.r, -Math.PI / 2, -Math.PI / 2 + g * TAU); ctx.stroke();
    ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = "rgba(255,210,90,0.35)"; ctx.lineWidth = 18; ctx.beginPath(); ctx.arc(AW.x, AW.y, AW.r, -Math.PI / 2, -Math.PI / 2 + g * TAU); ctx.stroke();
    drawGlow(ctx, C.gold, AW.x, AW.y, 40 + 30 * g, 0.4 + 0.4 * g);
    ctx.restore();
  }
  // onReveal(ok) runs when the result shows (at once when there was no challenge to reveal).
  async function awakenReveal(ok, onReveal) {
    const tell = () => { if (onReveal) try { onReveal(ok); } catch (e) { /* ignore */ } };
    if (!awaken.on || awaken.res != null) { tell(); return; }
    clearTelops();
    // the last push: the gauge races to the top...
    tween(awaken, { g: ok ? 1 : 0.97 }, 0.6, E.in);
    await wait(0.7);
    awaken.res = ok; awaken.resT = clk.t;
    tell();
    if (ok) {
      flash(C.white, 1, 2); shake(12);
      burst("front", AW.x, AW.y, 60, { cols: [C.gold, C.white, C.orange], v0: 160, v1: 520, s0: 1.4, s1: 3.4, len: 28 });
      if (VID.awaken) {   // the 神龍 wakes on film: white in, the clip, white out onto the title
        white(1, 0.12); await wait(0.14);
        const film = playClipToEnd("awaken", 3.6);
        white(0, 0.3);
        await film;
        white(1, 0.1); await wait(0.12); white(0, 0.5);
      }
      telop(T("lcd.awakenOk"), { x: CX, y: 160, size: 58, cls: "rainbow", anim: "slam", dur: 1.6, jitter: 3 });
      await wait(1.5);
    } else {
      flash(C.white, 0.4, 3); shake(6);
      tween(fx, { gray: 0.7 }, 0.4);
      telop(T("lcd.awakenNg"), { x: CX, y: 160, size: 44, cls: "gray", anim: "drop", dur: 1.6, inD: 0.3 });
      await wait(1.6);
      tween(fx, { gray: 0 }, 0.3);
    }
  }
  let roundClipN = 0;
  function showRoundImpl(round, rounds, gained) {
    if (mode !== "bonus") mode = "bonus";
    const changed = hud._round !== round;
    // Called again on every payout: only a new round clears the screen, so the 龍兵's 撃破!! and
    // the round line stay up.
    if (changed) {
      killSeqActors(); clearTelops();
      hitPulse.on = false;
      setScene("bonus", 0.25);
      tween(fx, { logoA: 0, dim: 0, gray: 0, vign: 0 }, 0.2);
      layout("hidden", 0.25);
    }
    hudState.bonusOn = true; hudState.rushOn = false;
    hud._round = round;
    setText(hud.bRound, "ROUND " + round);
    setText(hud.bOf, "/" + rounds + "R");
    if (changed) {
      hudState.roundPopT = clk.t;
      galleryNext();
      const last = round >= rounds;
      if (!last && !boss.on) bossStart(rounds, round);
      if (last) {
        if (boss.on && !boss.down) { boss.flee = true; boss.downT = clk.t; }   // the 龍兵 withdraws
        if (!awaken.on) awakenStart();
      }
      // every other round a clip in the window, in turn (never during the challenge)
      if (!last && round % 2 === 0) {
        const have = ROUND_CLIPS.filter((k) => VID[k]);
        if (have.length) playClip(have[roundClipN++ % have.length]);
      }
      if (!last) {
        const lines = T("lcd.roundLines").split("|");
        telop(lines[(round - 1) % lines.length], { x: boss.on ? W * 0.33 : CX, y: 200, size: 26, cls: "gold", anim: "pop", dur: 1.8, inD: 0.35, font: FONT_BRUSH });
      }
    }
    gained = gained || 0;
    if (gained !== hudState.gainTo) {
      hudState.gainFrom = hudState.gainDisp > gained ? 0 : hudState.gainDisp; hudState.gainTo = gained; hudState.gainT0 = clk.t;
      if (gained < hudState.gainDisp) { hudState.gainDisp = 0; setText(hud.bGain, "0"); }
    }
  }
  async function playRoundBreakImpl(round) {
    const rx = boss.on ? W * 0.33 : CX;   // above the picture, clear of the life bar and the 獲得 count
    telop("ROUND " + round, { x: rx, y: 96, size: 34, cls: "gold", anim: "slam", dur: 1.1 });
    telop("CLEAR!", { x: rx, y: 134, size: 28, cls: "red", anim: "pop", dur: 1.1, inD: 0.3 });
    flash(C.gold, 0.45, 4); shake(3);
    burst("front", CX, 170, 30, { cols: [C.gold, C.white], v0: 100, v1: 300, s0: 1.3, s1: 3 });
    await wait(1.15);
  }
  async function playBonusEndImpl(o) {
    o = o || {};
    const next = o.next || "normal", gained = o.gained || 0;
    await awakenReveal(next === "rush", o.onReveal);
    killSeqActors(); clearTelops();
    hudState.bonusOn = false;
    hud._round = 0;   // the next bonus starts a new count
    boss.on = false; awaken.on = false;
    layout("hidden", 0.2);
    if (next === "rush") {
      setScene("rush", 0.1);
      playClip("rush");
      flash(C.white, 1, 1.6); shake(12);
      burst("front", CX, 160, 60, { cols: [C.cyan, C.gold, C.white], v0: 200, v1: 600, s0: 1.6, s1: 3.6, len: 34 });
      addActor("mid", Infinity, (ctx, age) => {
        speedLines(ctx, CX, 160, 46, C.white, 0.5, 40, Math.floor(age * 30));
        drawSpr(ctx, SPR.logo.rush, CX, 112 - 30 * (1 - E.back(clamp(age / 0.4, 0, 1))), 1.25);
      }, { seq: true });
      await wait(0.45);
      telop(T("lcd.rushIn"), { x: CX, y: 178, size: 64, cls: "gold", anim: "slam", stay: true, jitter: 2 });
      await wait(0.9);
      telop(T("lcd.rushRate"), { x: CX, y: 232, size: 22, cls: "cyan", anim: "pop", stay: true });
      telop("TOTAL " + fmt(gained), { x: CX, y: 270, size: 22, cls: "gold", anim: "rise", stay: true });
      await wait(2.0);
    } else if (next === "jitan") {
      setScene("jitan", 0.15);
      flash(C.white, 0.8, 2); shake(6);
      addActor("mid", Infinity, (ctx, age) => {   // the hero rises behind the text
        const im = IMG.pose_victory || IMG.hero, u = E.out(clamp(age / 0.5, 0, 1));
        ctx.globalAlpha = 0.85 * u;
        if (im) drawContain(ctx, im, CX - 140, 40 + 40 * (1 - u), 280, H - 40, true);
        else drawWarrior(ctx, { x: CX, y: H + 40 + 40 * (1 - u), sc: 0.95, t: age, rim: "gold", aura: 1, sword: -1.25 });
        ctx.globalAlpha = 1;
        const g = ctx.createLinearGradient(0, H - 120, 0, H);   // keeps TOTAL readable
        g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.55)");
        ctx.fillStyle = g; ctx.fillRect(0, H - 120, W, 120);
      }, { seq: true });
      telop(T("lcd.chanceTime"), { x: CX, y: 96, size: 30, cls: "fire", anim: "slam", stay: true });
      await wait(0.4);
      telop(T("lcd.jitanN"), { x: CX, y: 166, size: 54, cls: "gold", anim: "slam", stay: true });
      await wait(0.6);
      telop("TOTAL " + fmt(gained), { x: CX, y: 236, size: 22, cls: "gold", anim: "rise", stay: true });
      await wait(1.6);
    } else {
      setScene("result", 0.3);
      telop(T("lcd.bonusOver"), { x: CX, y: 108, size: 40, cls: "silver", anim: "drop", stay: true, inD: 0.4 });
      await wait(0.5);
      telop("TOTAL " + fmt(gained), { x: CX, y: 174, size: 34, cls: "gold", anim: "pop", stay: true });
      await wait(0.5);
      telop(T("lcd.toNormal"), { x: CX, y: 236, size: 22, cls: "blue", anim: "rise", stay: true });
      await wait(1.3);
    }
    clearTelops(); killSeqActors();
  }
  async function playRushEndImpl(o) {
    o = o || {};
    killSeqActors(); clearTelops();
    hudHide = true;
    layout("hidden", 0.2);
    setScene("result", 0.3);
    tween(fx, { logoA: 0 }, 0.2);
    telop(T("lcd.rushOver"), { x: CX, y: 64, size: 30, cls: "silver", anim: "drop", stay: true, inD: 0.4 });
    await wait(0.5);
    addActor("mid", Infinity, (ctx, age) => {
      const u = E.back(clamp(age / 0.35, 0, 1));
      ctx.translate(CX, 172); ctx.scale(u, u);
      ctx.fillStyle = "rgba(0,0,0,0.6)"; roundRect(ctx, -150, -70, 300, 140, 16); ctx.fill();
      ctx.strokeStyle = "#ffd24a"; ctx.lineWidth = 3; roundRect(ctx, -150, -70, 300, 140, 16); ctx.stroke();
      ctx.strokeStyle = "rgba(255,210,74,0.4)"; ctx.lineWidth = 1; roundRect(ctx, -144, -64, 288, 128, 12); ctx.stroke();
    }, { seq: true });
    await wait(0.2);
    telop(T("lcd.streakN", { n: fmt(o.streak || 0) }), { x: CX, y: 150, size: 60, cls: "gold", anim: "slam", stay: true });
    await wait(0.4);
    telop(T("lcd.gainN", { n: fmt(o.gained || 0) }), { x: CX, y: 210, size: 28, cls: "gold", anim: "pop", stay: true });
    burst("front", CX, 150, 40, { cols: [C.gold, C.white], v0: 100, v1: 320, s0: 1.4, s1: 3 });
    await wait(2.0);
    clearTelops(); killSeqActors();
    hudHide = false;
    // Back to the current mode's look: setMode() ran while this was queued, so nothing else restores it.
    setScene(modeScene(), 0.3);
    if (mode === "bonus") { tween(fx, { logoA: 0 }, 0.2); layout("hidden", 0.25); }
    else { tween(fx, { logoA: 1 }, 0.3); layout(baseLay(), 0.3); reels.forEach((r) => { r.glow = 0; r.dim = 0; r.lay.a = 1; }); }
  }

  // ------------------------------------------------------------------ queue
  let chain = Promise.resolve();
  function enqueue(fn) {
    const p = chain.then(fn).catch((e) => { console.error("[PK.LCD]", e); });
    chain = p;
    return p;
  }

  // ------------------------------------------------------------------ public API
  let mounted = false;
  const LCD = {
    mount(lcdEl, o) {
      if (mounted) return;
      mounted = true;
      o = o || {};
      injectCss();
      lcdEl.style.overflow = "hidden";
      if (!lcdEl.style.borderRadius) lcdEl.style.borderRadius = LL.r + "px";
      const cs = getComputedStyle(lcdEl);
      if (cs.position === "static") lcdEl.style.position = "absolute";
      if (!lcdEl.style.width) { lcdEl.style.width = W + "px"; lcdEl.style.height = H + "px"; }
      root = document.createElement("div"); root.className = "pkl-root";
      cv = document.createElement("canvas"); cv.className = "pkl-cv";
      ov = document.createElement("div"); ov.className = "pkl-ov";
      telLayer = document.createElement("div"); telLayer.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;";
      vidLayer = document.createElement("div");
      whiteEl = document.createElement("div"); whiteEl.className = "pkl-white";
      root.appendChild(cv); root.appendChild(vidLayer); root.appendChild(whiteEl); root.appendChild(ov);
      lcdEl.appendChild(root);
      buildHud();
      ov.appendChild(telLayer);
      ctx = cv.getContext("2d");
      resize();
      window.addEventListener("resize", resize);
      document.addEventListener("visibilitychange", () => { lastTs = 0; });
      loadImages(o.assetsBase == null ? "assets/" : o.assetsBase);
      loadVideos(o.assetsBase == null ? "assets/" : o.assetsBase);
      buildSprites();
      // rebuild glyph sprites once the web fonts arrive
      try {
        // Every LCD string, so each font fetches the unicode-range subsets it needs.
        const txt = "0123456789RUSHPUSHROUNDCLEARBONUSTOTALPREMIUMVS×!?…" +
          Object.keys(PK.TEXT || {}).filter((k) => k.startsWith("lcd.")).map((k) => PK.TEXT[k]).join("");
        Promise.all([
          document.fonts.load("80px \"Dela Gothic One\"", txt),
          document.fonts.load("80px \"Yuji Syuku\"", txt),
          document.fonts.load("80px \"Reggae One\"", txt),
          document.fonts.load("20px \"Noto Sans TC\"", txt),
        ]).then(() => { LCD._fontsReady = true; buildSprites(); }, () => { LCD._fontsReady = true; });
      } catch (e) { LCD._fontsReady = true; }
      reels.forEach((r, i) => { reelSet(r, [2, 5, 8][i]); });
      layout("normal", 0);
      raf = requestAnimationFrame(frame);
    },
    setMode(m) {
      if (!["normal", "jitan", "rush", "bonus"].includes(m)) return;
      const prev = mode;
      mode = m;
      hudState.rushOn = m === "rush" || m === "jitan";
      if (m !== "bonus") hudState.bonusOn = false;
      if (hud.stLbl) { hud.stLbl.textContent = T(m === "jitan" ? "lcd.jitanLeft" : "lcd.stLeft"); hud.skBox.style.display = m === "jitan" ? "none" : ""; }
      if (m === "rush" || m === "jitan") setText(hud.stNum, String(rushInfo.st));
      if (prev !== m) {
        setScene(modeScene(), 0.35);
        if (m === "bonus") { tween(fx, { logoA: 0 }, 0.2); layout("hidden", 0.25); }
        else { tween(fx, { logoA: 1 }, 0.3); layout(baseLay(), 0.3); reels.forEach((r) => { r.glow = 0; r.dim = 0; r.lay.a = 1; }); hitPulse.on = false; }
        setHoldView(m === "rush" || m === "jitan" ? holdSrc.rush : holdSrc.holds);
      }
    },
    setHolds(holds, rushHolds) {
      holdSrc.holds = holds || []; holdSrc.rush = rushHolds || [];
      const useRush = mode === "rush" || mode === "jitan" || (mode === "bonus" && holdSrc.rush.length);
      setHoldView(useRush ? holdSrc.rush : holdSrc.holds);
    },
    playSpin(script, opts) { return enqueue(() => playSpinImpl(script, opts)); },
    // Returns true when a prompt or 連打 took the press; in a bonus "boss" / "bossDown" when it hit
    // the 龍兵 (bossDown: knocked out, the shell pays the reward) or "awaken" when it fed the
    // 神龍覚醒 gauge; else false.
    push() {
      if (mode === "bonus" && awaken.on && awaken.res == null && !pushWaiter && !renda.on) return awakenTap();
      if (mode === "bonus" && boss.on && !boss.down && !boss.flee && !pushWaiter && !renda.on) return bossHit();
      if (pushWaiter) {
        const w = pushWaiter; pushWaiter = null;
        if (curOpts && curOpts.onPush) try { curOpts.onPush("prompt"); } catch (e) { /* ignore */ }
        w.fin("push"); return true;
      }
      if (renda.on) { rendaHit(false); return true; }
      return false;
    },
    // true while PUSH has a bonus target (the 龍兵, or the 神龍覚醒 gauge): AUTO PUSH taps it
    bossActive() { return mode === "bonus" && ((boss.on && !boss.down && !boss.flee) || (awaken.on && awaken.res == null)); },
    playJackpot(script) { return enqueue(() => playJackpotImpl(script)); },
    showRound(round, rounds, gained) { enqueue(() => showRoundImpl(round, rounds, gained)); },
    playRoundBreak(round) { return enqueue(() => playRoundBreakImpl(round)); },
    // o: { gained, next, onReveal?(ok) }; onReveal runs when the 神龍覚醒 result shows
    playBonusEnd(o) { return enqueue(() => playBonusEndImpl(o)); },
    setRush(o) {
      o = o || {};
      if (o.st != null && o.st !== rushInfo.st) { rushInfo.st = o.st; hudState.stPopT = clk.t; }
      if (o.streak != null && o.streak !== rushInfo.streak) { rushInfo.streak = o.streak; hudState.skPopT = clk.t; }
      if (o.gained != null) rushInfo.gained = o.gained;
      if (!hud.stNum) return;
      setText(hud.stNum, String(rushInfo.st));
      setText(hud.skNum, T("lcd.streakN", { n: rushInfo.streak }));
      setText(hud.rGain, "TOTAL " + fmt(rushInfo.gained));
    },
    playRushEnd(o) { return enqueue(() => playRushEndImpl(o)); },
    setAim(side) { aimSide = side === "right" ? "right" : "left"; hudState.aimOn = aimSide === "right"; },
    idle(digits) {
      const d = digits || [2, 5, 8];
      reels.forEach((r, i) => { reelSet(r, clamp(Math.round(d[i]) || 1, 1, 9)); r.glow = 0; r.dim = 0; });
      hitPulse.on = false;
      if (mode !== "bonus") { layout(baseLay(), 0.2); tween(fx, { logoA: 1 }, 0.2); }
    },
    zoom(on) {
      if (!root) return;
      const el = root.parentNode;
      el.style.transition = "transform .3s ease";
      el.style.transformOrigin = "50% 50%";
      el.style.transform = on ? "scale(1.42)" : "";
      el.style.zIndex = on ? "6" : "";
      setTimeout(resize, 350);
    },
    // ---- debug / test hooks (used by dev/lcd_demo.html)
    _debug: {
      manual(on) { manual = !!on; },
      advance: async function (sec, fps) {
        fps = fps || 60;
        const n = Math.round(sec * fps);
        const mc = new MessageChannel();
        const q = [];
        mc.port1.onmessage = () => { const f = q.shift(); if (f) f(); };
        const tick = () => new Promise((r) => { q.push(r); mc.port2.postMessage(0); });
        for (let i = 0; i < n; i++) { step(1 / fps); await tick(); }
        resize(); render();
      },
      render() { resize(); render(); },
      state() { return { t: clk.t, mode, scene: scene.id, renda: renda.on, actors: actors.length, particles: P.back.length + P.front.length, telops: telops.length, reels: reels.map((r) => ({ st: r.st, d: digitAt(r.pos) })) }; },
      imagesSettled() { return imgPending === 0; },
      seed(n) { rng = mulberry32(n | 0); },
    },
  };
  LCD._fontsReady = false;
  PK.LCD = LCD;
})();
