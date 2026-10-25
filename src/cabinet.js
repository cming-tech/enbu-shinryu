// 炎舞ドラゴン v2 — Module 2: PK.Cabinet
// The machine body (front SVG), the glass board art (back SVG), and the field canvas
// (gold pins, silver balls, pockets, and every animated light).
//
// Lighting model: the front SVG is static. Its lit parts (energy ring, panels, LEDs, the
// dragon's mane/eye, console rings) are translucent "acrylic" holes cut through the metal.
// The field canvas sits behind the front SVG and paints the light under those holes, so all
// per-frame work (theme colours, chases, wisps, flashes) is canvas-only and the SVG never
// has to re-rasterise.
(function () {
  "use strict";
  const PK = (window.PK = window.PK || {});
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  // ---------------------------------------------------------------- tunables
  const WIN_N = 3.4; // lower half of the window is a superellipse (flatter, wider bottom)
  const BR = 5; // ball radius
  const PR = 2.3; // pin radius
  const CD = BR + PR; // ball-pin contact distance
  const G = 9000; // effective gravity, design units / s^2
  const FLIGHT_MIN = 1.4;
  const FLIGHT_MAX = 2.2;
  const THEME_FADE = 0.4; // seconds

  // Fixed board features (design units).
  const WARP = { x: 91, y: 352 }; // warp entrance on the LCD bezel's left side
  const WM = { x: 68, y: 408, r: 9 }; // windmill (風車) in the left lane
  const SLOPE = { ax: 536, ay: 498, bx: 488, by: 588 }; // chrome guide to the attacker
  const STAGE = { x0: 120, x1: 468, yc: 490, rise: 12 }; // ledge under the LCD
  const BEZEL = { x: 96, y: 142, w: 408, h: 336, r: 50 };
  // Energy swirl: a wide band of flowing light between frame offsets s0..s1 (the reference's
  // signature look), above the console. Its textures render at res x the field resolution.
  // The light also reaches `inner` units in over the board glass (fading out, clear of the lower field).
  const SWIRL = { s0: 17, s1: 84, inner: -52, fadeY0: 500, fadeY1: 560, res: 0.75 };
  const CONSOLE_TOP = "M0,640 C80,664 160,684 232,690 L356,690 C428,684 508,664 588,640";

  let L = null;

  // ---------------------------------------------------------------- utils
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const f1 = (v) => (Math.round(v * 10) / 10).toString();

  let rs = 0x2f6b1a3d;
  function rnd() {
    rs = (rs + 0x6d2b79f5) | 0;
    let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rr = (a, b) => a + (b - a) * rnd();

  function hsv(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  function parseColor(c) {
    if (Array.isArray(c)) return c.slice(0, 3);
    if (typeof c !== "string") return [255, 255, 255];
    const named = { white: [255, 255, 255], red: [255, 40, 30], gold: [255, 200, 60], blue: [60, 140, 255],
      green: [60, 255, 120], purple: [170, 80, 255], rainbow: [255, 255, 255], orange: [255, 130, 20] };
    if (named[c]) return named[c].slice();
    let m = c.match(/^#([0-9a-f]{3})$/i);
    if (m) return m[1].split("").map((h) => parseInt(h + h, 16));
    m = c.match(/^#([0-9a-f]{6})$/i);
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].substr(i, 2), 16));
    m = c.match(/rgba?\(([^)]+)\)/i);
    if (m) return m[1].split(",").slice(0, 3).map((v) => parseFloat(v) || 0);
    return [255, 255, 255];
  }

  // ---------------------------------------------------------------- geometry
  // Frame point at angle deg (SVG convention), offset s outward from the window edge.
  function fpt(deg, s) {
    const a = deg * DEG, c = Math.cos(a), si = Math.sin(a);
    const rx = L.win.rx + s, ry = L.win.ry + s;
    if (si <= 0) return [L.win.cx + rx * c, L.win.cy + ry * si];
    const e = 2 / WIN_N;
    return [L.win.cx + rx * Math.sign(c) * Math.pow(Math.abs(c), e), L.win.cy + ry * Math.pow(si, e)];
  }
  // Window half-width at height y (offset s).
  function halfW(y, s) {
    s = s || 0;
    const rx = L.win.rx + s, ry = L.win.ry + s;
    const t = Math.abs((y - L.win.cy) / ry);
    if (t >= 1) return 0;
    return y <= L.win.cy ? rx * Math.sqrt(1 - t * t) : rx * Math.pow(1 - Math.pow(t, WIN_N), 1 / WIN_N);
  }
  const wallX = (y, side, s) => L.win.cx + (side === "L" ? -1 : 1) * halfW(y, s);
  const inWin = (x, y, s) => Math.abs(x - L.win.cx) <= halfW(y, s);
  // u parameter (0 = top centre, clockwise) of a point, by angle around the window centre.
  const angU = (x, y) => (((Math.atan2(y - L.win.cy, x - L.win.cx) / DEG + 90) % 360) + 360) % 360 / 360;

  const loopCache = {};
  // Frame loop at offset s, resampled to equal arc length; points [x, y, u].
  function loopPts(s, step) {
    step = step || 3;
    const key = s + ":" + step;
    if (loopCache[key]) return loopCache[key];
    const N = 3600, dense = [], cum = [0];
    for (let i = 0; i < N; i++) dense.push(fpt(-90 + (360 * i) / N, s));
    let total = 0;
    for (let i = 1; i <= N; i++) {
      const p = dense[i % N], q = dense[i - 1];
      total += Math.hypot(p[0] - q[0], p[1] - q[1]);
      cum.push(total);
    }
    const n = Math.max(12, Math.round(total / step)), out = [];
    let j = 0;
    for (let k = 0; k < n; k++) {
      const target = (total * k) / n;
      while (cum[j + 1] < target) j++;
      const p = dense[j], q = dense[(j + 1) % N];
      const f = (target - cum[j]) / (cum[j + 1] - cum[j] || 1);
      const x = p[0] + (q[0] - p[0]) * f, y = p[1] + (q[1] - p[1]) * f;
      out.push([x, y, angU(x, y)]);
    }
    return (loopCache[key] = out);
  }
  // Partial frame arc from deg a0 to a1 at offset s (points [x,y,u]).
  function arcPts(a0, a1, s, step) {
    const out = [];
    const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * 4.8) / (step || 4)));
    for (let i = 0; i <= n; i++) {
      const p = fpt(lerp(a0, a1, i / n), s);
      out.push([p[0], p[1], angU(p[0], p[1])]);
    }
    return out;
  }
  function ptsPath(pts, close) {
    let d = "";
    for (let i = 0; i < pts.length; i++) d += (i ? "L" : "M") + f1(pts[i][0]) + "," + f1(pts[i][1]);
    return close ? d + "Z" : d;
  }
  const loopPath = (s, step) => ptsPath(loopPts(s, step), true);
  function railPt(deg, dr) {
    const a = deg * DEG;
    dr = dr || 0;
    return [L.win.cx + (L.rail.rx + dr) * Math.cos(a), L.win.cy + (L.rail.ry + dr) * Math.sin(a)];
  }
  function railPath(a0, a1, dr) {
    const pts = [];
    const n = Math.ceil(Math.abs(a1 - a0) / 1.5);
    for (let i = 0; i <= n; i++) pts.push(railPt(lerp(a0, a1, i / n), dr));
    return ptsPath(pts, false);
  }
  const railLeftX = (y) => {
    const t = (y - L.win.cy) / L.rail.ry;
    return L.win.cx - L.rail.rx * Math.sqrt(Math.max(0, 1 - t * t));
  };
  function inRRect(x, y, rx, ry, w, h, r) {
    if (x < rx || x > rx + w || y < ry || y > ry + h) return false;
    const cx = clamp(x, rx + r, rx + w - r), cy = clamp(y, ry + r, ry + h - r);
    return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
  }
  const stageY = (x) => STAGE.yc - STAGE.rise * Math.pow((x - 294) / ((STAGE.x1 - STAGE.x0) / 2), 2);

  // Catmull-Rom through control points -> dense polyline.
  function spline(cp, per) {
    per = per || 12;
    const out = [];
    for (let i = 0; i < cp.length - 1; i++) {
      const p0 = cp[Math.max(0, i - 1)], p1 = cp[i], p2 = cp[i + 1], p3 = cp[Math.min(cp.length - 1, i + 2)];
      for (let j = 0; j < per; j++) {
        const t = j / per, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    out.push(cp[cp.length - 1].slice());
    return out;
  }
  // Offset strip of a tube: between normal fractions a..b of the half width (-1..1).
  function tube(pts, wf) {
    const n = pts.length, P = [], N = [], W = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l; ty /= l;
      P.push(pts[i]); N.push([-ty, tx]); W.push(wf(i / (n - 1)) / 2);
    }
    return {
      P, N, W, n,
      at(i, f) { return [P[i][0] + N[i][0] * W[i] * f, P[i][1] + N[i][1] * W[i] * f]; },
      strip(a, b, i0, i1) {
        i0 = i0 || 0; i1 = i1 == null ? n - 1 : i1;
        const A = [], B = [];
        for (let i = i0; i <= i1; i++) { A.push(this.at(i, a)); B.push(this.at(i, b)); }
        return ptsPath(A.concat(B.reverse()), true);
      },
    };
  }

  // ---------------------------------------------------------------- pins
  const PINS = { all: [], L: [], R: [], road: [], yori: [], inochi: [], hakama: [] };
  function buildPins() {
    const all = [];
    const add = (x, y, g) => { const p = { x, y, g }; all.push(p); return p; };
    PINS.L = []; PINS.R = []; PINS.road = [];
    // Left lane: staggered rows between the rail and the LCD bezel. Rows 18 apart and pins 20 apart
    // (the user found a 14 x 16 grid too dense); still close enough for a pin below on each side.
    for (let r = 0, y = 244; y <= 466; r++, y += 18) {
      const off = (r % 2) * 10;
      for (let x = 90 - off; x >= railLeftX(y) + 11.5; x -= 20) {
        if (Math.hypot(x - WM.x, y - WM.y) < WM.r + 9) continue;
        if (Math.hypot(x - WARP.x, y - WARP.y) < 11) continue;
        PINS.L.push(add(x, y, "L"));
      }
    }
    // Upper strip under the rail (天釘 row) where it clears the bezel.
    for (let a = 214; a <= 326; a += 3.3) {
      const p = railPt(a, -15);
      if (inRRect(p[0], p[1], BEZEL.x - 7, BEZEL.y - 7, BEZEL.w + 14, BEZEL.h + 14, BEZEL.r + 7)) continue;
      if (p[0] < 100 || p[0] > 500) continue;
      add(p[0], p[1], "T");
    }
    // Right lane: staggered rows between the bezel and the window edge.
    for (let r = 0, y = 266; y <= 436; r++, y += 14) {
      const off = (r % 2) * 8;
      for (let x = 512 + off; x <= wallX(y, "R") - 10; x += 16) {
        if (Math.abs(x - 528) < 6 && y > 425) continue; // keep the 電チュー entry clear
        PINS.R.push(add(x, y, "R"));
      }
    }
    PINS.R.push(add(514, 450, "R"), add(543, 450, "R")); // 電チュー gate
    // Road (道釘): left lane bottom down to the heso. 9 pins 21 apart (17 at 10.5 read as a
    // dotted line to the user).
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      PINS.road.push(add(84 + 168 * t, 486 + 32 * t + 3 * Math.sin(Math.PI * t), "road"));
    }
    PINS.yori = [add(262, 522, "yori"), add(271, 527, "yori")];
    PINS.inochi = [add(283, 532, "inochi"), add(305, 532, "inochi")];
    add(317, 527, "B"); add(326, 523, "B"); add(335, 520, "B");
    add(270, 506, "B"); add(318, 506, "B");
    PINS.hakama = [add(270, 562, "B"), add(318, 562, "B"), add(281, 590, "B"), add(307, 590, "B")];
    // A few pins under the road toward the left out.
    add(98, 506, "B"); add(112, 520, "B"); add(102, 538, "B");
    // Lower board: staggered pins on all the open board around the 炎/舞 blocks and along the
    // right route, as on a real board. Decoration only (no ball path uses them), so they stay
    // clear of every route in pathLeft/pathRight, of the pockets, and of the blocks.
    const segD = (x, y, a, b) => {
      const vx = b[0] - a[0], vy = b[1] - a[1], u = clamp(((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy), 0, 1);
      return Math.hypot(x - a[0] - u * vx, y - a[1] - u * vy);
    };
    const routes = [ // [polyline, clearance]
      [[[503, 446], [504, 476], [503, 576], [494, 592]], 11],  // past the 電チュー, down onto the slope
      [[[SLOPE.ax, SLOPE.ay], [SLOPE.bx, SLOPE.by]], 13],      // slope to the attacker
      [[[549, 462], [548, 520], [543, 566], [526, 620]], 11],  // right edge to the right out
      [[[474, 597], [384, 597], [364, 630], [302, 638]], 11],  // over the closed door to the centre out
    ];
    const holes = [[528, 468, 20], [L.outs[2].x, L.outs[2].y, 16], [L.outs[1].x, L.outs[1].y, 16], [L.outs[0].x, L.outs[0].y, 18]];
    const boxes = [ // x0, y0, x1, y1
      [L.attacker.x - L.attacker.w / 2 - 10, L.attacker.y - 24, L.attacker.x + L.attacker.w / 2 + 6, L.attacker.y + 20],
      [0, 460, 264, 530],     // left lane exit and the road (道釘)
      [130, 480, 264, 646],   // 炎 block and the drops behind it
      [252, 494, 338, 646],   // heso field, 袴 and the miss paths
      [L.gimmick[1].x - 8, L.gimmick[1].y - 8, L.gimmick[1].x + L.gimmick[1].w + 8, L.gimmick[1].y + L.gimmick[1].h + 8],
    ];
    for (let r = 0, y = 472; y <= 640; r++, y += 18) {   // same 18 x 20 spacing as the left lane
      for (let x = 20 + (r % 2) * 10; x <= 568; x += 20) {
        if (!inWin(x, y, -12) || x < railLeftX(y) + 14) continue;
        if (x > STAGE.x0 - 10 && x < STAGE.x1 + 10 && y < stageY(x) + 14) continue;
        if (boxes.some((b) => x > b[0] && x < b[2] && y > b[1] && y < b[3])) continue;
        if (holes.some((h) => Math.hypot(x - h[0], y - h[1]) < h[2])) continue;
        if (routes.some(([pl, c]) => pl.some((a, i) => i && segD(x, y, pl[i - 1], a) < c))) continue;
        if (all.some((p) => Math.hypot(x - p.x, y - p.y) < 12)) continue;
        add(x, y, "D");
      }
    }
    PINS.all = all;
  }

  // ---------------------------------------------------------------- light registry (shared by SVG + canvas)
  // fills: backlit acrylic areas painted solid under the front SVG ({d, tr?, u, g, pulse}).
  const ART = { strokes: [], sprites: [], leds: [], fills: [] };
  function addFill(d, g, opts) {
    const f = Object.assign({ d, g }, opts || {});
    ART.fills.push(f);
    return f;
  }

  // ---------------------------------------------------------------- dragon geometry
  // Head is authored facing left in local coords, placed with HEAD_T.
  const HEAD_T = { x: 424, y: 24, s: 0.7 };
  const HEAD = {
    skull: "M2,80 C0,70 2,60 8,54 C12,48 20,46 28,48 L36,52 C44,46 52,42 62,42 L86,38 C96,30 106,24 118,22 L142,18 C162,18 178,26 190,40 L198,56 C198,70 190,80 178,86 L150,92 L120,88 L70,87 C44,87 22,88 10,88 C4,86 2,84 2,80 Z",
    nose: "M4,78 C1,66 7,52 21,50 C30,49 35,56 33,64 C31,73 20,79 4,78 Z",
    under: "M12,84 C22,86 44,86 70,86 L120,88 L150,92 L176,86 C170,74 150,70 128,72 C100,74 70,76 40,74 C26,74 16,78 12,84 Z",
    jaw: "M20,122 C44,112 84,104 124,98 L152,96 C158,104 156,114 148,120 C116,128 76,136 40,140 C28,140 18,134 20,122 Z",
    mouth: "M10,88 C50,88 100,90 150,92 L152,96 C110,100 60,110 20,122 C12,110 9,98 10,88 Z",
    tongue: "M26,117 C50,106 84,100 114,98 C100,108 70,116 42,122 C34,122 28,120 26,117 Z",
    eye: "M92,52 L104,44 C112,42 122,44 128,48 L120,56 C110,58 100,57 92,52 Z",
    brow: "M84,44 L100,32 L124,30 L150,14 L146,30 L172,22 L160,38 L132,42 C118,40 104,42 92,48 Z",
    ridge: "M40,52 L44,40 L52,46 L58,34 L64,42 L74,32 L78,40 L84,38 Z",
    cheek: "M100,64 C118,60 140,64 160,76 L150,92 C136,80 118,74 102,72 Z",
    horn1: "M136,22 C160,0 190,-14 236,-22 C206,-6 182,8 158,32 Z",
    horn2: "M156,30 C182,16 210,10 246,12 C214,20 192,30 172,44 Z",
    frill: "M150,92 L186,110 L172,96 L206,104 L186,88 L212,82 L186,76 Z",
    beard: "M44,138 C48,152 40,166 28,176 C54,170 66,154 66,138 Z M78,134 C86,148 82,164 72,176 C96,164 104,148 100,132 Z M110,128 C120,140 120,154 114,166 C132,154 136,140 130,126 Z",
    mane: [
      "M166,22 C186,-2 214,-10 248,-6 C226,6 208,18 192,36 Z",
      "M186,36 C214,18 244,18 268,30 C242,34 220,46 202,58 Z",
      "M196,58 C226,50 254,58 272,78 C246,74 222,76 204,84 Z",
      "M190,80 C218,86 240,102 248,126 C226,112 204,106 184,100 Z",
      "M172,96 C192,112 204,134 202,160 C186,138 170,124 152,114 Z",
      "M150,108 C162,128 162,150 152,172 C144,150 132,138 118,130 Z",
    ],
    maneHot: [[226, 4], [244, 30], [248, 70], [228, 108], [196, 138], [150, 150]],
    teethUp: [[20, 10], [32, 17], [46, 8], [60, 8], [74, 7], [88, 6], [102, 6], [116, 5]],
    teethLo: [[26, 13], [40, 7], [54, 7], [68, 6], [82, 6], [96, 5], [110, 5]],
  };
  const headPt = (x, y) => [HEAD_T.x + x * HEAD_T.s, HEAD_T.y + y * HEAD_T.s];
  // Optional AI art <assetsBase>cab_dragon.png replaces the vector dragon: fitted into this box
  // against its right and top edges, head top-left facing the playfield. Only the part outside the
  // window shows, so it sits on the frame's top-right corner and right side.
  const DRAGON_ART = { file: "cab_dragon.png", x: 380, y: -8, w: 216, h: 380 };
  // Optional AI art for the top medallion (replaces the drawn ring and flame; the wings stay) and
  // for the board painting behind the pins.
  const CREST_ART = { file: "cab_crest.png", x: 222, y: -10, w: 144, h: 120 };
  const BOARD_ART = { file: "board.jpg" };

  // Dragon body pieces: neck, coils over the right ring, tail. Built at mount.
  function dragonBody() {
    const neck = spline([[556, 84], [574, 126], [582, 170], [574, 214], [558, 252]], 10);
    const coils = [];
    const ys = [262, 324, 386, 448];
    ys.forEach((y0, k) => {
      const w = 27 - k * 1.6;
      coils.push({ pts: spline([[540, y0 - 8], [562, y0 + 6], [584, y0 + 22], [604, y0 + 40]], 8), w0: w, w1: w - 2 });
    });
    const tail = spline([[548, 500], [570, 528], [574, 566], [556, 600], [548, 630], [566, 652]], 10);
    return { neck, coils, tail };
  }

  // ---------------------------------------------------------------- SVG: back (board)
  function buildBack(svg) {
    const win6 = loopPath(6, 3);
    let s = "";
    s += `<defs>
<radialGradient id="pkc-board" gradientUnits="userSpaceOnUse" cx="294" cy="360" r="380">
 <stop offset="0" stop-color="#173072"/><stop offset=".38" stop-color="#0d1c4c"/><stop offset=".72" stop-color="#081230"/><stop offset="1" stop-color="#03060f"/></radialGradient>
<linearGradient id="pkc-plate" x1="0" y1="0" x2="1" y2="0">
 <stop offset="0" stop-color="#2a1404" stop-opacity=".85"/><stop offset=".45" stop-color="#6a3c0e" stop-opacity=".7"/><stop offset=".7" stop-color="#3a2006" stop-opacity=".75"/><stop offset="1" stop-color="#1a0c02" stop-opacity=".9"/></linearGradient>
<linearGradient id="pkc-guard" gradientUnits="userSpaceOnUse" x1="20" y1="460" x2="220" y2="680">
 <stop offset="0" stop-color="#3a2408"/><stop offset=".4" stop-color="#22140a"/><stop offset="1" stop-color="#120a06"/></linearGradient>
<pattern id="pkc-scale2" width="12" height="8" patternUnits="userSpaceOnUse">
 <path d="M0,8 A6,6 0 0 1 12,8 M-6,4 A6,6 0 0 1 6,4 M6,4 A6,6 0 0 1 18,4" fill="none" stroke="#ffcc70" stroke-opacity=".16" stroke-width=".8"/></pattern>
<radialGradient id="pkc-floor" gradientUnits="userSpaceOnUse" cx="294" cy="600" r="260">
 <stop offset="0" stop-color="#1e4aa8" stop-opacity=".5"/><stop offset=".5" stop-color="#0c1c4a" stop-opacity=".35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<pattern id="pkc-scale" width="16" height="10" patternUnits="userSpaceOnUse">
 <path d="M0,10 A8,8 0 0 1 16,10 M-8,5 A8,8 0 0 1 8,5 M8,5 A8,8 0 0 1 24,5" fill="none" stroke="#8ab8ff" stroke-opacity=".07" stroke-width=".8"/></pattern>
<linearGradient id="pkc-bChrome" gradientUnits="userSpaceOnUse" x1="0" y1="100" x2="588" y2="700">
 <stop offset="0" stop-color="#f6f9fc"/><stop offset=".14" stop-color="#7d8794"/><stop offset=".26" stop-color="#eef2f7"/><stop offset=".4" stop-color="#4c5460"/>
 <stop offset=".55" stop-color="#e2e8f0"/><stop offset=".7" stop-color="#5e6672"/><stop offset=".85" stop-color="#f3f6fa"/><stop offset="1" stop-color="#6a727e"/></linearGradient>
<linearGradient id="pkc-bGold" gradientUnits="userSpaceOnUse" x1="96" y1="142" x2="504" y2="478">
 <stop offset="0" stop-color="#fff0b8"/><stop offset=".2" stop-color="#c8902a"/><stop offset=".38" stop-color="#ffe08a"/><stop offset=".55" stop-color="#8a5a14"/>
 <stop offset=".72" stop-color="#f5cc66"/><stop offset=".9" stop-color="#7a4c10"/><stop offset="1" stop-color="#e8b850"/></linearGradient>
<linearGradient id="pkc-ledge" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0" stop-color="#ffd27a" stop-opacity=".95"/><stop offset=".35" stop-color="#e07a18" stop-opacity=".75"/><stop offset="1" stop-color="#4a1204" stop-opacity=".85"/></linearGradient>
<linearGradient id="pkc-tube" x1="0" y1="0" x2="1" y2="0">
 <stop offset="0" stop-color="#9fd0ff" stop-opacity=".1"/><stop offset=".3" stop-color="#d8ecff" stop-opacity=".38"/><stop offset=".55" stop-color="#9fd0ff" stop-opacity=".12"/><stop offset="1" stop-color="#9fd0ff" stop-opacity=".28"/></linearGradient>
<radialGradient id="pkc-hole"><stop offset="0" stop-color="#000"/><stop offset=".7" stop-color="#050505"/><stop offset="1" stop-color="#2a2a2a"/></radialGradient>
<clipPath id="pkc-bWin"><path d="${win6}"/></clipPath>
</defs>`;
    s += `<rect width="588" height="860" fill="#030407"/>`;
    s += `<g clip-path="url(#pkc-bWin)">`;
    s += `<rect width="588" height="860" fill="url(#pkc-board)"/>`;
    if (S.boardImg) {   // the AI board painting, darkened so the gold pins stay clear
      s += `<image href="${S.boardImg.src}" x="0" y="96" width="588" height="580" preserveAspectRatio="xMidYMid slice" opacity=".85"/>`;
      s += `<rect width="588" height="860" fill="#020614" opacity=".35"/>`;
    } else s += `<rect width="588" height="860" fill="url(#pkc-scale)"/>`;
    s += `<rect y="430" width="588" height="260" fill="url(#pkc-floor)"/>`;
    // Sunburst from the heso.
    let rays = "";
    for (let i = 0; i < 18; i++) {
      const a = (-180 + i * 10 + 5) * DEG, a2 = a + 3.2 * DEG;
      rays += `M294,548L${f1(294 + 400 * Math.cos(a))},${f1(548 + 400 * Math.sin(a))}L${f1(294 + 400 * Math.cos(a2))},${f1(548 + 400 * Math.sin(a2))}Z`;
    }
    s += `<path d="${rays}" fill="#ffb040" opacity=".045"/>`;
    // Faint flame decals rising from the floor.
    s += `<g fill="#ff4a10" opacity=".09">
<path d="M70,650 C60,600 90,570 84,520 C110,560 120,590 112,650 Z"/><path d="M140,650 C130,590 170,560 160,500 C196,560 200,610 186,650 Z"/>
<path d="M400,650 C392,600 430,560 424,505 C460,560 466,610 450,650 Z"/><path d="M480,650 C474,610 500,585 496,540 C522,580 526,620 516,650 Z"/></g>`;
    // Lane plates: engraved bronze panels behind the left and right pin lanes.
    {
      const lp = [];
      for (let a = 212; a >= 147; a -= 2.5) lp.push(railPt(a, -10.5));
      const lpath = ptsPath(lp.concat([[93, 512], [93, 246]]), true);
      const rp = [];
      for (let y = 256; y <= 452; y += 6) rp.push([wallX(y, "R", -3.5), y]);
      const rpath = ptsPath(rp.concat([[507, 452], [507, 256]]), true);
      [lpath, rpath].forEach((d) => {
        s += `<path d="${d}" fill="url(#pkc-plate)"/>`;
        s += `<path d="${d}" fill="url(#pkc-scale2)"/>`;
        s += `<path d="${d}" fill="none" stroke="url(#pkc-bGold)" stroke-width="1.6" stroke-opacity=".75"/>`;
      });
      // Gold bands with jewels across the plates.
      [300, 410, 452].forEach((y) => {
        const x0 = railLeftX(y) + 10.5;
        s += `<path d="M${f1(x0)},${y} L93,${y}" stroke="url(#pkc-bGold)" stroke-width="2.2" stroke-opacity=".8"/>`;
        s += `<circle cx="${f1((x0 + 93) / 2)}" cy="${y}" r="2.6" fill="#ff3a1a" stroke="#ffd070" stroke-width=".8"/>`;
      });
      [318, 400].forEach((y) => {
        const x1 = wallX(y, "R", -3.5);
        s += `<path d="M507,${y} L${f1(x1)},${y}" stroke="url(#pkc-bGold)" stroke-width="2.2" stroke-opacity=".8"/>`;
        s += `<circle cx="${f1((507 + x1) / 2)}" cy="${y}" r="2.6" fill="#2a8cff" stroke="#bfe0ff" stroke-width=".8"/>`;
      });
      const vt = `font-family="'Yuji Syuku','Dela Gothic One','Noto Sans TC',serif" font-size="20" fill="#ffcf6a" fill-opacity=".22" text-anchor="middle"`;
      s += `<text ${vt} x="75" y="338">炎</text><text ${vt} x="80" y="392">舞</text><text ${vt} x="530" y="372">龍</text>`;
    }
    // LCD bezel: gold frame with flourishes.
    const B = BEZEL;
    s += `<rect x="${B.x - 5}" y="${B.y - 5}" width="${B.w + 10}" height="${B.h + 10}" rx="${B.r + 5}" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="5"/>`;
    s += `<rect x="${B.x}" y="${B.y}" width="${B.w}" height="${B.h}" rx="${B.r}" fill="#07070c" stroke="url(#pkc-bGold)" stroke-width="7"/>`;
    s += `<rect x="${B.x + 4.5}" y="${B.y + 4.5}" width="${B.w - 9}" height="${B.h - 9}" rx="${B.r - 4}" fill="none" stroke="#2a1a06" stroke-width="1.5"/>`;
    s += `<rect x="${B.x - 3.2}" y="${B.y - 3.2}" width="${B.w + 6.4}" height="${B.h + 6.4}" rx="${B.r + 3}" fill="none" stroke="#fff4c8" stroke-opacity=".35" stroke-width=".8"/>`;
    // Corner flourishes (gold scrolls).
    const scroll = (x, y, sx, sy) => `<path transform="translate(${x},${y}) scale(${sx},${sy})" d="M0,0 C14,-4 22,-16 18,-28 C15,-36 6,-36 4,-30 C2,-24 8,-20 12,-24 M0,0 C-4,14 -16,22 -28,18 C-36,15 -36,6 -30,4 C-24,2 -20,8 -24,12" fill="none" stroke="url(#pkc-bGold)" stroke-width="2.6" stroke-linecap="round"/>`;
    s += scroll(106, 468, 1, 1) + scroll(482, 468, -1, 1);
    // Warp tube + entrance.
    s += `<path d="M93,358 C99,400 98,440 108,462 C114,474 122,478 132,480" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="12"/>`;
    s += `<path d="M93,358 C99,400 98,440 108,462 C114,474 122,478 132,480" fill="none" stroke="url(#pkc-tube)" stroke-width="10" stroke-linecap="round"/>`;
    s += `<path d="M91,360 C97,402 96,440 106,462" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.2"/>`;
    s += `<ellipse cx="${WARP.x}" cy="${WARP.y}" rx="8.5" ry="5" fill="url(#pkc-hole)" stroke="url(#pkc-bChrome)" stroke-width="2.2"/>`;
    s += `<path d="M${WARP.x - 12},${WARP.y - 4} L${WARP.x - 8},${WARP.y - 1} M${WARP.x + 12},${WARP.y - 4} L${WARP.x + 8},${WARP.y - 1}" stroke="#ffd45a" stroke-width="1.6" stroke-linecap="round"/>`;
    // Stage ledge under the LCD.
    let top = [], bot = [];
    for (let x = STAGE.x0; x <= STAGE.x1; x += 6) { top.push([x, stageY(x)]); bot.push([x, stageY(x) + 9 + 4 * (1 - Math.abs(x - 294) / 174)]); }
    s += `<path d="${ptsPath(top.concat(bot.reverse()), true)}" fill="url(#pkc-ledge)" stroke="#2a0a02" stroke-width="1"/>`;
    s += `<path d="${ptsPath(top, false)}" fill="none" stroke="#fff3c0" stroke-width="1.6" stroke-opacity=".9"/>`;
    s += `<path d="M286,${f1(stageY(286) + 1)} L294,${f1(stageY(294) + 6)} L302,${f1(stageY(302) + 1)}" fill="#2a0800" stroke="#ffd060" stroke-width="1"/>`;
    // Heso emblem (winged plate behind the start pocket).
    s += `<g opacity=".9"><path d="M294,546 C276,540 262,534 246,536 C256,546 270,556 294,562 C318,556 332,546 342,536 C326,534 312,540 294,546 Z" fill="#3a1408" stroke="url(#pkc-bGold)" stroke-width="1.6"/>
<path d="M252,538 C262,532 274,530 284,534 M336,538 C326,532 314,530 304,534" stroke="#ffcf6a" stroke-opacity=".6" fill="none"/></g>`;
    s += `<ellipse cx="294" cy="541" rx="14" ry="3.8" fill="#000"/>`;
    // 電チュー mouth.
    s += `<ellipse cx="528" cy="463" rx="10" ry="3.2" fill="#000"/>`;
    // Attacker recess.
    s += `<rect x="378" y="601" width="108" height="22" rx="3" fill="#050506" stroke="#000" stroke-width="2"/>`;
    s += `<rect x="382" y="606" width="100" height="2" fill="#ffcc55" opacity=".5"/>`;
    // Slope to the attacker.
    s += `<path d="M${SLOPE.ax + 1.5},${SLOPE.ay + 2} L${SLOPE.bx + 1.5},${SLOPE.by + 2}" stroke="#000" stroke-opacity=".7" stroke-width="5" stroke-linecap="round"/>`;
    s += `<path d="M${SLOPE.ax},${SLOPE.ay} L${SLOPE.bx},${SLOPE.by}" stroke="url(#pkc-bChrome)" stroke-width="4" stroke-linecap="round"/>`;
    // Right lane "right shot" chevrons.
    let chev = "";
    for (let y = 290; y <= 420; y += 24) chev += `M520,${y} L528,${y + 6} L536,${y}`;
    s += `<path d="${chev}" fill="none" stroke="#ffb22a" stroke-opacity=".22" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
    // Out holes.
    s += `<circle cx="294" cy="641" r="9" fill="url(#pkc-hole)" stroke="url(#pkc-bChrome)" stroke-width="2.4"/>`;
    s += `<circle cx="118" cy="613" r="8" fill="url(#pkc-hole)" stroke="url(#pkc-bChrome)" stroke-width="2.2"/>`;
    s += `<circle cx="520" cy="628" r="8" fill="url(#pkc-hole)" stroke="url(#pkc-bChrome)" stroke-width="2.2"/>`;
    // Rail guard: fills the lower-left bulge between the outer rail and the window edge.
    {
      const gp = [];
      for (let a = 178; a >= 96; a -= 2) gp.push(railPt(a, 9.6));
      const gd = ptsPath(gp.concat([[230, 700], [0, 700], [0, 420]]), true);
      s += `<path d="${gd}" fill="url(#pkc-guard)"/>`;
      s += `<path d="${gd}" fill="url(#pkc-scale2)" opacity=".7"/>`;
      s += `<path d="${ptsPath(gp, false)}" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="3"/>`;
      let fl = "";
      [[64, 560, 1], [92, 600, 0.8], [150, 640, 0.9]].forEach((p) => {
        const [x, y, k] = p;
        fl += `M${x - 10 * k},${y + 14 * k} C${x - 14 * k},${y} ${x - 2 * k},${y - 8 * k} ${x},${y - 22 * k} C${x + 4 * k},${y - 8 * k} ${x + 14 * k},${y} ${x + 10 * k},${y + 14 * k} Z`;
      });
      s += `<path d="${fl}" fill="#ff7a20" opacity=".22" stroke="#ffcf6a" stroke-opacity=".35" stroke-width="1"/>`;
      const o = L.outs[1];
      s += `<circle cx="${o.x}" cy="${o.y + 1}" r="10.5" fill="#000" opacity=".5"/>`;
      s += `<circle cx="${o.x}" cy="${o.y + 1}" r="8" fill="url(#pkc-hole)" stroke="url(#pkc-bChrome)" stroke-width="2.2"/>`;
    }
    // Rails: outer (with the foul slot) and inner.
    const rail = (d, w) =>
      `<path d="${d}" fill="none" stroke="#000" stroke-opacity=".75" stroke-width="${w + 2.2}" transform="translate(1,1.6)"/>` +
      `<path d="${d}" fill="none" stroke="url(#pkc-bChrome)" stroke-width="${w}"/>` +
      `<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".8"/>`;
    s += rail(railPath(119, 133, 7.6), 3.6) + rail(railPath(139, 368, 7.6), 3.6);
    s += rail(railPath(142, 208, -7.6), 3.2);
    const cap = (p, c) => `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="2.8" fill="${c}" stroke="#300" stroke-width=".8"/>`;
    s += cap(railPt(208, -7.6), "#e0302a") + cap(railPt(368, 7.6), "#e0302a") + cap(railPt(142, -7.6), "#e0302a");
    // Launch gate at the rail start.
    const g0 = railPt(121, 0);
    s += `<g transform="translate(${f1(g0[0])},${f1(g0[1])}) rotate(31)"><rect x="-9" y="-7" width="18" height="14" rx="3" fill="#20242b" stroke="url(#pkc-bChrome)" stroke-width="1.6"/><rect x="-6" y="-2" width="12" height="4" rx="2" fill="#ffcf4a" opacity=".7"/></g>`;
    s += `</g>`;
    svg.innerHTML = s;
  }

  // ---------------------------------------------------------------- SVG: front (cabinet body)
  function buildFront(svg) {
    const holes = []; // black shapes in the body mask (acrylic / window)
    const acr = []; // translucent acrylic drawings
    let deco = ""; // everything on top
    ART.strokes = []; ART.sprites = []; ART.leds = []; ART.fills = [];

    const win0 = loopPath(0, 3);
    holes.push(`<path d="${win0}"/>`);

    // --- energy ring channel s 5..17
    const band = loopPath(17, 3) + loopPath(5, 3);
    holes.push(`<path d="${band}" fill-rule="evenodd"/>`);
    acr.push(`<path d="${band}" fill-rule="evenodd" fill="url(#pkc-acryl)"/>`);
    acr.push(`<path d="${loopPath(14.5, 3)}" fill="none" stroke="#fff" stroke-opacity=".10" stroke-width="2"/>`);
    ART.strokes.push({ pts: loopPts(11, 11), closed: true, w: [16, 9, 2.6], gain: 1, main: true });
    // --- energy swirl band s0..s1 (lit by drawSwirl), clipped above the console
    const swirlD = loopPath(SWIRL.s1, 3) + loopPath(SWIRL.s0, 3);
    holes.push(`<path d="${swirlD}" fill-rule="evenodd" clip-path="url(#pkc-aboveConsole)"/>`);
    acr.push(`<path d="${swirlD}" fill-rule="evenodd" fill="#06142c" fill-opacity=".22" clip-path="url(#pkc-aboveConsole)"/>`);

    // --- outer secondary channel (upper half, broken by the crest)
    const outerArc = (a0, a1) => {
      const o = arcPts(a0, a1, 33, 3), i = arcPts(a0, a1, 28, 3);
      return ptsPath(o.concat(i.slice().reverse()), true);
    };
    [[196, 246], [294, 330]].forEach((a) => {
      const d = outerArc(a[0], a[1]);
      holes.push(`<path d="${d}"/>`);
      acr.push(`<path d="${d}" fill="url(#pkc-acryl)"/>`);
      ART.strokes.push({ pts: arcPts(a[0], a[1], 30.5, 12), closed: false, w: [9, 5, 1.6], gain: 0.85 });
    });

    // --- lower wings (acrylic blades hugging the ring's lower corners)
    const wing = (a0, a1) => {
      const n = 26, o = [], i = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n, a = lerp(a0, a1, t), w = 9 * Math.sin(Math.PI * Math.pow(t, 0.8));
        o.push(fpt(a, 34 + w * 0.55)); i.push(fpt(a, 34 - w * 0.45));
      }
      return ptsPath(o.concat(i.reverse()), true);
    };
    [[166, 106], [14, 74]].forEach((a) => {
      const d = wing(a[0], a[1]);
      holes.push(`<path d="${d}"/>`);
      addFill(d, 0.5);
      acr.push(`<path d="${d}" fill="url(#pkc-acryl)"/>`);
      deco += `<path d="${d}" fill="none" stroke="url(#pkc-chrome)" stroke-width="1.6"/>`;
      ART.strokes.push({ pts: arcPts(a[0], a[1], 34.5, 12), closed: false, w: [10, 6, 1.6], gain: 0.9 });
    });

    // --- top corner flame panels
    const flameTL = "M8,150 C14,120 6,96 0,80 L0,0 L120,0 C102,10 96,22 98,34 C80,26 60,30 46,44 C30,40 18,46 12,58 C22,70 20,88 14,98 C26,110 24,132 8,150 Z";
    const flameTR = "M588,236 C574,206 578,182 588,160 L588,0 L470,0 C486,12 492,26 488,40 C506,32 528,34 540,48 C556,44 570,52 576,64 C566,78 568,96 574,108 C560,122 562,146 572,164 C562,186 566,214 588,236 Z";
    [flameTL, flameTR].forEach((d) => {
      holes.push(`<path d="${d}"/>`);
      addFill(d, 0.42, { pulse: 1 });
      acr.push(`<path d="${d}" fill="url(#pkc-acrylP)"/>`);
      deco += `<path d="${d}" fill="none" stroke="url(#pkc-chrome)" stroke-width="2"/>`;
    });
    [[30, 30, 52], [70, 18, 40], [16, 110, 40], [46, 72, 30]].forEach((p) => ART.sprites.push({ x: p[0], y: p[1], r: p[2], g: 0.75 }));
    [[560, 40, 60], [520, 20, 46], [574, 120, 50], [580, 196, 40], [538, 70, 36]].forEach((p) => ART.sprites.push({ x: p[0], y: p[1], r: p[2], g: 0.85, pulse: 1 }));

    // --- crest (top ornament): wings, medallion, LED strip
    const bladesR = [
      { d: "M312,40 C356,22 408,8 462,0 C424,22 374,48 328,64 Z", s: "M330,44 C370,30 410,18 446,10 C412,28 372,46 336,56 Z" },
      { d: "M320,58 C368,46 420,38 468,38 C428,56 378,70 332,78 Z", s: "M338,60 C376,52 418,46 452,44 C420,56 380,66 344,70 Z" },
      { d: "M324,74 C366,70 412,72 452,82 C412,90 370,94 328,92 Z", s: "M342,77 C374,75 410,76 438,81 C408,86 374,88 346,87 Z" },
    ];
    const mir = (d) => d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (m, x, y) => f1(588 - parseFloat(x)) + "," + y);
    const blades = [];
    bladesR.forEach((b) => { blades.push(b); blades.push({ d: mir(b.d), s: mir(b.s) }); });
    blades.forEach((b) => {
      holes.push(`<path d="${b.s}"/>`);
      addFill(b.s, 0.55);
      acr.push(`<path d="${b.s}" fill="url(#pkc-acryl)"/>`);
    });
    let crest = "";
    for (let k = blades.length - 1; k >= 0; k--) {
      const b = blades[k];
      crest += `<path d="${b.d} ${b.s}" fill-rule="evenodd" fill="url(#pkc-gunBlade)" stroke="url(#pkc-chrome)" stroke-width="2"/>`;
      crest += `<path d="${b.s}" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="1"/>`;
    }
    [[392, 26], [398, 54], [394, 80], [196, 26], [190, 54], [194, 80]].forEach((p) => ART.sprites.push({ x: p[0], y: p[1], r: 26, g: 0.9 }));
    [[430, 14], [440, 46], [148, 46], [158, 14]].forEach((p) => ART.sprites.push({ x: p[0], y: p[1], r: 18, g: 0.8 }));
    // LED strip below the crest (along s=31 across the top); the AI crest breaks it in the middle.
    for (let k = 0; k < 15; k++) {
      const a = 249 + (k * 42) / 14, p = fpt(a, 31.5);
      if (S.crestImg && p[0] > CREST_ART.x + 6 && p[0] < CREST_ART.x + CREST_ART.w - 6) continue;
      ART.leds.push({ x: p[0], y: p[1], u: angU(p[0], p[1]), k });
      holes.push(`<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="3.6"/>`);
      acr.push(`<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="3.6" fill="url(#pkc-ledGlass)"/>`);
      deco += `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="4.6" fill="none" stroke="url(#pkc-chrome)" stroke-width="1.6"/>`;
    }
    // Medallion.
    holes.push(`<circle cx="294" cy="50" r="27"/>`);
    addFill("M267,50 a27,27 0 1 0 54,0 a27,27 0 1 0 -54,0 Z", 0.75, { u: 0 });
    acr.push(`<circle cx="294" cy="50" r="27" fill="url(#pkc-gem)"/>`);
    ART.sprites.push({ x: 294, y: 50, r: 48, g: 1.1, core: 1 });
    if (S.crestImg) {
      const A = CREST_ART;
      crest += `<image href="${S.crestImg.src}" x="${A.x}" y="${A.y}" width="${A.w}" height="${A.h}" preserveAspectRatio="xMidYMid meet" filter="url(#pkc-statueShadow)"/>`;
    } else {
    crest += `<path d="M262,30 L272,4 L282,22 L294,-4 L306,22 L316,4 L326,30 Z" fill="url(#pkc-gold)" stroke="#3a2006" stroke-width="1.4"/>`;
    crest += `<circle cx="294" cy="50" r="36" fill="none" stroke="#120d06" stroke-width="10"/>`;
    crest += `<circle cx="294" cy="50" r="36" fill="none" stroke="url(#pkc-goldU)" stroke-width="7"/>`;
    crest += `<circle cx="294" cy="50" r="40" fill="none" stroke="url(#pkc-chrome)" stroke-width="2.4"/>`;
    crest += `<circle cx="294" cy="50" r="31.5" fill="none" stroke="#fff3c8" stroke-opacity=".5" stroke-width=".8"/>`;
    let facets = "";
    for (let k = 0; k < 8; k++) { const a = k * 45 * DEG; facets += `M294,50 L${f1(294 + 27 * Math.cos(a))},${f1(50 + 27 * Math.sin(a))}`; }
    crest += `<path d="${facets}" stroke="#fff" stroke-opacity=".16" stroke-width=".8"/>`;
    crest += `<path d="M294,27 C304,40 313,48 311,61 C310,71 303,77 294,79 C285,77 278,71 277,61 C276,51 285,43 287,35 C289,43 291,47 295,49 C297,41 296,33 294,27 Z" fill="url(#pkc-gold)" stroke="#2a1404" stroke-width="1.4"/>`;
    crest += `<path d="M294,52 C299,58 301,63 299,68 C297,72 291,72 289,68 C287,63 290,58 294,52 Z" fill="#fff6d0" opacity=".8"/>`;
    }

    // --- speaker (top-left corner; the top-right corner belongs to the dragon head)
    const spk = "M24,96 C28,70 50,56 80,56 C100,56 114,66 114,84 C114,106 96,124 66,126 C40,128 22,116 24,96 Z";
    const spkRing = "M16,96 C20,64 46,48 80,48 C106,48 122,62 122,84 C122,112 100,134 66,134 C34,136 14,120 16,96 Z " + spk;
    let speakers = "";
    [false].forEach((m) => {
      const d = m ? mir(spk) : spk, dr = m ? mir(spkRing) : spkRing;
      holes.push(`<path d="${dr}" fill-rule="evenodd"/>`);
      addFill(dr, 0.5, { rule: "evenodd" });
      acr.push(`<path d="${dr}" fill-rule="evenodd" fill="url(#pkc-acryl)"/>`);
      // Perforated metal grille, pressed rings, a chrome bezel with screws and a crest cap, so it
      // reads as a speaker rather than a hole.
      const ring = (k, sw, col, op) => `<g transform="translate(68,91) scale(${k}) translate(-68,-91)"><path d="${d}" fill="none" stroke="${col}" stroke-opacity="${op}" stroke-width="${f1(sw / k)}"/></g>`;
      speakers += `<path d="${d}" fill="url(#pkc-grilleMetal)"/>`;
      speakers += `<path d="${d}" fill="url(#pkc-grille)"/>`;
      speakers += ring(0.74, 2.2, "#000", 0.55) + ring(0.735, 0.9, "#c9d2de", 0.35);
      speakers += ring(0.46, 2.2, "#000", 0.55) + ring(0.455, 0.9, "#c9d2de", 0.35);
      speakers += `<path d="${d}" fill="url(#pkc-spkShade)"/>`;
      speakers += `<path d="${d}" fill="none" stroke="#050607" stroke-width="9"/>`;
      speakers += `<path d="${d}" fill="none" stroke="url(#pkc-chrome)" stroke-width="5.5"/>`;
      speakers += `<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".8" transform="translate(-.6,-.8)"/>`;
      speakers += `<path d="${m ? mir(spkRing.split(" M")[0]) : spkRing.split(" M")[0]}" fill="none" stroke="url(#pkc-chrome)" stroke-width="1.8"/>`;
      [[40, 64], [110, 76], [92, 120], [28, 110]].forEach((q) => {
        speakers += `<g transform="translate(${q[0]},${q[1]})"><circle r="3.4" fill="url(#pkc-chromeV)" stroke="#000" stroke-width=".7"/><path d="M-2,0 H2 M0,-2 V2" stroke="#2a2e35" stroke-width="1"/></g>`;
      });
      speakers += `<circle cx="68" cy="91" r="13" fill="#050607"/><circle cx="68" cy="91" r="11.5" fill="url(#pkc-chromeV)" stroke="url(#pkc-goldU)" stroke-width="2"/>`;
      speakers += `<text x="68" y="92" font-family="'Yuji Syuku','Noto Serif TC',serif" font-size="13" text-anchor="middle" dominant-baseline="central" fill="url(#pkc-gold)" stroke="#2a1404" stroke-width=".5">${PK.t ? PK.t("lcd.crest") : "?lcd.crest"}</text>`;
    });
    [[30, 80], [60, 52], [100, 56], [120, 90], [96, 128], [52, 130], [20, 110]].forEach((p) => {
      ART.sprites.push({ x: p[0], y: p[1], r: 14, g: 0.8 });
    });

    // --- console (lower body)
    const consoleTop = CONSOLE_TOP;
    // The console plate is part of the masked body so its acrylic rings stay open.
    const consoleBase = `<path d="${consoleTop} L588,860 L0,860 Z" fill="url(#pkc-console)"/>` +
      `<path d="${consoleTop} L588,860 L0,860 Z" fill="url(#pkc-carbon)" opacity=".35"/>`;
    let cons = `<path d="${consoleTop}" fill="none" stroke="url(#pkc-chrome)" stroke-width="3"/>`;
    cons += `<path d="${consoleTop}" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="1.5" transform="translate(0,3)"/>`;
    cons += `<rect y="846" width="588" height="14" fill="#07080a"/><path d="M0,846 L588,846" stroke="url(#pkc-chrome)" stroke-width="1.2"/>`;
    // Handle socket.
    const H = L.handle;
    const ringBand = (cx, cy, r0, r1) => `M${cx - r1},${cy} a${r1},${r1} 0 1 0 ${2 * r1},0 a${r1},${r1} 0 1 0 ${-2 * r1},0 Z M${cx - r0},${cy} a${r0},${r0} 0 1 0 ${2 * r0},0 a${r0},${r0} 0 1 0 ${-2 * r0},0 Z`;
    const hBand = ringBand(H.cx, H.cy, H.r + 12, H.r + 19);
    holes.push(`<path d="${hBand}" fill-rule="evenodd"/>`);
    acr.push(`<path d="${hBand}" fill-rule="evenodd" fill="url(#pkc-acryl)"/>`);
    cons += `<circle cx="${H.cx}" cy="${H.cy}" r="${H.r + 23}" fill="none" stroke="#050607" stroke-width="5"/>`;
    cons += `<circle cx="${H.cx}" cy="${H.cy}" r="${H.r + 8}" fill="url(#pkc-well)"/>`;
    cons += `<circle cx="${H.cx}" cy="${H.cy}" r="${H.r + 9.5}" fill="none" stroke="url(#pkc-chrome)" stroke-width="5"/>`;
    cons += `<circle cx="${H.cx}" cy="${H.cy}" r="${H.r + 19.8}" fill="none" stroke="url(#pkc-chrome)" stroke-width="1.6"/>`;
    let ticks = "";
    for (let k = 0; k <= 10; k++) {
      const a = (150 + k * 24) * DEG;
      ticks += `M${f1(H.cx + (H.r + 2) * Math.cos(a))},${f1(H.cy + (H.r + 2) * Math.sin(a))}L${f1(H.cx + (H.r + 6) * Math.cos(a))},${f1(H.cy + (H.r + 6) * Math.sin(a))}`;
    }
    cons += `<path d="${ticks}" stroke="#c9d2de" stroke-opacity=".5" stroke-width="1.4"/>`;
    ART.strokes.push({ pts: circlePts(H.cx, H.cy, H.r + 15.5, 14), closed: true, w: [10, 6, 1.6], gain: 0.9 });
    // PUSH socket (shield shape).
    const P = L.push, pcx = P.x + P.w / 2, pcy = P.y + P.h / 2;
    const shield = (k) => {
      const pts = [[0, -72], [52, -60], [80, -40], [80, 20], [62, 50], [0, 76], [-62, 50], [-80, 20], [-80, -40], [-52, -60]];
      return ptsPath(spline(pts.concat([pts[0]]), 6).map((p) => [pcx + p[0] * k, pcy + 2 + p[1] * k]), true);
    };
    const sBand = shield(1.12) + " " + shield(1.05);
    holes.push(`<path d="${sBand}" fill-rule="evenodd"/>`);
    acr.push(`<path d="${sBand}" fill-rule="evenodd" fill="url(#pkc-acryl)"/>`);
    cons += `<path d="${shield(1.16)}" fill="none" stroke="#050607" stroke-width="4"/>`;
    cons += `<path d="${shield(1.0)}" fill="url(#pkc-well)" stroke="url(#pkc-chrome)" stroke-width="4.5"/>`;
    cons += `<path d="${shield(1.12)}" fill="none" stroke="url(#pkc-chrome)" stroke-width="1.4"/>`;
    {
      const pts = [[0, -72], [52, -60], [80, -40], [80, 20], [62, 50], [0, 76], [-62, 50], [-80, 20], [-80, -40], [-52, -60]];
      const sp = spline(pts.concat([pts[0]]), 3).map((p) => [pcx + p[0] * 1.085, pcy + 2 + p[1] * 1.085]);
      ART.strokes.push({ pts: sp.map((p) => [p[0], p[1], angU(p[0], p[1])]), closed: true, w: [10, 6, 1.6], gain: 0.95 });
    }
    // Panel socket.
    const Q = L.panel;
    const rrect = (x, y, w, h, r) => `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
    const qBand = rrect(Q.x - 9, Q.y - 9, Q.w + 18, Q.h + 18, 20) + " " + rrect(Q.x - 4, Q.y - 4, Q.w + 8, Q.h + 8, 16);
    holes.push(`<path d="${qBand}" fill-rule="evenodd"/>`);
    acr.push(`<path d="${qBand}" fill-rule="evenodd" fill="url(#pkc-acryl)"/>`);
    cons += `<path d="${rrect(Q.x - 12, Q.y - 12, Q.w + 24, Q.h + 24, 22)}" fill="none" stroke="#050607" stroke-width="4"/>`;
    cons += `<path d="${rrect(Q.x, Q.y, Q.w, Q.h, 14)}" fill="url(#pkc-wellR)" stroke="url(#pkc-chrome)" stroke-width="4"/>`;
    cons += `<path d="${rrect(Q.x - 9, Q.y - 9, Q.w + 18, Q.h + 18, 20)}" fill="none" stroke="url(#pkc-chrome)" stroke-width="1.4"/>`;
    ART.strokes.push({ pts: rrectPts(Q.x - 6.5, Q.y - 6.5, Q.w + 13, Q.h + 13, 18, 14), closed: true, w: [10, 6, 1.6], gain: 0.85 });
    // Bolts.
    const bolt = (x, y) => `<g transform="translate(${x},${y})"><circle r="4.4" fill="url(#pkc-chromeV)" stroke="#000" stroke-width=".8"/><path d="M-2.6,0 H2.6 M0,-2.6 V2.6" stroke="#2a2e35" stroke-width="1.2"/></g>`;
    cons += bolt(215, 712) + bolt(384, 712) + bolt(215, 838) + bolt(384, 846) + bolt(20, 690);
    deco += cons;

    // --- dragon
    const A = DRAGON_ART;
    const dragon = S.dragonImg
      ? `<g clip-path="url(#pkc-outWin)"><image href="${S.dragonImg.src}" x="${A.x}" y="${A.y}" width="${A.w}" height="${A.h}" preserveAspectRatio="xMaxYMin meet" filter="url(#pkc-statueShadow)"/></g>`
      : buildDragonSVG(holes, acr);

    // --- sub display
    const Sd = L.sub;
    let sub = `<g id="pkc-sub">`;
    sub += `<rect x="${Sd.x - 5}" y="${Sd.y - 5}" width="${Sd.w + 10}" height="${Sd.h + 10}" rx="10" fill="#08090c" stroke="url(#pkc-chrome)" stroke-width="3"/>`;
    sub += `<rect x="${Sd.x}" y="${Sd.y}" width="${Sd.w}" height="${Sd.h}" rx="6" fill="url(#pkc-subBg)"/>`;
    sub += `<g id="pkc-subText" filter="url(#pkc-subGlow)"></g>`;
    sub += `<rect x="${Sd.x + 2}" y="${Sd.y + 2}" width="${Sd.w - 4}" height="${Sd.h * 0.42}" rx="5" fill="url(#pkc-glassHi)"/>`;
    sub += `</g>`;

    // --- kanji gimmick
    let gim = "";
    L.gimmick.forEach((g, i) => {
      const cx = g.x + g.w / 2, cy = g.y + g.h / 2, rot = i ? 5 : -7;
      gim += `<g transform="translate(${cx},${cy}) rotate(${rot})">`;
      gim += `<rect x="${-g.w / 2}" y="${-g.h / 2}" width="${g.w}" height="${g.h}" rx="16" fill="url(#pkc-block)" stroke="url(#pkc-blockEdge)" stroke-width="2.2"/>`;
      gim += `<rect x="${-g.w / 2 + 5}" y="${-g.h / 2 + 5}" width="${g.w - 10}" height="${g.h - 10}" rx="12" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="1"/>`;
      gim += `<path d="M${-g.w / 2 + 8},${g.h / 2 - 6} C-30,10 -10,30 -18,-20 C0,6 10,0 8,-40 C26,-6 36,10 ${g.w / 2 - 10},${g.h / 2 - 6} Z" fill="url(#pkc-flameFill)" opacity=".55"/>`;
      const font = `font-family="'Yuji Syuku','Dela Gothic One','Noto Sans TC','Arial Black',Impact,sans-serif" font-size="${g.h * 0.84}" text-anchor="middle" dominant-baseline="central"`;
      gim += `<text ${font} y="4" fill="none" stroke="#2a0000" stroke-opacity=".85" stroke-width="13" stroke-linejoin="round">${g.ch}</text>`;
      gim += `<text ${font} y="4" fill="none" stroke="#ff4a00" stroke-width="6.5" stroke-linejoin="round">${g.ch}</text>`;
      gim += `<text ${font} y="4" fill="url(#pkc-fireText)">${g.ch}</text>`;
      gim += `<text ${font} y="4" fill="none" stroke="#fff6d6" stroke-opacity=".55" stroke-width="1">${g.ch}</text>`;
      gim += `<path d="M${-g.w / 2 + 10},${-g.h / 2 + 8} L${g.w / 2 - 30},${-g.h / 2 + 8} L${-g.w / 2 + 10},${g.h / 2 - 40} Z" fill="#fff" opacity=".08"/>`;
      gim += `</g>`;
      ART.sprites.push({ x: cx, y: cy, r: 66, g: 0.55, fire: 1 });
      ART.sprites.push({ x: cx - 20, y: cy + 22, r: 36, g: 0.5, fire: 2 });
      ART.sprites.push({ x: cx + 22, y: cy - 10, r: 34, g: 0.45, fire: 3 });
    });

    // --- frame trims (chrome lips, bevels, engraving)
    let trims = "";
    trims += `<path d="${loopPath(23, 3)}" fill="none" stroke="#06070a" stroke-width="3"/>`;
    trims += `<path d="${loopPath(21.2, 3)}" fill="none" stroke="#9aa3ae" stroke-opacity=".35" stroke-width="1"/>`;
    trims += `<path d="${loopPath(18.4, 3)}" fill="none" stroke="url(#pkc-chrome)" stroke-width="2.8"/>`;
    trims += `<path d="${loopPath(3.6, 3)}" fill="none" stroke="url(#pkc-chrome)" stroke-width="3.2"/>`;
    trims += `<path d="${loopPath(0.6, 3)}" fill="none" stroke="#020203" stroke-width="2.4"/>`;
    trims += `<path d="${loopPath(36, 3)}" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="1.4"/>`;
    trims += `<path d="${loopPath(37.2, 3)}" fill="none" stroke="#c8d0da" stroke-opacity=".14" stroke-width="1"/>`;
    [[196, 246], [294, 330]].forEach((a) => {
      trims += `<path d="${outerArc(a[0], a[1])}" fill="none" stroke="url(#pkc-chrome)" stroke-width="1.5"/>`;
    });

    // --- assemble
    let s = `<defs>${frontDefs()}
<mask id="pkc-bodyMask" maskUnits="userSpaceOnUse" x="0" y="0" width="588" height="860">
<rect width="588" height="860" fill="#fff"/><g fill="#000">${holes.join("")}</g></mask>
<filter id="pkc-statueShadow" x="-10%" y="-10%" width="125%" height="125%"><feDropShadow dx="-3" dy="5" stdDeviation="3.5" flood-color="#000" flood-opacity=".7"/></filter>
<clipPath id="pkc-outWin"><path clip-rule="evenodd" d="M0,0H588V860H0Z ${win0}"/></clipPath>
<clipPath id="pkc-aboveConsole"><path d="${CONSOLE_TOP} L588,0 L0,0 Z"/></clipPath>
</defs>`;
    s += `<g mask="url(#pkc-bodyMask)">`;
    s += `<rect width="588" height="860" fill="url(#pkc-gun)"/>`;
    s += `<rect width="588" height="860" fill="url(#pkc-sheen)"/>`;
    s += `<rect width="588" height="860" fill="url(#pkc-carbon)" opacity=".5"/>`;
    s += `<path d="${loopPath(60, 4)}" fill="none" stroke="#fff" stroke-opacity=".05" stroke-width="30"/>`;
    s += consoleBase;
    s += `</g>`;
    s += acr.join("");
    s += trims;
    s += speakers;
    s += crest;
    s += dragon;
    s += deco;
    s += sub;
    s += gim;
    svg.innerHTML = s;
    S.subText = svg.querySelector("#pkc-subText");
  }

  function circlePts(cx, cy, r, step) {
    const n = Math.max(12, Math.round((TAU * r) / step)), out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - Math.PI / 2, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      out.push([x, y, angU(x, y)]);
    }
    return out;
  }
  function rrectPts(x, y, w, h, r, step) {
    const out = [];
    const seg = (x0, y0, x1, y1) => {
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let i = 0; i < n; i++) out.push([lerp(x0, x1, i / n), lerp(y0, y1, i / n)]);
    };
    const arc = (cx, cy, a0) => { for (let i = 0; i < 3; i++) { const a = (a0 + i * 30) * DEG; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
    seg(x + r, y, x + w - r, y); arc(x + w - r, y + r, -90);
    seg(x + w, y + r, x + w, y + h - r); arc(x + w - r, y + h - r, 0);
    seg(x + w - r, y + h, x + r, y + h); arc(x + r, y + h - r, 90);
    seg(x, y + h - r, x, y + r); arc(x + r, y + r, 180);
    return out.map((p) => [p[0], p[1], angU(p[0], p[1])]);
  }

  function frontDefs() {
    return `
<linearGradient id="pkc-gun" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0" stop-color="#3d434d"/><stop offset=".18" stop-color="#262a32"/><stop offset=".45" stop-color="#1c1f26"/><stop offset=".7" stop-color="#2a2e36"/><stop offset=".8" stop-color="#16181d"/><stop offset="1" stop-color="#0c0d10"/></linearGradient>
<linearGradient id="pkc-sheen" x1="0" y1="0" x2="1" y2="1">
 <stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".16" stop-color="#fff" stop-opacity="0"/><stop offset=".42" stop-color="#fff" stop-opacity=".06"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset=".78" stop-color="#9cc0ff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<pattern id="pkc-carbon" width="6" height="6" patternUnits="userSpaceOnUse">
 <rect width="3" height="3" fill="#fff" opacity=".035"/><rect x="3" y="3" width="3" height="3" fill="#fff" opacity=".035"/><rect x="3" width="3" height="3" fill="#000" opacity=".12"/><rect y="3" width="3" height="3" fill="#000" opacity=".12"/></pattern>
<linearGradient id="pkc-chrome" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="588" y2="860">
 <stop offset="0" stop-color="#f8fbff"/><stop offset=".08" stop-color="#7f8996"/><stop offset=".16" stop-color="#eef3f8"/><stop offset=".26" stop-color="#454c57"/><stop offset=".36" stop-color="#e6ebf2"/>
 <stop offset=".46" stop-color="#5a626e"/><stop offset=".56" stop-color="#f2f5f9"/><stop offset=".66" stop-color="#4a515c"/><stop offset=".76" stop-color="#dfe5ec"/><stop offset=".88" stop-color="#555d68"/><stop offset="1" stop-color="#e8edf3"/></linearGradient>
<linearGradient id="pkc-chromeV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fafcff"/><stop offset=".45" stop-color="#8a939f"/><stop offset=".55" stop-color="#3e444d"/><stop offset="1" stop-color="#cfd6de"/></linearGradient>
<linearGradient id="pkc-gunBlade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a515c"/><stop offset=".5" stop-color="#22262d"/><stop offset="1" stop-color="#121418"/></linearGradient>
<linearGradient id="pkc-acryl" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="200" y2="860">
 <stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".3" stop-color="#cfe0ff" stop-opacity=".07"/><stop offset=".55" stop-color="#fff" stop-opacity=".14"/><stop offset=".8" stop-color="#cfe0ff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient>
<radialGradient id="pkc-acrylP" gradientUnits="userSpaceOnUse" cx="294" cy="120" r="320">
 <stop offset=".5" stop-color="#fff" stop-opacity=".04"/><stop offset=".8" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity=".2"/></radialGradient>
<linearGradient id="pkc-acrylM" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".5" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#fff" stop-opacity=".18"/></linearGradient>
<radialGradient id="pkc-ledGlass" cx=".38" cy=".35" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".4" stop-color="#fff" stop-opacity=".15"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></radialGradient>
<radialGradient id="pkc-gem" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".35" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient>
<linearGradient id="pkc-gold" x1="0" y1="0" x2="1" y2="1">
 <stop offset="0" stop-color="#fff4c0"/><stop offset=".25" stop-color="#f4c24c"/><stop offset=".55" stop-color="#b47a16"/><stop offset=".8" stop-color="#6e4006"/><stop offset="1" stop-color="#3a2004"/></linearGradient>
<linearGradient id="pkc-goldU" gradientUnits="userSpaceOnUse" x1="250" y1="10" x2="338" y2="90">
 <stop offset="0" stop-color="#fff2b8"/><stop offset=".3" stop-color="#d89a28"/><stop offset=".5" stop-color="#ffe08a"/><stop offset=".75" stop-color="#7a4a0c"/><stop offset="1" stop-color="#e8b44a"/></linearGradient>
<pattern id="pkc-mesh" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
 <rect width="5" height="5" fill="#16181c"/><circle cx="2.5" cy="2.5" r="1.45" fill="#000"/><circle cx="2" cy="2" r=".6" fill="#5a606a" opacity=".6"/></pattern>
<linearGradient id="pkc-grilleMetal" x1="0" y1="0" x2=".6" y2="1">
 <stop offset="0" stop-color="#6a7380"/><stop offset=".35" stop-color="#3a414c"/><stop offset=".75" stop-color="#1e232b"/><stop offset="1" stop-color="#101318"/></linearGradient>
<pattern id="pkc-grille" width="6" height="10.392" patternUnits="userSpaceOnUse">
 <g fill="#020304"><circle cx="0" cy="0" r="1.75"/><circle cx="6" cy="0" r="1.75"/><circle cx="3" cy="5.196" r="1.75"/><circle cx="0" cy="10.392" r="1.75"/><circle cx="6" cy="10.392" r="1.75"/></g>
 <g fill="none" stroke="#fff" stroke-opacity=".22" stroke-width=".5"><path d="M-1.4,1.1 A1.75,1.75 0 0 0 1.4,1.1 M4.6,1.1 A1.75,1.75 0 0 0 7.4,1.1 M1.6,6.3 A1.75,1.75 0 0 0 4.4,6.3"/></g></pattern>
<radialGradient id="pkc-spkShade" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
<linearGradient id="pkc-console" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0" stop-color="#2c3038"/><stop offset=".25" stop-color="#1a1d22"/><stop offset=".7" stop-color="#121418"/><stop offset="1" stop-color="#08090b"/></linearGradient>
<radialGradient id="pkc-well" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="#030304"/><stop offset=".7" stop-color="#0b0c0f"/><stop offset="1" stop-color="#2a2e36"/></radialGradient>
<linearGradient id="pkc-wellR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020203"/><stop offset=".8" stop-color="#0c0d10"/><stop offset="1" stop-color="#262a31"/></linearGradient>
<linearGradient id="pkc-subBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140a22"/><stop offset="1" stop-color="#020104"/></linearGradient>
<linearGradient id="pkc-glassHi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<filter id="pkc-subGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceGraphic" stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<linearGradient id="pkc-block" x1="0" y1="0" x2="1" y2="1">
 <stop offset="0" stop-color="#ffb070" stop-opacity=".2"/><stop offset=".5" stop-color="#ff4a10" stop-opacity=".06"/><stop offset="1" stop-color="#8a0a00" stop-opacity=".18"/></linearGradient>
<linearGradient id="pkc-blockEdge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b0" stop-opacity=".9"/><stop offset=".5" stop-color="#ff7a10" stop-opacity=".5"/><stop offset="1" stop-color="#ffd060" stop-opacity=".8"/></linearGradient>
<linearGradient id="pkc-flameFill" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff2a00"/><stop offset=".6" stop-color="#ff8a10"/><stop offset="1" stop-color="#ffd050" stop-opacity="0"/></linearGradient>
<linearGradient id="pkc-fireText" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0" stop-color="#fffdf0"/><stop offset=".3" stop-color="#ffe680"/><stop offset=".6" stop-color="#ff9a10"/><stop offset="1" stop-color="#e01800"/></linearGradient>
<linearGradient id="pkc-scaleG" x1="0" y1="0" x2="1" y2="1">
 <stop offset="0" stop-color="#ffe9a0"/><stop offset=".35" stop-color="#d79a2c"/><stop offset=".7" stop-color="#8a5410"/><stop offset="1" stop-color="#4a2a06"/></linearGradient>
<linearGradient id="pkc-belly" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff2c6"/><stop offset="1" stop-color="#c99a4a"/></linearGradient>
<linearGradient id="pkc-horn" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#6a5030"/><stop offset=".4" stop-color="#e8dcc0"/><stop offset="1" stop-color="#fffaf0"/></linearGradient>
<filter id="pkc-dshadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="3"/><feOffset dx="3" dy="5" result="o"/><feComponentTransfer><feFuncA type="linear" slope=".6"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  }

  // Dragon vector sculpture. Pushes its acrylic parts into holes/acr; returns opaque art.
  function buildDragonSVG(holes, acr) {
    const D = dragonBody();
    const light = [-0.6, -0.8];
    let body = "";
    const tubeArt = (pts, w0, w1, opts) => {
      opts = opts || {};
      const T = tube(pts, (t) => lerp(w0, w1, opts.taper ? Math.pow(t, opts.taper) : t));
      // Choose the strip side facing the light.
      let dot = 0;
      for (let i = 0; i < T.n; i++) dot += T.N[i][0] * light[0] + T.N[i][1] * light[1];
      const sg = dot >= 0 ? 1 : -1;
      let o = "";
      o += `<path d="${T.strip(-1.08, 1.08)}" fill="#1a0c02"/>`;
      o += `<path d="${T.strip(-1, 1)}" fill="url(#pkc-scaleG)"/>`;
      o += `<path d="${T.strip(-1 * sg, -0.45 * sg)}" fill="#3a1e04" opacity=".55"/>`;
      // belly plates on the shadow side
      o += `<path d="${T.strip(-0.98 * sg, -0.55 * sg)}" fill="url(#pkc-belly)" opacity=".85"/>`;
      let plates = "";
      for (let i = 2; i < T.n - 1; i += 2) {
        const a = T.at(i, -0.98 * sg), b = T.at(i, -0.55 * sg);
        plates += `M${f1(a[0])},${f1(a[1])}L${f1(b[0])},${f1(b[1])}`;
      }
      o += `<path d="${plates}" stroke="#6a4210" stroke-width=".9" stroke-opacity=".8"/>`;
      // scales: scallops across the back
      let sc = "", hi = "";
      for (let i = 1; i < T.n - 1; i += 2) {
        const odd = (i >> 1) % 2;
        const fr = odd ? [-0.5, 0.05, 0.6, 1] : [-0.5, -0.2, 0.33, 0.86, 1];
        for (let j = 0; j < fr.length - 1; j++) {
          const f0 = fr[j] * sg, fa = fr[j + 1] * sg;
          const a = T.at(i, f0), b = T.at(i, fa);
          const back = Math.max(0, i - 2);
          const m = T.at(back, ((f0 + fa) / 2));
          sc += `M${f1(a[0])},${f1(a[1])}Q${f1(m[0])},${f1(m[1])} ${f1(b[0])},${f1(b[1])}`;
          const m2 = T.at(Math.max(0, i - 1), ((f0 + fa) / 2));
          hi += `M${f1(lerp(a[0], m2[0], 0.3))},${f1(lerp(a[1], m2[1], 0.3))}Q${f1(m2[0])},${f1(m2[1])} ${f1(lerp(b[0], m2[0], 0.3))},${f1(lerp(b[1], m2[1], 0.3))}`;
        }
      }
      o += `<path d="${sc}" fill="none" stroke="#3a1c02" stroke-width="1.1" stroke-opacity=".75"/>`;
      o += `<path d="${hi}" fill="none" stroke="#fff3c4" stroke-width=".8" stroke-opacity=".45"/>`;
      // specular highlight band
      o += `<path d="${T.strip(0.35 * sg, 0.7 * sg)}" fill="#fff6d6" opacity=".28"/>`;
      // dorsal fins (acrylic) on the light side
      if (opts.fins) {
        let fins = "";
        for (let i = 3; i < T.n - 3; i += opts.fins) {
          const a = T.at(i - 2, 1 * sg), b = T.at(i + 2, 1 * sg);
          const P = T.P[i], N = T.N[i];
          const tip = [P[0] + N[0] * sg * (T.W[i] + 11) - (T.P[i + 2][0] - T.P[i - 2][0]) * 0.6, P[1] + N[1] * sg * (T.W[i] + 11) - (T.P[i + 2][1] - T.P[i - 2][1]) * 0.6];
          fins += `M${f1(a[0])},${f1(a[1])}Q${f1(lerp(a[0], tip[0], 0.6) + N[0] * sg * 2)},${f1(lerp(a[1], tip[1], 0.6) + N[1] * sg * 2)} ${f1(tip[0])},${f1(tip[1])}Q${f1(lerp(b[0], tip[0], 0.4))},${f1(lerp(b[1], tip[1], 0.4))} ${f1(b[0])},${f1(b[1])}Z`;
          ART.sprites.push({ x: tip[0] * 0.6 + P[0] * 0.4, y: tip[1] * 0.6 + P[1] * 0.4, r: 14, g: 0.85, pulse: 1 });
        }
        holes.push(`<path d="${fins}"/>`);
        acr.push(`<path d="${fins}" fill="url(#pkc-acryl)" stroke="#ffe7a0" stroke-opacity=".7" stroke-width="1"/>`);
        addFill(fins, 0.6, { pulse: 1 });
      }
      return o;
    };
    // Coils behind/over the ring.
    D.coils.forEach((c) => { body += tubeArt(c.pts, c.w0, c.w1, {}); });
    body += tubeArt(D.tail, 22, 3, { fins: 4, taper: 1.3 });
    body += tubeArt(D.neck, 24, 34, { fins: 3 });
    // Tail flame tip (acrylic).
    const tt = D.tail[D.tail.length - 1];
    const tailFlame = `M${tt[0] - 2},${tt[1] + 2} C${tt[0] + 6},${tt[1] - 14} ${tt[0] + 20},${tt[1] - 16} ${tt[0] + 26},${tt[1] - 30} C${tt[0] + 28},${tt[1] - 14} ${tt[0] + 18},${tt[1] - 2} ${tt[0] + 24},${tt[1] + 8} C${tt[0] + 12},${tt[1] + 4} ${tt[0] + 4},${tt[1] + 8} ${tt[0] - 2},${tt[1] + 2} Z`;
    holes.push(`<path d="${tailFlame}"/>`);
    acr.push(`<path d="${tailFlame}" fill="url(#pkc-acryl)" stroke="#ffe7a0" stroke-opacity=".7" stroke-width="1"/>`);
    addFill(tailFlame, 0.75, { pulse: 1 });
    ART.sprites.push({ x: tt[0] + 14, y: tt[1] - 8, r: 22, g: 0.9, pulse: 1 });

    // Foreleg gripping the ring at the top right.
    const arm = tubeArt(spline([[580, 204], [570, 226], [556, 242]], 8), 17, 12, {});
    const claw = `<g transform="translate(548,251) rotate(24)">
<path d="M-11,-7 C-3,-13 9,-12 14,-5 C17,1 14,8 8,9 L-8,9 C-13,7 -15,-1 -11,-7 Z" fill="url(#pkc-scaleG)" stroke="#1a0c02" stroke-width="1.3"/>
<path d="M-6,-8 C-2,-10 4,-10 8,-7" fill="none" stroke="#fff3c4" stroke-opacity=".6" stroke-width="1"/>
<path d="M-9,7 C-14,13 -19,17 -25,18 C-17,19 -11,16 -6,10 Z M-1,9 C-3,17 -6,22 -11,26 C-3,25 2,19 3,10 Z M7,9 C8,16 7,22 3,28 C11,24 13,16 12,8 Z" fill="url(#pkc-horn)" stroke="#2a1a08" stroke-width=".9"/></g>`;

    // Head.
    const H = HEAD;
    const tr = `translate(${HEAD_T.x},${HEAD_T.y}) scale(${HEAD_T.s})`;
    let teeth = "";
    H.teethUp.forEach((t) => { const y = 87.5 + (t[0] - 10) * 0.03; teeth += `M${t[0] - 3.2},${f1(y)} L${t[0]},${f1(y + t[1])} L${t[0] + 3.2},${f1(y)} Z`; });
    H.teethLo.forEach((t) => { const y = 122 - (t[0] - 20) * 0.197 + 1.5; teeth += `M${t[0] - 3.2},${f1(y)} L${t[0]},${f1(y - t[1])} L${t[0] + 3.2},${f1(y)} Z`; });
    // Acrylic parts of the head (mane, eye, beard, mouth glow) are mask holes, lit from behind.
    holes.push(`<g transform="${tr}">${H.mane.map((d) => `<path d="${d}"/>`).join("")}<path d="${H.eye}"/><path d="${H.mouth}"/><path d="${H.beard}"/></g>`);
    acr.push(`<g transform="${tr}">${H.mane.map((d) => `<path d="${d}" fill="url(#pkc-acrylM)" stroke="#fff0c0" stroke-opacity=".8" stroke-width="1.6"/>`).join("")}
<path d="${H.beard}" fill="url(#pkc-acrylM)" stroke="#fff0c0" stroke-opacity=".75" stroke-width="1.4"/>
<path d="${H.mouth}" fill="#3a0400" opacity=".35"/>
<path d="${H.eye}" fill="url(#pkc-ledGlass)" stroke="#2a0e00" stroke-width="2.2"/></g>`);
    H.mane.forEach((d) => addFill(d, 0.62, { tr: HEAD_T, pulse: 1 }));
    addFill(H.beard, 0.55, { tr: HEAD_T, pulse: 1 });
    addFill(H.eye, 1.0, { tr: HEAD_T, eye: 1 });
    addFill(H.mouth, 0.8, { tr: HEAD_T, mouth: 1 });
    H.maneHot.forEach((p) => { const q = headPt(p[0], p[1]); ART.sprites.push({ x: q[0], y: q[1], r: 22, g: 0.8, pulse: 1 }); });
    { const p = headPt(110, 50); ART.sprites.push({ x: p[0], y: p[1], r: 12, g: 1.4, eye: 1 }); }
    { const p = headPt(70, 96); ART.sprites.push({ x: p[0], y: p[1], r: 34, g: 1.0, mouth: 1 }); }

    let head = `<g transform="${tr}">`;
    head += `<path d="${H.horn2}" fill="url(#pkc-horn)" stroke="#2a1a08" stroke-width="1.6"/>`;
    head += `<path d="M164,34 C188,24 214,18 240,14" fill="none" stroke="#6a5030" stroke-width="1" stroke-opacity=".6"/>`;
    head += `<path d="${H.frill}" fill="url(#pkc-scaleG)" stroke="#1a0c02" stroke-width="1.6"/>`;
    head += `<path d="${H.jaw}" fill="url(#pkc-scaleG)" stroke="#1a0c02" stroke-width="2"/>`;
    head += `<path d="M30,138 C70,134 112,126 148,118 C154,112 156,106 155,102 C120,116 70,126 22,130 Z" fill="#2a1404" opacity=".5"/>`;
    head += `<path d="M26,124 C56,114 100,106 146,100" fill="none" stroke="#fff2c0" stroke-opacity=".5" stroke-width="1.3"/>`;
    head += `<path d="${H.tongue}" fill="#c0201a" stroke="#4a0400" stroke-width="1"/>`;
    head += `<path d="${teeth}" fill="#fffaf0" stroke="#5a4020" stroke-width=".8"/>`;
    head += `<path d="${H.skull}" fill="url(#pkc-scaleG)" stroke="#1a0c02" stroke-width="2.2"/>`;
    head += `<path d="${H.under}" fill="#2a1404" opacity=".45"/>`;
    head += `<path d="${H.ridge}" fill="url(#pkc-gold)" stroke="#1a0c02" stroke-width="1.2"/>`;
    let ssc = "";
    for (let k = 0; k < 5; k++) for (let j = 0; j < 3; j++) {
      const x = 128 + k * 12 + (j % 2) * 6, y = 40 + j * 12;
      if (x > 190 - j * 6) continue;
      ssc += `M${x - 6},${y} Q${x},${y + 7} ${x + 6},${y}`;
    }
    for (let k = 0; k < 5; k++) { const x = 30 + k * 14; ssc += `M${x - 6},${66 + k * 0.6} Q${x},${73 + k * 0.6} ${x + 6},${66 + k * 0.6}`; }
    head += `<path d="${ssc}" fill="none" stroke="#3a1c02" stroke-width="1.2" stroke-opacity=".55"/>`;
    head += `<path d="${H.cheek}" fill="url(#pkc-gold)" stroke="#1a0c02" stroke-width="1.4"/>`;
    head += `<path d="M106,66 C122,64 140,68 154,78" fill="none" stroke="#fff3c4" stroke-opacity=".55" stroke-width="1.1"/>`;
    head += `<path d="${H.nose}" fill="url(#pkc-gold)" stroke="#1a0c02" stroke-width="1.6"/>`;
    head += `<path d="M12,63 C15,57 23,56 26,61 C23,66 16,67 12,63 Z" fill="#1a0600"/>`;
    head += `<path d="M8,60 C11,53 18,51 25,52" fill="none" stroke="#fff6d6" stroke-opacity=".75" stroke-width="1.5"/>`;
    head += `<path d="${H.brow}" fill="url(#pkc-gold)" stroke="#1a0c02" stroke-width="1.6"/>`;
    head += `<path d="M92,46 L102,36 L124,33" fill="none" stroke="#fff6d6" stroke-opacity=".7" stroke-width="1.3"/>`;
    head += `<path d="M110,44 C109,48 109,53 111,57" stroke="#140000" stroke-width="3.2" stroke-linecap="round"/>`;
    head += `<path d="${H.horn1}" fill="url(#pkc-horn)" stroke="#2a1a08" stroke-width="1.6"/>`;
    head += `<path d="M150,20 C166,8 184,0 204,-6 M160,26 C174,16 190,10 210,4" fill="none" stroke="#7a5a30" stroke-width="1" stroke-opacity=".7"/>`;
    head += `<path d="M60,44 L84,40 C94,32 104,26 116,24 L140,20 C156,20 170,26 180,36" fill="none" stroke="#fff6d6" stroke-width="2" stroke-opacity=".5"/>`;
    const whisk = (d, w) => `<path d="${d}" fill="none" stroke="#1a0c02" stroke-width="${w + 1.8}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="url(#pkc-gold)" stroke-width="${w}" stroke-linecap="round"/>`;
    head += whisk("M10,70 C-20,72 -44,96 -40,130 C-38,144 -28,152 -18,154", 2.6);
    head += whisk("M26,92 C4,110 -8,134 2,160 C6,170 14,174 20,176", 2.2);
    head += `</g>`;

    // The lit mane flows over the neck: cut the mane shapes out of the body art.
    const noMane = `<defs><mask id="pkc-noMane" maskUnits="userSpaceOnUse" x="0" y="0" width="588" height="860"><rect width="588" height="860" fill="#fff"/>` +
      `<g transform="${tr}" fill="#000">${H.mane.map((d) => `<path d="${d}"/>`).join("")}</g></mask></defs>`;
    const bodyArt = `${noMane}<g clip-path="url(#pkc-outWin)" filter="url(#pkc-dshadow)"><g mask="url(#pkc-noMane)">${body}${arm}</g></g>`;
    return bodyArt + `<g filter="url(#pkc-dshadow)">${claw}${head}</g>`;
  }

  // ---------------------------------------------------------------- state
  const S = {
    mounted: false, back: null, field: null, front: null, ctx: null, subText: null,
    k: 1, cw: 0, ch: 0, pins: null, over: null, winPath: null, lcdPath: null,
    balls: [], nextId: 1, time: 0, last: 0, raf: 0, paused: false, measureT: 0,
    theme: "normal", prevTheme: "normal", themeT0: -10,
    flashAmt: 0, flashCol: [255, 255, 255],
    attOpen: false, attK: 0, denOpen: false, denK: 0,
    wmA: 0, wmW: 0,
    glow: { heso: 0, denchu: 0, attacker: 0, out: 0 },
    wisps: [], reduced: false,
  };

  // ---------------------------------------------------------------- themes
  function themeAt(name, u, t, o) {
    let r, g, b, i;
    switch (name) {
      case "normal": {
        const w = 0.5 + 0.5 * Math.sin(TAU * (t * 0.3 - u * 2));
        r = 25 + 60 * w; g = 110 + 110 * w; b = 255; i = 0.62 + 0.3 * w; break;
      }
      case "reach": {
        const p = Math.pow(0.5 + 0.5 * Math.sin(TAU * t * 1.6), 2);
        r = 255; g = 22 + 70 * p; b = 18 + 30 * p; i = 0.42 + 0.75 * p; break;
      }
      case "hot": {
        const band = Math.floor(u * 20 + t * 11) & 1;
        const fl = 0.8 + 0.2 * Math.sin(t * 37 + u * 51) * Math.sin(t * 23 + u * 17);
        if (band) { r = 255; g = 205; b = 60; } else { r = 255; g = 46; b = 8; }
        i = (0.8 + 0.35 * (0.5 + 0.5 * Math.sin(t * 19))) * fl; break;
      }
      case "rainbow": {
        const c = hsv((u + t * 0.45) * 360, 1, 1);
        r = c[0]; g = c[1]; b = c[2]; i = 1.0; break;
      }
      case "bonus": {
        const ch = Math.pow(Math.max(0, Math.cos(TAU * (u * 8 - t * 1.6))), 6);
        r = 255; g = 150 + 95 * ch; b = 10 + 170 * ch; i = 0.42 + 0.95 * ch; break;
      }
      case "rush": {
        const m = 0.5 + 0.5 * Math.sin(TAU * (u * 3 + t * 0.4));
        const ch = Math.pow(Math.max(0, Math.cos(TAU * (u * 6 + t * 1.7))), 6);
        r = lerp(lerp(50, 150, m), 255, ch); g = lerp(lerp(80, 40, m), 205, ch); b = lerp(255, 50, ch); i = 0.58 + 0.8 * ch; break;
      }
      default: r = 30; g = 40; b = 70; i = 0.06;
    }
    o[0] = r; o[1] = g; o[2] = b; o[3] = i;
  }
  const WISP = {
    normal: { c: [150, 225, 255], spd: 0.07, mode: "rise", n: 1 },
    reach: { c: [255, 150, 110], spd: 0.13, mode: "rise", n: 1 },
    hot: { c: [255, 225, 120], spd: 0.22, mode: "rise", n: 1.4 },
    rainbow: { c: [255, 255, 255], spd: 0.16, mode: "cw", n: 1.2 },
    bonus: { c: [255, 240, 190], spd: 0.24, mode: "cw", n: 1.2 },
    rush: { c: [255, 215, 110], spd: 0.3, mode: "cw", n: 1.3 },
    off: { c: [80, 100, 140], spd: 0.03, mode: "rise", n: 0.2 },
  };
  const _a = [0, 0, 0, 0], _b = [0, 0, 0, 0];
  // Current light colour at u (with theme crossfade and flash). Writes into o.
  function lightAt(u, o) {
    const t = S.time;
    let k = (t - S.themeT0) / THEME_FADE;
    themeAt(S.theme, u, t, _a);
    if (k < 1) {
      k = smooth(clamp(k, 0, 1));
      themeAt(S.prevTheme, u, t, _b);
      for (let j = 0; j < 4; j++) _a[j] = lerp(_b[j], _a[j], k);
    }
    if (S.flashAmt > 0.002) {
      const f = S.flashAmt;
      for (let j = 0; j < 3; j++) _a[j] = lerp(_a[j], S.flashCol[j], f * 0.85);
      _a[3] += f * 1.3;
    }
    o[0] = _a[0]; o[1] = _a[1]; o[2] = _a[2]; o[3] = _a[3];
    return o;
  }

  // Glow sprite cache keyed by quantised colour.
  const spriteCache = new Map();
  function sprite(r, g, b) {
    const R = clamp(r | 0, 0, 255) >> 3, Gq = clamp(g | 0, 0, 255) >> 3, B = clamp(b | 0, 0, 255) >> 3;
    const key = (R << 10) | (Gq << 5) | B;
    let c = spriteCache.get(key);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    const cr = R * 8 + 4, cg = Gq * 8 + 4, cb = B * 8 + 4;
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${cr},${cg},${cb},1)`);
    gr.addColorStop(0.2, `rgba(${cr},${cg},${cb},.8)`);
    gr.addColorStop(0.5, `rgba(${cr},${cg},${cb},.28)`);
    gr.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    if (spriteCache.size > 700) spriteCache.delete(spriteCache.keys().next().value);
    spriteCache.set(key, c);
    return c;
  }
  const rgb = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
  const whiten = (c, f, o) => { o[0] = lerp(c[0], 255, f); o[1] = lerp(c[1], 255, f); o[2] = lerp(c[2], 255, f); return o; };

  // ---------------------------------------------------------------- canvas setup
  function measure() {
    const f = S.field;
    const rect = f.getBoundingClientRect();
    const disp = rect.width > 0 ? rect.width / L.stage.w : 1;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const k = clamp(disp * dpr, 0.5, 2);
    if (Math.abs(k - S.k) / S.k > 0.08 || !S.cw) {
      S.k = k;
      S.cw = Math.round(L.stage.w * k);
      S.ch = Math.round(L.stage.h * k);
      f.width = S.cw;
      f.height = S.ch;
      buildLayers();
    }
  }
  function mkLayer() {
    const c = document.createElement("canvas");
    c.width = S.cw; c.height = S.ch;
    const x = c.getContext("2d");
    x.setTransform(S.k, 0, 0, S.k, 0, 0);
    return [c, x];
  }
  function buildLayers() {
    // Pins.
    const [pc, px] = mkLayer();
    const pinG = px.createRadialGradient(-0.8, -0.9, 0.2, 0, 0, PR);
    pinG.addColorStop(0, "#fffbe0"); pinG.addColorStop(0.35, "#ffd860"); pinG.addColorStop(0.75, "#c08a1c"); pinG.addColorStop(1, "#6a4206");
    PINS.all.forEach((p) => {
      px.save();
      px.translate(p.x, p.y);
      px.fillStyle = "rgba(0,0,0,.55)";
      px.beginPath(); px.ellipse(1.3, 1.9, PR * 1.05, PR * 0.9, 0, 0, TAU); px.fill();
      px.fillStyle = pinG;
      px.beginPath(); px.arc(0, 0, PR, 0, TAU); px.fill();
      px.fillStyle = "rgba(255,255,255,.95)";
      px.beginPath(); px.arc(-0.75, -0.85, 0.6, 0, TAU); px.fill();
      px.restore();
    });
    S.pins = pc;
    // Static parts drawn in front of the balls (heso plate, attacker frame, denchu body).
    const [oc, ox] = mkLayer();
    drawHesoFront(ox);
    drawAttackerFrame(ox);
    drawDenchuBody(ox);
    S.over = oc;
    // Ball sprites.
    const bs = Math.ceil((BR * 2 + 4) * S.k);
    const ball = document.createElement("canvas");
    ball.width = ball.height = bs;
    const bx = ball.getContext("2d");
    bx.setTransform(S.k, 0, 0, S.k, bs / 2, bs / 2);
    let g = bx.createRadialGradient(-1.7, -2, 0.3, 0, 0, BR);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.28, "#e9eef5"); g.addColorStop(0.62, "#9aa4b2"); g.addColorStop(0.88, "#4c535e"); g.addColorStop(1, "#2a2f36");
    bx.fillStyle = g; bx.beginPath(); bx.arc(0, 0, BR, 0, TAU); bx.fill();
    g = bx.createLinearGradient(0, BR * 0.2, 0, BR);
    g.addColorStop(0, "rgba(160,190,255,0)"); g.addColorStop(1, "rgba(170,200,255,.45)");
    bx.fillStyle = g; bx.beginPath(); bx.arc(0, 0, BR * 0.92, 0.15 * Math.PI, 0.85 * Math.PI); bx.fill();
    bx.fillStyle = "rgba(255,255,255,.95)"; bx.beginPath(); bx.ellipse(-1.8, -2.1, 1.25, 0.9, -0.6, 0, TAU); bx.fill();
    S.ball = ball;
    const sh = document.createElement("canvas");
    sh.width = sh.height = bs;
    const sx = sh.getContext("2d");
    const sg = sx.createRadialGradient(bs / 2, bs / 2, 0, bs / 2, bs / 2, bs / 2);
    sg.addColorStop(0, "rgba(0,0,0,.6)"); sg.addColorStop(0.55, "rgba(0,0,0,.3)"); sg.addColorStop(1, "rgba(0,0,0,0)");
    sx.fillStyle = sg; sx.fillRect(0, 0, bs, bs);
    S.shadow = sh;
    S.ballPx = bs / S.k;
    // Energy swirl: two streak textures (cross-faded each frame) and a layer to tint them in.
    S.swirl = [swirlTex(11), swirlTex(23)];
    S.swirlLayer = swirlCanvas();
  }

  function swirlCanvas() {
    const k = S.k * SWIRL.res, c = document.createElement("canvas");
    c.width = Math.round(L.stage.w * k); c.height = Math.round(L.stage.h * k);
    return c;
  }
  // White streaks swirling around the window, inside the band: long arcs that drift in and out
  // as they travel, flame tongues leaning outward, and a soft base glow.
  function swirlTex(seed) {
    let st = seed >>> 0;
    const R = () => { st = (st + 0x6d2b79f5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const c = swirlCanvas(), x = c.getContext("2d"), k = S.k * SWIRL.res;
    x.setTransform(k, 0, 0, k, 0, 0);
    x.save();
    x.clip(S.aboveConsole);
    x.clip(S.swirlBand, "evenodd");
    x.fillStyle = "rgba(255,255,255,0.1)";
    x.fill(S.swirlBand, "evenodd");
    x.lineCap = "round";
    x.shadowColor = "rgba(255,255,255,0.9)";
    const span = SWIRL.s1 - SWIRL.inner;
    for (let i = 0; i < 380; i++) {
      const a0 = R() * 360, len = 14 + R() * 60, dir = R() < 0.5 ? -1 : 1;
      const s0 = SWIRL.inner + R() * span, drift = (R() * 2 - 1) * span * 0.3, wob = R() * TAU;
      const w = 0.6 + R() * R() * 5, al = 0.25 + R() * 0.65, n = 18, core = R() < 0.45;
      for (let pass = 0; pass < (core ? 2 : 1); pass++) {   // glow, then a bright thin core
        x.shadowBlur = pass ? 0 : w * 1.6 * k;
        for (let j = 0; j < n; j++) {   // tapered: thick in the middle, thin at both ends
          const f0 = j / n, f1 = (j + 1) / n, taper = Math.sin(Math.PI * (f0 + 0.5 / n));
          const p0 = fpt(a0 + dir * len * f0, s0 + drift * f0 + 2.5 * Math.sin(wob + f0 * 7));
          const p1 = fpt(a0 + dir * len * f1, s0 + drift * f1 + 2.5 * Math.sin(wob + f1 * 7));
          x.strokeStyle = "rgba(255,255,255," + ((pass ? 1 : al) * taper).toFixed(3) + ")";
          x.lineWidth = (pass ? 0.35 : 1) * w * (0.3 + 0.7 * taper);
          x.beginPath(); x.moveTo(p0[0], p0[1]); x.lineTo(p1[0], p1[1]); x.stroke();
        }
      }
    }
    for (let i = 0; i < 90; i++) {   // flame tongues licking in over the board edge, curling outward
      const a = R() * 360, l = span * (0.4 + R() * 0.6), curl = (R() * 2 - 1) * 14, w = 1.5 + R() * 4;
      x.shadowBlur = w * 3 * k;
      x.beginPath();
      for (let j = 0; j <= 12; j++) {
        const f = j / 12, p = fpt(a + curl * f * f, SWIRL.inner + 2 + l * f);
        if (j) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]);
      }
      x.strokeStyle = "rgba(255,255,255," + (0.15 + R() * 0.4).toFixed(3) + ")";
      x.lineWidth = w;
      x.stroke();
    }
    x.restore();
    // Over the glass the light fades out toward the field, and stays off the lower playfield.
    x.save();
    x.globalCompositeOperation = "destination-out";
    x.shadowBlur = 0;
    for (let sIn = SWIRL.inner; sIn < 0; sIn += 2) {
      x.strokeStyle = "rgba(0,0,0," + (Math.pow(-sIn / -SWIRL.inner, 1.3) * 0.8).toFixed(3) + ")";
      x.lineWidth = 2.4;
      x.stroke(new Path2D(loopPath(sIn, 4)));
    }
    x.clip(new Path2D(loopPath(0, 3)));
    const fy = x.createLinearGradient(0, SWIRL.fadeY0, 0, SWIRL.fadeY1);
    fy.addColorStop(0, "rgba(0,0,0,0)"); fy.addColorStop(1, "rgba(0,0,0,1)");
    x.fillStyle = fy;
    x.fillRect(0, SWIRL.fadeY0, L.stage.w, L.stage.h - SWIRL.fadeY0);
    x.restore();
    return c;
  }
  // Tint the swirl with the theme light around the frame (conic gradient over u) and add it.
  const SWIRL_STOPS = 24;
  function drawSwirl(x) {
    if (!S.swirl) return;
    const c = S.swirlLayer, l = c.getContext("2d"), t = S.time;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = "source-over";
    l.clearRect(0, 0, c.width, c.height);
    const ph = S.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * 0.9);
    l.globalAlpha = 0.5 + 0.5 * ph;
    l.drawImage(S.swirl[0], 0, 0);
    l.globalAlpha = 1 - 0.5 * ph;
    if (S.reduced) l.drawImage(S.swirl[1], 0, 0);
    else {   // the second texture sways a little around the window centre: the light seems to flow
      const k = S.k * SWIRL.res, cx = L.win.cx * k, cy = L.win.cy * k, rot = 0.018 * Math.sin(t * 0.55);
      l.translate(cx, cy); l.rotate(rot); l.translate(-cx, -cy);
      l.drawImage(S.swirl[1], 0, 0);
      l.setTransform(1, 0, 0, 1, 0, 0);
    }
    l.globalAlpha = 1;
    l.globalCompositeOperation = "source-in";
    if (l.createConicGradient) {
      const k = S.k * SWIRL.res, g = l.createConicGradient(-Math.PI / 2, L.win.cx * k, L.win.cy * k);
      for (let i = 0; i <= SWIRL_STOPS; i++) {
        const u = i / SWIRL_STOPS;
        lightAt(u % 1, _c);
        g.addColorStop(u, rgb(_c, clamp(_c[3] * 0.95, 0, 1)));
      }
      l.fillStyle = g;
    } else {
      lightAt(0, _c);
      l.fillStyle = rgb(_c, clamp(_c[3] * 0.95, 0, 1));
    }
    l.fillRect(0, 0, c.width, c.height);
    x.drawImage(c, 0, 0, c.width, c.height, 0, 0, L.stage.w, L.stage.h);
  }

  function drawHesoFront(x) {
    x.save();
    const g = x.createLinearGradient(0, 540, 0, 563);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.25, "#aab3bf"); g.addColorStop(0.5, "#eef2f7"); g.addColorStop(0.8, "#59616c"); g.addColorStop(1, "#d6dce4");
    // side fins
    x.fillStyle = "#c0c8d2"; x.strokeStyle = "#20242a"; x.lineWidth = 1;
    x.beginPath(); x.moveTo(279, 543); x.lineTo(260, 549); x.lineTo(271, 557); x.closePath(); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(309, 543); x.lineTo(328, 549); x.lineTo(317, 557); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(278.5, 541.5); x.lineTo(309.5, 541.5);
    x.bezierCurveTo(311, 548, 313, 555, 318, 562); x.lineTo(270, 562);
    x.bezierCurveTo(275, 555, 277, 548, 278.5, 541.5); x.closePath();
    x.fill(); x.lineWidth = 1.2; x.strokeStyle = "#15181c"; x.stroke();
    // rim
    x.strokeStyle = "#f6f9fc"; x.lineWidth = 1.6;
    x.beginPath(); x.ellipse(294, 541.5, 15.5, 3.6, 0, 0.05 * Math.PI, 0.95 * Math.PI); x.stroke();
    // plate + gem
    x.fillStyle = "#2a0606"; x.beginPath(); x.ellipse(294, 553, 9, 5.4, 0, 0, TAU); x.fill();
    const rg = x.createRadialGradient(292.5, 551.5, 0.3, 294, 553, 5);
    rg.addColorStop(0, "#fff0e0"); rg.addColorStop(0.3, "#ff4a2a"); rg.addColorStop(1, "#6a0400");
    x.fillStyle = rg; x.beginPath(); x.ellipse(294, 553, 6.4, 4.2, 0, 0, TAU); x.fill();
    x.restore();
  }
  function drawAttackerFrame(x) {
    x.save();
    const g = x.createLinearGradient(0, 597, 0, 627);
    g.addColorStop(0, "#f4f7fb"); g.addColorStop(0.4, "#6c7480"); g.addColorStop(0.6, "#dfe5ec"); g.addColorStop(1, "#3e444d");
    x.strokeStyle = g; x.lineWidth = 4;
    x.beginPath(); x.rect(376, 599, 112, 26); x.stroke();
    x.strokeStyle = "#000"; x.lineWidth = 1; x.strokeRect(373.5, 596.5, 117, 31);
    x.restore();
  }
  function drawDenchuBody(x) {
    x.save();
    const g = x.createLinearGradient(515, 0, 541, 0);
    g.addColorStop(0, "#5a0a06"); g.addColorStop(0.3, "#ff4a30"); g.addColorStop(0.55, "#ffb0a0"); g.addColorStop(0.8, "#c01a10"); g.addColorStop(1, "#4a0604");
    x.fillStyle = g; x.strokeStyle = "#1a0202"; x.lineWidth = 1.2;
    x.beginPath(); x.moveTo(515, 464); x.lineTo(541, 464); x.lineTo(539, 476); x.quadraticCurveTo(528, 484, 517, 476); x.closePath(); x.fill(); x.stroke();
    const c = x.createLinearGradient(0, 462, 0, 467);
    c.addColorStop(0, "#fff"); c.addColorStop(1, "#7a828e");
    x.fillStyle = c; x.fillRect(513, 462, 30, 3.4);
    x.restore();
  }

  // ---------------------------------------------------------------- ball paths
  function PB(x, y) { this.segs = []; this.x = x; this.y = y; this.T = 0; this.vy = 0; }
  PB.prototype.push = function (d, f, extra) {
    const s = { t0: this.T, d: Math.max(0.001, d), f, tag: this.tag };
    if (extra) Object.assign(s, extra);
    this.segs.push(s);
    this.T += s.d;
    const e = f(1);
    this.x = e[0]; this.y = e[1];
    return s;
  };
  PB.prototype.rail = function (a0, a1, d, ease) {
    return this.push(d, (t) => railPt(lerp(a0, a1, ease(t))), { ghost: 1, rail: 1 });
  };
  // Projectile from the current point to (x1,y1) with initial vertical velocity vy0 (negative = up).
  PB.prototype.hop = function (x1, y1, vy0) {
    const x0 = this.x, y0 = this.y, dy = y1 - y0;
    let v = vy0 == null ? 0 : vy0;
    if (dy < 0) v = Math.min(v, -Math.sqrt(2 * G * (-dy + 0.6)));
    const disc = v * v + 2 * G * dy;
    const T = (-v + Math.sqrt(Math.max(0, disc))) / G;
    this.vy = v + G * T;
    return this.push(T, (t) => { const tt = t * T; return [x0 + (x1 - x0) * t, y0 + v * tt + 0.5 * G * tt * tt]; });
  };
  // Roll along a polyline, speed v0 -> v1, optional bump amplitude (pin road).
  PB.prototype.roll = function (pts, v0, v1, bump, spacing) {
    pts = [[this.x, this.y]].concat(pts);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const Lt = cum[cum.length - 1] || 0.001, avg = (v0 + v1) / 2, d = Lt / avg;
    this.vy = 0;
    return this.push(d, (t) => {
      const s = (Lt * (v0 * t + 0.5 * (v1 - v0) * t * t)) / avg;
      let j = 1;
      while (j < cum.length - 1 && cum[j] < s) j++;
      const f = (s - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
      let x = lerp(pts[j - 1][0], pts[j][0], f), y = lerp(pts[j - 1][1], pts[j][1], f);
      if (bump) { const ph = Math.sin((Math.PI * s) / spacing); y += bump * ph * ph; }
      return [x, y];
    });
  };
  PB.prototype.wait = function (d) { const x = this.x, y = this.y; return this.push(d, () => [x, y]); };
  PB.prototype.line = function (x1, y1, d, extra) {
    const x0 = this.x, y0 = this.y;
    return this.push(d, (t) => [lerp(x0, x1, t), lerp(y0, y1, t)], extra);
  };
  PB.prototype.enter = function (x, y, kind) {
    const x0 = this.x, y0 = this.y;
    return this.push(0.14, (t) => [lerp(x0, x, Math.min(1, t * 2)), lerp(y0, y, Math.min(1, t * 2)) + 6 * t],
      { arrive: kind, alpha: (t) => 1 - t, scale: (t) => 1 - 0.35 * t });
  };
  const easeRail = (t) => 1.32 * t - 0.32 * t * t;

  // Bounce down through a pin field.
  // Smallest ball-centre to pin-centre distance along a projectile hop (same maths as PB.hop).
  function hopClearance(x0, y0, x1, y1, v) {
    const dy = y1 - y0;
    if (dy < 0) v = Math.min(v, -Math.sqrt(2 * G * (-dy + 0.6)));
    const T = (-v + Math.sqrt(Math.max(0, v * v + 2 * G * dy))) / G;
    const minX = Math.min(x0, x1) - 10, maxX = Math.max(x0, x1) + 10;
    const minY = Math.min(y0, y1) - 12, maxY = Math.max(y0, y1) + 10;
    let m = 99;
    const all = PINS.all;
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
      for (let k = 1; k < 12; k++) {
        const f = k / 12, t = f * T;
        const d = Math.hypot(x0 + (x1 - x0) * f - p.x, y0 + v * t + 0.5 * G * t * t - p.y);
        if (d < m) m = d;
      }
    }
    return m;
  }
  // Hop to (x1,y1), raising the arc until the flight clears the pins (best effort).
  function hopSafe(pb, x1, y1, vy0) {
    let best = vy0, bc = -1;
    for (const v of [vy0, vy0 - 50, vy0 - 100, vy0 - 160, vy0 + 40]) {
      const c = hopClearance(pb.x, pb.y, x1, y1, v);
      if (c > bc) { bc = c; best = v; }
      if (c >= CD - 1.4) break;
    }
    return pb.hop(x1, y1, best);
  }

  // The ball hits a pin slightly off-centre, rebounds up and away on that side, and lands on a
  // pin of a lower row on that side (or skips one row). Bias steers the side choice.
  function walk(pb, pins, o) {
    let cur = null, side = 0, steps = 0;
    const pickSide = (p) => {
      let pr = 0.5;
      if (o.biasX != null && Math.abs(o.biasX - p.x) > 2) pr += (o.biasX > p.x ? 1 : -1) * o.bias;
      return rnd() < pr ? 1 : -1;
    };
    const below = (p, s) => {
      const out = [];
      for (let i = 0; i < pins.length; i++) {
        const q = pins[i], dy = q.y - p.y, dx = (q.x - p.x) * s;
        if (dy >= 8 && dy <= 31 && dx >= 6.5 && dx <= 21 && q.y <= o.yEnd) out.push(q);
      }
      return out;
    };
    pb.tag = "walk";
    while (steps++ < 40) {
      let cands;
      if (!cur) {
        cands = pins.filter((p) => p.y - pb.y >= 5 && p.y - pb.y <= 50 && Math.abs(p.x - pb.x) <= 6.2 && p.y <= o.yEnd);
        cands.sort((a, b) => a.y - b.y);
        cands = cands.slice(0, 1);
      } else {
        cands = below(cur, side).concat(below(cur, -side));
      }
      if (!cands.length) break;
      // Generate-and-test: pick a landing pin and contact offset whose flight clears every pin.
      let best = null;
      for (let tries = 0; tries < 14; tries++) {
        let tot = 0;
        const ws = cands.map((q) => {
          let w = q.y - (cur ? cur.y : pb.y) > 20 ? 0.7 : 1;
          if (cur && Math.sign(q.x - cur.x) !== side) w *= 0.12; // rebounds go to the side that was hit
          tot += w;
          return w;
        });
        let r = rnd() * tot, q = cands[0];
        for (let i = 0; i < cands.length; i++) { r -= ws[i]; if (r <= 0) { q = cands[i]; break; } }
        const ns = pickSide(q);
        const ox = ns * rr(0.6, 3.8);
        const vy0 = cur ? -rr(55, 135) : Math.max(pb.vy * 0.3, -40);
        const x1 = q.x + ox, y1 = q.y - Math.sqrt(CD * CD - ox * ox);
        const clr = hopClearance(pb.x, pb.y, x1, y1, vy0);
        if (!best || clr > best.clr) best = { q, ns, x1, y1, vy0, clr };
        if (clr >= CD - 1.4) break;
      }
      if (best.clr < CD - 2.6) break; // nothing clean: leave the lane walk here
      const hop = pb.hop(best.x1, best.y1, best.vy0);
      if (cur) hop.pin = 1;   // this hop starts with the ball bouncing off a pin
      if (o.onPin) o.onPin(best.q, pb.segs[pb.segs.length - 1]);
      cur = best.q;
      side = best.ns;
    }
    pb.tag = "post";
    if (cur) pb.side = side;
    return cur;
  }

  function wmHit(seg) { const prev = seg.cb; seg.cb = () => { if (prev) prev(); S.wmW += rr(9, 16) * (rnd() < 0.5 ? -1 : 1); }; }

  function buildPath(target, side) {
    if (target === "heso") side = "left";
    else if (target === "denchu" || target === "attacker") side = "right";
    else side = side === "right" ? "right" : "left";
    const st = railPt(L.rail.start);
    const pb = new PB(st[0], st[1]);
    if (side === "left") pathLeft(pb, target); else pathRight(pb, target);
    return pb;
  }

  function pathLeft(pb, target) {
    const isHeso = target === "heso";
    if (!isHeso && rnd() < 0.12) return pathFoul(pb);
    const warp = rnd() < (isHeso ? 0.32 : 0.14);
    pb.rail(L.rail.start, L.rail.releaseLeft + rr(-4, 1), rr(0.25, 0.3), easeRail);
    pb.vy = 120;
    const onPin = (p, seg) => { if (Math.hypot(p.x - WM.x, p.y - WM.y) < 24) wmHit(seg); };
    if (warp) {
      walk(pb, PINS.L, { yEnd: 338, biasX: 70, bias: 0.25, onPin });
      pb.hop(WARP.x + 1, WARP.y - 3, -110);
      pb.push(0.08, ((x, y) => (t) => [x, y + 3 * t])(pb.x, pb.y), { alpha: (t) => 1 - t, cb: () => { S.glow.warp = 1; } });
      // inside the translucent tube
      const tubeP = spline([[WARP.x + 2, WARP.y + 6], [97, 400], [100, 440], [110, 464], [132, 480]], 6);
      pb.roll(tubeP, 260, 520, 0, 1).alpha = () => 0.38;
      pathStage(pb, isHeso);
      return;
    }
    const last = walk(pb, PINS.L, { yEnd: 470, biasX: isHeso ? 84 : null, bias: 0.15, onPin });
    // Fall onto the road.
    const road = PINS.road;
    let i0 = 0;
    while (i0 < road.length - 1 && road[i0].x < pb.x + 5) i0++;
    i0 = Math.min(i0, 2);
    pb.hop(road[i0].x + 1, road[i0].y - CD, pb.side > 0 ? -60 : -110);
    // Roll along the road tops.
    const falloff = !isHeso && rnd() < 0.35 ? Math.floor(rr(3, 6.5)) : -1;
    const iEnd = falloff > 0 ? Math.max(i0 + 2, falloff) : road.length - 1;
    const pts = [];
    for (let i = i0 + 1; i <= iEnd; i++) pts.push([road[i].x, road[i].y - CD]);
    if (pts.length) pb.roll(pts, rr(150, 200), rr(300, 360), 2.4, 21);
    if (falloff > 0) {
      // Drop through a gap under the road, then roll to the centre out.
      pb.hop(pb.x + rr(5, 9), 633, -40);
      pb.roll([[288, 637]], 220, 320, 0, 1);
      pb.enter(294, 641, "out");
      return;
    }
    hesoApproach(pb, isHeso);
  }

  // From the end of the road: 寄り釘 -> 命釘 -> heso or miss.
  function hesoApproach(pb, isHeso) {
    const y1 = PINS.yori[0], y2 = PINS.yori[1];
    pb.hop(y1.x - 1, y1.y - CD, -70);
    pb.hop(y2.x + 1.5, y2.y - 7.1, -80);
    if (isHeso) {
      pb.hop(294 + rr(-1.5, 1.5), 527, -110);
      pb.hop(294, 538.5, pb.vy * 0.3);
      pb.enter(294, 545, "heso");
      return;
    }
    missInochi(pb, rnd() < 0.5 ? -1 : 1);
  }
  function missInochi(pb, dir) {
    const m = dir < 0 ? PINS.inochi[0] : PINS.inochi[1];
    const ox = dir * rr(2.2, 3.6);
    pb.hop(m.x + ox, m.y - Math.sqrt(CD * CD - ox * ox), -100);
    pb.hop(294 + dir * 29, 552, -90);
    const h = dir < 0 ? PINS.hakama[2] : PINS.hakama[3];
    pb.hop(h.x + dir * -4.5, h.y - 5.6, pb.vy * 0.1);
    pb.hop(294 + dir * 5, 633, -60);
    pb.enter(294, 641, "out");
  }

  // Warp exit: roll on the stage ledge (damped swing), then drop.
  function pathStage(pb, isHeso) {
    const x0 = 132, A = 294 - x0, w = TAU / 0.74, gam = 1.25;
    const crossings = [0.185, 0.555, 0.925];
    const dropK = isHeso ? (rnd() < 0.45 ? 1 : 2) : rnd() < 0.6 ? 0 : 1;
    const tEnd = crossings[dropK];
    pb.push(tEnd, (t) => {
      const tt = t * tEnd, x = 294 - A * Math.exp(-gam * tt) * Math.cos(w * tt);
      return [x, stageY(x) - BR - 1];
    }, { cb: () => { S.glow.stage = 1; } });
    pb.vy = 40;
    if (isHeso) {
      pb.hop(294, 538.5, 30);
      pb.enter(294, 545, "heso");
    } else {
      const dir = rnd() < 0.5 ? -1 : 1;
      pb.hop(294 + dir * 6, 512, 20);
      missInochi(pb, dir);
    }
  }

  // Weak shot: climbs part way, rolls back and drops into the foul (left) out.
  function pathFoul(pb) {
    const top = rr(186, 204);
    pb.rail(L.rail.start, top, rr(0.42, 0.5), (t) => 1 - Math.pow(1 - t, 2.2));
    pb.wait(0.06);
    pb.rail(top, 137, rr(0.42, 0.5), (t) => t * t);
    const o = L.outs[1];
    pb.hop(o.x - 1, o.y - 7, 40);
    pb.enter(o.x, o.y, "out");
  }

  function pathRight(pb, target) {
    pb.rail(L.rail.start, L.rail.releaseRight + rr(-2, 3), rr(0.44, 0.52), easeRail);
    pb.vy = 160;
    const edge = target === "out" && rnd() < 0.4;
    const biasX = target === "denchu" ? 528 : edge ? 552 : 500;
    walk(pb, PINS.R, { yEnd: 437, biasX, bias: 0.32 });
    if (target === "denchu") {
      pb.hop(528 + rr(-1.5, 1.5), 452, -90);
      pb.hop(528, 459, pb.vy * 0.4);
      pb.enter(528, 466, "denchu");
      return;
    }
    if (edge) {
      pb.hop(549, 470, -115);
      pb.hop(548, 520, pb.vy * 0.3);
      pb.line(543, 566, 0.12);
      const o = L.outs[2];
      pb.line(o.x + 6, o.y - 8, 0.1);
      pb.enter(o.x, o.y, "out");
      return;
    }
    // Pass the 電チュー on the left, fall onto the slope.
    pb.hop(Math.max(503, pb.x - 11), pb.y + 14, pb.side < 0 ? -70 : -120);
    pb.hop(504, 476, pb.vy * 0.2);
    const ax = SLOPE.ax, ay = SLOPE.ay, bx = SLOPE.bx, by = SLOPE.by;
    const len = Math.hypot(bx - ax, by - ay), dx = (bx - ax) / len, dy = (by - ay) / len;
    const nx = dy, ny = -dx; // normal pointing up-left
    const off = BR + 2;
    const sAt = clamp((ax + nx * off - 503) / (ax - bx), 0, 1);
    const p1 = [ax + (bx - ax) * sAt + nx * off, ay + (by - ay) * sAt + ny * off];
    const p2 = [bx + nx * off, by + ny * off];
    pb.hop(p1[0], p1[1], pb.vy * 0.2);
    pb.roll([p2], 180, 300, 0, 1);
    if (target === "attacker") {
      pb.hop(rr(446, 468), 609, -50);
      pb.enter(pb.x - 2, 616, "attacker");
      return;
    }
    // Over the closed door, off its left end, to the centre out.
    pb.hop(474, 597.5, -30);
    pb.roll([[384, 597.5]], 260, 330, 0, 1);
    pb.hop(364, 630, -50);
    pb.roll([[302, 638]], 230, 300, 0, 1);
    pb.enter(294, 641, "out");
  }

  // ---------------------------------------------------------------- update
  function update(dt) {
    S.time += dt;
    S.flashAmt *= Math.exp(-dt / 0.12);
    const ka = dt / (S.attOpen ? 0.16 : 0.2), kd = dt / 0.1;
    S.attK = clamp(S.attK + (S.attOpen ? ka : -ka), 0, 1);
    S.denK = clamp(S.denK + (S.denOpen ? kd : -kd), 0, 1);
    S.wmA += S.wmW * dt;
    S.wmW *= Math.exp(-dt / 0.9);
    for (const k in S.glow) S.glow[k] *= Math.exp(-dt / 0.18);
    // Wisps.
    const wc = WISP[S.theme] || WISP.normal;
    const want = Math.round((S.reduced ? 8 : 22) * wc.n);
    while (S.wisps.length < want) S.wisps.push({ p: rnd(), side: rnd() < 0.5 ? -1 : 1, v: rr(0.7, 1.4), size: rr(0.7, 1.3) });
    if (S.wisps.length > want) S.wisps.length = want;
    const sp = wc.spd * (S.reduced ? 0.5 : 1);
    S.wisps.forEach((w) => { w.p += dt * sp * w.v; if (w.p >= 1) { w.p -= 1; w.side = rnd() < 0.5 ? -1 : 1; } });
    // Balls.
    for (let i = S.balls.length - 1; i >= 0; i--) {
      const b = S.balls[i];
      b.t += dt * b.rate;
      while (b.idx < b.segs.length && b.t >= b.segs[b.idx].t0) {
        const s = b.segs[b.idx];
        if (!s.fired) {
          s.fired = true;
          if (s.pin && S.onPin) { try { S.onPin(); } catch (e) { /* a sound must never stop the balls */ } }
          if (s.cb) s.cb();
          if (s.arrive) arrive(b, s.arrive);
        }
        if (b.t < s.t0 + s.d || b.idx === b.segs.length - 1) break;
        b.idx++;
      }
      if (b.t >= b.total) {
        if (!b.arrived) arrive(b, "out");
        S.balls.splice(i, 1);
      }
    }
  }
  function arrive(b, kind) {
    if (b.arrived) return;
    b.arrived = true;
    if (S.glow[kind] != null) S.glow[kind] = 1;
    const fn = b.onArrive;
    b.onArrive = null;
    if (typeof fn === "function") {
      try { fn(); } catch (e) { setTimeout(() => { throw e; }); }
    }
  }
  function ballPos(b) {
    let s = b.segs[Math.min(b.idx, b.segs.length - 1)];
    const t = clamp((b.t - s.t0) / s.d, 0, 1);
    const p = s.f(t);
    return { x: p[0], y: p[1], a: s.alpha ? s.alpha(t) : 1, sc: s.scale ? s.scale(t) : 1, ghost: s.ghost };
  }

  // ---------------------------------------------------------------- render
  const _c = [0, 0, 0, 0], _w = [0, 0, 0];
  function render() {
    const x = S.ctx;
    if (!x) return;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = "source-over";
    x.globalAlpha = 1;
    x.clearRect(0, 0, S.cw, S.ch);
    x.setTransform(S.k, 0, 0, S.k, 0, 0);
    const t = S.time;

    // Board light spill: inner rim glow + LCD halo.
    lightAt(0.25 + 0.5 * Math.sin(t * 0.2), _c);
    const ia = clamp(_c[3], 0, 1.4);
    x.save();
    x.clip(S.winPath);
    x.globalCompositeOperation = "lighter";
    x.strokeStyle = rgb(_c, 0.2 * ia);
    x.lineWidth = 34;
    x.stroke(S.winPath);
    x.strokeStyle = rgb(_c, 0.22 * ia);
    x.lineWidth = 12;
    x.stroke(S.winPath);
    x.strokeStyle = rgb(_c, 0.2 * ia);
    x.lineWidth = 30;
    x.stroke(S.lcdPath);
    if (S.flashAmt > 0.01) {
      x.fillStyle = rgb(S.flashCol, 0.32 * S.flashAmt);
      x.fill(S.winPath);
    }
    x.restore();

    // Pins.
    x.drawImage(S.pins, 0, 0, S.cw, S.ch, 0, 0, L.stage.w, L.stage.h);
    drawWindmill(x);

    // Balls: shadows, ghosts, bodies.
    const bp = S.ballPx;
    const list = S.balls.map((b) => { const p = ballPos(b); p.b = b; return p; });
    x.globalAlpha = 1;
    list.forEach((p) => {
      if (p.a <= 0.01) return;
      x.globalAlpha = 0.85 * p.a;
      const s = bp * 1.25 * p.sc;
      x.drawImage(S.shadow, p.x + 1.8 - s / 2, p.y + 2.6 - s / 2, s, s);
    });
    list.forEach((p) => {
      const b = p.b;
      if (p.ghost && b.trail.length) {
        for (let j = 0; j < b.trail.length; j++) {
          const q = b.trail[j];
          x.globalAlpha = 0.28 * (1 - j / b.trail.length) * p.a;
          x.drawImage(S.ball, q[0] - bp / 2, q[1] - bp / 2, bp, bp);
        }
      }
      if (p.a > 0.01) {
        x.globalAlpha = p.a;
        const s = bp * p.sc;
        x.drawImage(S.ball, p.x - s / 2, p.y - s / 2, s, s);
      }
      b.trail.unshift([p.x, p.y]);
      if (b.trail.length > 3) b.trail.length = 3;
    });
    x.globalAlpha = 1;

    // Pocket fronts.
    x.drawImage(S.over, 0, 0, S.cw, S.ch, 0, 0, L.stage.w, L.stage.h);
    drawDenchuWings(x);
    drawAttackerDoor(x);
    drawPocketGlows(x);

    // Frame lights (behind the acrylic).
    x.globalCompositeOperation = "lighter";
    drawSwirl(x);
    drawFills(x);
    drawStrokes(x);
    drawWisps(x);
    drawSprites(x);
    x.globalCompositeOperation = "source-over";
  }

  // Even backlight under each acrylic area.
  function prepFills() {
    ART.fills.forEach((f) => {
      f.p = new Path2D(f.d);
      if (f.u == null) {
        const m = f.d.match(/M\s*(-?[\d.]+)[ ,](-?[\d.]+)/);
        let px = m ? parseFloat(m[1]) : 294, py = m ? parseFloat(m[2]) : 380;
        if (f.tr) { px = f.tr.x + px * f.tr.s; py = f.tr.y + py * f.tr.s; }
        f.u = angU(px, py);
      }
    });
  }
  function drawFills(x) {
    const t = S.time;
    const pulse = 0.8 + 0.2 * Math.sin(TAU * t * (S.theme === "normal" || S.theme === "off" ? 0.7 : 1.8));
    ART.fills.forEach((f) => {
      lightAt(f.u, _c);
      let it = _c[3] * f.g;
      let col = _c;
      if (f.pulse) it *= pulse;
      if (f.eye) { col = whiten(_c, 0.45, _w); it = Math.max(it, 0.85); }
      if (f.mouth) { col = lerp3(_c, [255, 110, 30], 0.55); it *= 0.75 + 0.25 * Math.sin(t * 7.3); }
      x.fillStyle = rgb(col, clamp(it, 0, 1));
      if (f.tr) {
        x.save();
        x.translate(f.tr.x, f.tr.y);
        x.scale(f.tr.s, f.tr.s);
        x.fill(f.p, f.rule || "nonzero");
        x.restore();
      } else x.fill(f.p, f.rule || "nonzero");
    });
  }

  function drawStrokes(x) {
    x.lineCap = "round";
    ART.strokes.forEach((st) => {
      const pts = st.pts, n = pts.length, segs = st.closed ? n : n - 1;
      if (!st.cols) { st.cols = new Array(n); for (let i = 0; i < n; i++) st.cols[i] = [0, 0, 0, 0]; }
      for (let i = 0; i < n; i++) lightAt(pts[i][2], st.cols[i]);
      for (let pass = 0; pass < 3; pass++) {
        x.lineWidth = st.w[pass];
        let lastKey = "", open = false;
        for (let i = 0; i < segs; i++) {
          const a = pts[i], b = pts[(i + 1) % n], c = st.cols[i];
          const it = clamp(c[3] * st.gain, 0, 1.6);
          let col, al;
          if (pass === 0) { col = c; al = 0.45 * Math.min(1, it); }
          else if (pass === 1) { col = whiten(c, 0.18 + 0.2 * Math.max(0, it - 1), _w); al = 0.8 * Math.min(1, it); }
          else { col = whiten(c, 0.65, _w); al = 0.85 * Math.min(1, it); }
          const key = rgb([col[0] & 0xf8, col[1] & 0xf8, col[2] & 0xf8], Math.round(al * 20) / 20);
          if (key !== lastKey) {
            if (open) x.stroke();
            x.strokeStyle = key;
            x.beginPath();
            x.moveTo(a[0], a[1]);
            lastKey = key;
            open = true;
          }
          x.lineTo(b[0], b[1]);
        }
        if (open) x.stroke();
      }
    });
  }

  function drawWisps(x) {
    const st = ART.strokes[0];
    if (!st) return;
    const pts = st.pts, n = pts.length;
    const wc = WISP[S.theme] || WISP.normal;
    const rise = wc.mode === "rise";
    S.wisps.forEach((w) => {
      let u = rise ? 0.5 + w.side * 0.5 * w.p : w.p;
      u = ((u % 1) + 1) % 1;
      const dir = rise ? -w.side : 1;
      lightAt(u, _c);
      const it = clamp(_c[3], 0, 1.5);
      const col = whiten(lerp3(_c, wc.c, 0.55), 0.25, _w);
      const spr = sprite(col[0], col[1], col[2]);
      const fade = Math.sin(Math.PI * clamp(rise ? w.p : 0.5, 0, 1));
      for (let j = 0; j < 5; j++) {
        const uu = (((u - dir * j * 0.006) % 1) + 1) % 1;
        const fi = uu * n, i0 = Math.floor(fi) % n, i1 = (i0 + 1) % n, f = fi - Math.floor(fi);
        const px = lerp(pts[i0][0], pts[i1][0], f), py = lerp(pts[i0][1], pts[i1][1], f);
        const r = (11 - j * 1.7) * w.size;
        x.globalAlpha = clamp(it * fade * (1 - j * 0.17), 0, 1);
        x.drawImage(spr, px - r, py - r, r * 2, r * 2);
      }
    });
    x.globalAlpha = 1;
  }
  function lerp3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

  function drawSprites(x) {
    const t = S.time;
    const pulse = 0.72 + 0.28 * Math.sin(TAU * t * (S.theme === "normal" || S.theme === "off" ? 0.7 : 1.8));
    ART.sprites.forEach((s, idx) => {
      if (s.fire) {
        // Warm flicker behind the kanji blocks (always fiery, hotter in reach/hot).
        const hot = S.theme === "hot" || S.theme === "reach" || S.theme === "bonus" ? 1.35 : 1;
        const fl = 0.7 + 0.3 * Math.sin(t * (9 + s.fire * 3.7) + idx) * Math.sin(t * (13 + s.fire) + idx * 2);
        const col = s.fire === 1 ? [255, 120, 30] : [255, 70, 10];
        x.globalAlpha = clamp(s.g * fl * hot, 0, 1);
        const r = s.r * (0.94 + 0.08 * fl);
        x.drawImage(sprite(col[0], col[1], col[2]), s.x - r, s.y - r, r * 2, r * 2);
        return;
      }
      if (s.u == null) s.u = angU(s.x, s.y);
      lightAt(s.u, _c);
      let it = _c[3] * s.g;
      if (s.pulse) it *= pulse;
      let col = _c;
      if (s.eye) { col = whiten(_c, 0.35, _w); it = Math.max(it, 0.8) * (0.85 + 0.15 * Math.sin(t * 3)); }
      if (s.mouth) { col = lerp3(_c, [255, 120, 30], 0.5); it *= 0.8 + 0.2 * Math.sin(t * 7.3); }
      x.globalAlpha = clamp(it, 0, 1);
      x.drawImage(sprite(col[0], col[1], col[2]), s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
      if (s.core || it > 1) {
        const w = whiten(_c, 0.7, _w);
        x.globalAlpha = clamp((it - 0.4) * 0.8, 0, 1);
        const r = s.r * 0.5;
        x.drawImage(sprite(w[0], w[1], w[2]), s.x - r, s.y - r, r * 2, r * 2);
      }
    });
    // LEDs.
    ART.leds.forEach((l) => {
      lightAt(l.u, _c);
      let it = _c[3];
      if (S.theme === "normal" || S.theme === "off") it *= 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.sin(TAU * (t * 0.9 - l.k * 0.09)), 2);
      x.globalAlpha = clamp(it, 0, 1);
      x.drawImage(sprite(_c[0], _c[1], _c[2]), l.x - 10, l.y - 10, 20, 20);
      const w = whiten(_c, 0.75, _w);
      x.globalAlpha = clamp(it * 0.9, 0, 1);
      x.drawImage(sprite(w[0], w[1], w[2]), l.x - 4, l.y - 4, 8, 8);
    });
    x.globalAlpha = 1;
  }

  function drawWindmill(x) {
    x.save();
    x.translate(WM.x, WM.y);
    x.fillStyle = "rgba(0,0,0,.45)";
    x.beginPath(); x.arc(1.5, 2, WM.r, 0, TAU); x.fill();
    x.rotate(S.wmA);
    for (let i = 0; i < 4; i++) {
      x.rotate(Math.PI / 2);
      const g = x.createLinearGradient(0, 0, WM.r, 0);
      g.addColorStop(0, "#fff3c0"); g.addColorStop(1, "#d8a028");
      x.fillStyle = i % 2 ? "#e8402a" : g;
      x.beginPath(); x.moveTo(0, 0); x.lineTo(WM.r, -3.2); x.quadraticCurveTo(WM.r + 1.5, 0, WM.r, 1.2); x.closePath(); x.fill();
    }
    x.restore();
    x.fillStyle = "#eef2f7";
    x.beginPath(); x.arc(WM.x, WM.y, 2.4, 0, TAU); x.fill();
    x.fillStyle = "#59616c";
    x.beginPath(); x.arc(WM.x + 0.6, WM.y + 0.6, 1, 0, TAU); x.fill();
  }

  function drawDenchuWings(x) {
    const k = smooth(S.denK);
    const wing = (px, py, side) => {
      x.save();
      x.translate(px, py);
      x.rotate(side * k * 0.72);
      const g = x.createLinearGradient(0, -14, 0, 0);
      g.addColorStop(0, "#ffe680"); g.addColorStop(1, "#ff9a10");
      x.fillStyle = g; x.strokeStyle = "#5a2a00"; x.lineWidth = 1;
      x.beginPath();
      x.moveTo(-2.4, 0); x.lineTo(-2.2 + side * 0.5, -12); x.quadraticCurveTo(side * 0.6, -15.5, 2.4 * 1 + side * 0.4, -12); x.lineTo(2.4, 0); x.closePath();
      x.fill(); x.stroke();
      x.fillStyle = "rgba(255,255,255,.55)";
      x.fillRect(-1.2, -11, 1, 9);
      x.restore();
    };
    wing(516.5, 463.5, -1);
    wing(539.5, 463.5, 1);
    // Status LED.
    const on = S.denK > 0.5;
    x.fillStyle = on ? "#7dffb0" : "#5a1010";
    x.beginPath(); x.arc(528, 472, 2.4, 0, TAU); x.fill();
    if (on || S.glow.denchu > 0.05) {
      x.globalCompositeOperation = "lighter";
      x.globalAlpha = clamp(0.6 * k + S.glow.denchu, 0, 1);
      x.drawImage(sprite(120, 255, 170), 528 - 14, 472 - 14, 28, 28);
      x.globalAlpha = 1;
      x.globalCompositeOperation = "source-over";
    }
  }

  function drawAttackerDoor(x) {
    const k = smooth(S.attK);
    x.save();
    if (k > 0.01) {
      // Opening interior glow.
      const g = x.createLinearGradient(0, 603, 0, 621);
      g.addColorStop(0, "#1a0a00"); g.addColorStop(1, "#7a3a00");
      x.fillStyle = g;
      x.fillRect(380, 603, 104, 14 * k + 1);
      x.globalCompositeOperation = "lighter";
      x.globalAlpha = 0.7 * k;
      for (let i = 0; i < 5; i++) x.drawImage(sprite(255, 170, 40), 386 + i * 23 - 12, 606 - 12, 24, 24);
      x.globalAlpha = 1;
      x.globalCompositeOperation = "source-over";
    }
    // Door plate (tilts toward the viewer when open).
    const top = 603 + 14 * k, bot = 621 + 3 * k, sp = 3 * k;
    const g2 = x.createLinearGradient(0, top, 0, bot);
    g2.addColorStop(0, k > 0.5 ? "#ffd27a" : "#ff6a2a"); g2.addColorStop(0.5, "#d0280c"); g2.addColorStop(1, "#5a0800");
    x.fillStyle = g2; x.strokeStyle = "#200200"; x.lineWidth = 1;
    x.beginPath(); x.moveTo(380, top); x.lineTo(484, top); x.lineTo(484 + sp, bot); x.lineTo(380 - sp, bot); x.closePath(); x.fill(); x.stroke();
    if (k < 0.6) {
      x.globalAlpha = 1 - k / 0.6;
      x.strokeStyle = "#ffe08a"; x.lineWidth = 1.6; x.lineJoin = "round";
      x.beginPath();
      for (let i = 0; i < 6; i++) { const cx = 398 + i * 14; x.moveTo(cx - 3, 607); x.lineTo(cx + 3, 612); x.lineTo(cx - 3, 617); }
      x.stroke();
      x.fillStyle = "rgba(255,255,255,.35)";
      x.fillRect(382, 604, 100, 2);
      x.globalAlpha = 1;
    }
    x.restore();
    // Frame LEDs chase when open.
    const t = S.time;
    x.globalCompositeOperation = "lighter";
    for (let i = 0; i < 9; i++) {
      const on = k > 0.3 ? 0.4 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(t * 14 - i * 0.9), 3) : 0.12;
      x.globalAlpha = on;
      x.drawImage(sprite(255, 200, 70), 384 + i * 12 - 5, 599 - 5, 10, 10);
    }
    x.globalAlpha = 1;
    x.globalCompositeOperation = "source-over";
  }

  function drawPocketGlows(x) {
    x.globalCompositeOperation = "lighter";
    const gl = S.glow;
    if (gl.heso > 0.02) { x.globalAlpha = gl.heso; x.drawImage(sprite(255, 90, 50), 294 - 26, 551 - 26, 52, 52); }
    if (gl.attacker > 0.02) { x.globalAlpha = gl.attacker; x.drawImage(sprite(255, 210, 90), 432 - 50, 612 - 30, 100, 60); }
    if (gl.out > 0.02) { x.globalAlpha = gl.out * 0.35; x.drawImage(sprite(160, 180, 255), 294 - 12, 641 - 12, 24, 24); }
    if (gl.stage > 0.02) { x.globalAlpha = gl.stage * 0.45; x.drawImage(sprite(255, 190, 90), 294 - 120, 486 - 20, 240, 40); }
    if (gl.warp > 0.02) { x.globalAlpha = gl.warp * 0.8; x.drawImage(sprite(140, 210, 255), WARP.x - 16, WARP.y - 16, 32, 32); }
    x.globalAlpha = 1;
    x.globalCompositeOperation = "source-over";
  }

  // ---------------------------------------------------------------- loop
  function tick(now) {
    S.raf = 0;
    if (S.paused || !S.mounted) return;
    const dt = Math.min(0.05, Math.max(0, (now - S.last) / 1000));
    S.last = now;
    S.measureT += dt;
    if (S.measureT > 1) { S.measureT = 0; measure(); }
    update(dt);
    render();
    S.raf = requestAnimationFrame(tick);
  }
  function startLoop() {
    if (S.raf || S.paused || !S.mounted) return;
    S.last = performance.now();
    S.raf = requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- API
  function mount(els) {
    L = PK.L;
    if (!L) throw new Error("PK.Cabinet.mount: PK.L (layout.js) is not loaded");
    els = els || {};
    if (S.raf) cancelAnimationFrame(S.raf);
    S.raf = 0;
    S.back = els.back; S.field = els.field; S.front = els.front;
    const W = L.stage.w, H = L.stage.h;
    [S.back, S.front].forEach((svg) => {
      if (!svg) return;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svg.setAttribute("width", W);
      svg.setAttribute("height", H);
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.style.pointerEvents = "none";
    });
    try { S.reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { S.reduced = false; }
    buildPins();
    if (S.back) buildBack(S.back);
    if (S.front) buildFront(S.front);
    else buildFront(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    if (S.field) {
      S.field.style.width = W + "px";
      S.field.style.height = H + "px";
      S.field.style.pointerEvents = "none";
      S.ctx = S.field.getContext("2d");
      S.cw = 0;
      prepFills();
      S.winPath = new Path2D(loopPath(0, 3));
      S.swirlBand = new Path2D(loopPath(SWIRL.s1, 3) + loopPath(SWIRL.inner, 3));
      S.aboveConsole = new Path2D(CONSOLE_TOP + " L588,0 L0,0 Z");
      const Lc = L.lcd;
      S.lcdPath = new Path2D();
      if (S.lcdPath.roundRect) S.lcdPath.roundRect(Lc.x - 4, Lc.y - 4, Lc.w + 8, Lc.h + 8, Lc.r + 4);
      else S.lcdPath.rect(Lc.x - 4, Lc.y - 4, Lc.w + 8, Lc.h + 8);
      measure();
    }
    S.mounted = true;
    // AI art, if there is any: the layer that shows it is rebuilt when it has loaded.
    if (typeof els.assetsBase === "string") {
      [["dragonImg", DRAGON_ART.file, "front"], ["crestImg", CREST_ART.file, "front"], ["boardImg", BOARD_ART.file, "back"]].forEach(([key, file, layer]) => {
        if (S[key]) return;
        const im = new Image();
        im.onload = () => {
          S[key] = im;
          if (layer === "back") { if (S.back) buildBack(S.back); }
          else if (S.front) { buildFront(S.front); prepFills(); setSub(S.subStr, S.subCol); }
        };
        im.src = els.assetsBase + file;
      });
    }
    setSub(S.subStr != null ? S.subStr : PK.t ? PK.t("cab.subDefault") : "?cab.subDefault", S.subCol);
    if (!S._vis) {
      S._vis = true;
      document.addEventListener("visibilitychange", () => { if (!document.hidden) startLoop(); });
      window.addEventListener("resize", () => { if (S.mounted) measure(); });
    }
    if (S.ctx) render();
    startLoop();
  }

  function launch(target, side, onArrive) {
    if (!S.mounted) {
      if (typeof onArrive === "function") setTimeout(onArrive, 1600);
      return 0;
    }
    const pb = buildPath(target, side);
    const total = pb.T;
    // Scale playback so the ball reaches its pocket 1.4–2.2 s after launch.
    const tArr = arriveTime(pb);
    const rate = tArr / clamp(tArr, FLIGHT_MIN, FLIGHT_MAX);
    const b = { id: S.nextId++, segs: pb.segs, t: 0, idx: 0, total, rate, onArrive, arrived: false, trail: [], target };
    S.balls.push(b);
    if (S.balls.length > 40) { const old = S.balls.shift(); arrive(old, "out"); }
    return b.id;
  }

  function arriveTime(pb) {
    for (let i = 0; i < pb.segs.length; i++) if (pb.segs[i].arrive) return pb.segs[i].t0;
    return pb.T;
  }

  function setLights(theme) {
    if (!WISP[theme]) theme = "normal";
    if (theme === S.theme) return;
    // Freeze the in-progress crossfade as the new starting point.
    S.prevTheme = S.theme;
    S.theme = theme;
    S.themeT0 = S.time;
  }
  function flash(color) {
    S.flashCol = parseColor(color || "white");
    S.flashAmt = 1;
  }
  function setAttacker(open) { S.attOpen = !!open; }
  function setDenchu(open) { S.denOpen = !!open; }
  function setSub(text, color) {
    S.subStr = text == null ? "" : String(text);
    S.subCol = color;
    const g = S.subText;
    if (!g) return;
    const lines = S.subStr.split("\n").filter((l, i, a) => l.length || a.length === 1);
    const Sd = L.sub;
    const n = Math.max(1, lines.length);
    const maxLen = Math.max(1, ...lines.map((l) => l.replace(/[ -~]/g, "x").length - (l.match(/[ -~]/g) || []).length * 0.42));
    const size = Math.min((Sd.h - 8) / n / 1.08, (Sd.w - 10) / maxLen, 30);
    const col = color || "#ffd84a";
    const lh = size * 1.08;
    const y0 = Sd.y + Sd.h / 2 - (lh * (n - 1)) / 2;
    let s = "";
    lines.forEach((l, i) => {
      const esc = l.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      s += `<text x="${Sd.x + Sd.w / 2}" y="${f1(y0 + i * lh)}" text-anchor="middle" dominant-baseline="central" font-family="'Dela Gothic One','Noto Sans TC','Arial Black',Impact,sans-serif" font-size="${f1(size)}" fill="${col}" stroke="#000" stroke-width="${f1(size * 0.12)}" paint-order="stroke">${esc}</text>`;
    });
    g.innerHTML = s;
  }
  function pause(p) {
    S.paused = !!p;
    if (S.paused) { if (S.raf) cancelAnimationFrame(S.raf); S.raf = 0; }
    else startLoop();
  }

  PK.Cabinet = {
    mount, launch, setLights, flash, setAttacker, setDenchu, setSub, pause,
    // fn() is called each time a ball bounces off a pin (the shell plays a soft metallic tick).
    onPin(fn) { S.onPin = typeof fn === "function" ? fn : null; },
    // Dev/test hooks (not part of the contract): step the simulation by ms and render.
    _advance(ms) {
      if (!S.mounted) return;
      let left = ms / 1000;
      while (left > 1e-6) { const d = Math.min(1 / 60, left); update(d); left -= d; }
      render();
    },
    _info() {
      return { balls: S.balls.length, theme: S.theme, time: S.time, k: S.k, pins: PINS.all.length,
        flights: S.balls.map((b) => ({ id: b.id, target: b.target, total: b.total, rate: b.rate })) };
    },
    // Build one path without launching it and sample it in real (scaled) time.
    _samplePath(target, side, dt) {
      if (!S.mounted) return null;
      dt = dt || 1 / 120;
      const pb = buildPath(target, side);
      const tArr = arriveTime(pb), rate = tArr / clamp(tArr, FLIGHT_MIN, FLIGHT_MAX);
      const samples = [];
      let kind = null;
      pb.segs.forEach((s) => { if (s.arrive) kind = s.arrive; });
      for (let t = 0; t <= pb.T / rate + 1e-9; t += dt) {
        const tt = t * rate;
        let s = pb.segs[0];
        for (let i = 0; i < pb.segs.length; i++) if (pb.segs[i].t0 <= tt) s = pb.segs[i];
        const u = clamp((tt - s.t0) / s.d, 0, 1), p = s.f(u);
        samples.push({ t, x: p[0], y: p[1], a: s.alpha ? s.alpha(u) : 1, rail: !!s.rail, arrived: tt >= tArr, tag: s.tag, u });
      }
      return { arrive: tArr / rate, total: pb.T / rate, kind, samples };
    },
    _geom: { inWin: (x, y, s) => inWin(x, y, s), pins: () => PINS.all.slice() },
  };
})();
