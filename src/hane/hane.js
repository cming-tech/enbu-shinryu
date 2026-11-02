// 霓虹天使 — the 羽根物 (ハネモノ) prototype: ball physics, the field, the wings, the 役物 and the
// rules, drawn procedurally in neon. dev/MACHINE2.md has the design. One module, no dependencies:
//   const g = PK.Hane.create({ canvas });   g.setFiring(true);   ...
//   PK.Hane.simulate(seconds, opts) runs a game headless (no canvas) and returns its stats.
// Units: the field is W x H design units; the canvas is scaled to fit.
(function () {
  "use strict";
  const PK = (window.PK = window.PK || {});

  const W = 360, H = 600;
  const R = 4;                    // ball radius
  const PIN_R = 2;
  const G = 620;                  // gravity, units/s^2
  const SUB = 1 / 240;            // physics substep
  const E_WALL = 0.42, E_PIN = 0.5, FRICT = 0.992;
  const FIRE_GAP = 0.6;           // seconds between balls (100 a minute)
  const POWER_V = [700, 1000];    // launch speed at power 0..1 (under ~690 a ball cannot climb the rail)

  // ---------------------------------------------------------------- geometry
  const ARC = { cx: 180, cy: 182, r: 172 };
  const RAIL_X = 24;              // the launch rail runs between the left wall and this
  const YAKU = { x0: 122, x1: 238, y0: 150, y1: 340 };            // the 役物's outer body
  const ROOF_Y = YAKU.y0 - 22;    // its peaked roof: a flat top held balls (the player saw them stuck on it)
  const IN = { x0: 132, x1: 228, y0: 212, y1: 330 };              // its clear interior
  const LCD = { x0: 128, x1: 232, y0: 156, y1: 204 };             // the small screen on top
  const PLATE = { cx: 180, cy: 258, half: 32, amp: 0.42, w: 2.4 }; // the swinging plate
  const FLOOR_Y = 324;
  // The bowl floor leads every ball to the centre gap; under it a shutter slides left and right with
  // the V window in it. A ball that drops while the window passes under it is V (the suspense of a
  // ハネモノ: watching the ball meet the window).
  const GAP = { x0: 170, x1: 190 };
  const SHUTTER = { amp: 26, w: 2.4, win: 1.5, winBonus: 3.7 };   // the V window's half-width: wider (and lit) in a bonus
  const WINGS = [   // hinge, length, closed and open angle (radians, 0 = +x, y down)
    { hx: 122, hy: 302, len: 36, closed: -Math.PI / 2, open: -Math.PI * 0.86, side: -1 },
    { hx: 238, hy: 302, len: 36, closed: -Math.PI / 2, open: -Math.PI * 0.14, side: 1 },
  ];
  const CHUCKERS = [
    { cx: 74, cy: 418, opens: 1, pay: 3 },
    { cx: 180, cy: 392, opens: 2, pay: 3 },
    { cx: 286, cy: 418, opens: 1, pay: 3 },
  ];
  const CHUCK_HALF = 5;
  const MEI = 8;                  // the 命釘 pair over each chucker, this far either side (the gap is the odds)
  // bonus
  const ROUND_OPENS = 18, ROUND_COUNT = 8, MAX_ROUNDS = 15, COUNT_PAY = 10;
  // 予告 and the like (the player found the first prototype "not that fun"):
  //  CHANCE   on some captures in normal play the V shutter swings narrower (the window stays near
  //           the centre) while the ball is inside: a real boost, announced on the screen
  //  金珠      a golden ball, rare; caught, it stops the shutter at the centre and widens V
  //  OVERDRIVE from round OD_ROUND each caught ball pays more
  const CHANCE_RATE = 0.2, CHANCE_AMP = 0.5, CHANCE_SECS = 3.2;
  const GOLD_RATE = 1 / 40, GOLD_WIN = 7;
  const OD_ROUND = 5, COUNT_PAY_OD = 12;
  // OPEN_NORMAL must stay above CATCH_AT / WING_SPEED (~0.19 s), or a normal opening never catches
  const OPEN_NORMAL = 0.24, OPEN_BONUS = 0.85, OPEN_GAP = 0.3, WING_SPEED = 4.5;   // WING_SPEED: openness per second (the player found 12 too fast to follow)
  const CATCH_AT = 0.85;          // a wing catches only when this open

  function buildStatic() {
    const segs = [];   // [x1, y1, x2, y2]
    const seg = (a, b, c, d) => segs.push([a, b, c, d]);
    // outer walls and the top arc
    seg(8, 182, 8, H + 20); seg(352, 182, 352, H + 20);
    for (let a = 180; a < 360; a += 6) {
      const r1 = (a * Math.PI) / 180, r2 = ((a + 6) * Math.PI) / 180;
      seg(ARC.cx + ARC.r * Math.cos(r1), ARC.cy + ARC.r * Math.sin(r1), ARC.cx + ARC.r * Math.cos(r2), ARC.cy + ARC.r * Math.sin(r2));
    }
    // the rail's inner wall, with a lip so field balls do not fall back into it
    seg(RAIL_X, 176, RAIL_X, H + 20); seg(RAIL_X, 176, RAIL_X + 10, 166);
    // the 役物 body (outside) and its interior
    seg(YAKU.x0, YAKU.y0, 180, ROOF_Y); seg(180, ROOF_Y, YAKU.x1, YAKU.y0); seg(YAKU.x0, YAKU.y0, YAKU.x0, YAKU.y1); seg(YAKU.x1, YAKU.y0, YAKU.x1, YAKU.y1);
    seg(YAKU.x0, YAKU.y1, YAKU.x1, YAKU.y1);
    // chucker cups: two walls and a floor each
    for (const c of CHUCKERS) {
      seg(c.cx - CHUCK_HALF - 2, c.cy - 6, c.cx - CHUCK_HALF - 2, c.cy + 8);
      seg(c.cx + CHUCK_HALF + 2, c.cy - 6, c.cx + CHUCK_HALF + 2, c.cy + 8);
    }
    // pins: a staggered grid, kept off the rail, the 役物 and the chuckers; 命釘 pairs over each chucker
    const pins = [];
    for (let row = 0, y = 64; y <= 560; row++, y += 20) {
      // the gap to the rail wall is either clear (here 12) or closed: one just under a ball's width (7) wedged balls
      for (let x = 38 + (row % 2 ? 11 : 0); x <= 342; x += 22) {
        if (y < ARC.cy && Math.hypot(x - ARC.cx, y - ARC.cy) > ARC.r - 14) continue;
        if (x > YAKU.x0 - 12 && x < YAKU.x1 + 12 && y > ROOF_Y - 8 && y < YAKU.y1 + 10) continue;
        // keep the wings' swing clear
        if (y > 250 && y < 320 && ((x > 80 && x < YAKU.x0) || (x > YAKU.x1 && x < 280))) continue;
        if (CHUCKERS.some((c) => Math.abs(x - c.cx) < 22 && y > c.cy - 26 && y < c.cy + 14)) continue;
        if (y > 520 && Math.abs(x - 180) < 30) continue;   // the out hole
        pins.push([x, y]);
      }
    }
    for (const c of CHUCKERS) { pins.push([c.cx - MEI, c.cy - 16]); pins.push([c.cx + MEI, c.cy - 16]); }
    // interior segments (only balls inside the 役物 meet these)
    const inner = [];
    const iseg = (a, b, c, d) => inner.push([a, b, c, d]);
    iseg(IN.x0, IN.y0, IN.x1, IN.y0); iseg(IN.x0, IN.y0, IN.x0, IN.y1); iseg(IN.x1, IN.y0, IN.x1, IN.y1);
    // the bowl
    iseg(IN.x0, FLOOR_Y - 22, GAP.x0, FLOOR_Y - 2); iseg(GAP.x1, FLOOR_Y - 2, IN.x1, FLOOR_Y - 22);
    const innerPins = [];
    return { segs, pins, inner, innerPins };
  }
  const STATIC = buildStatic();
  // spatial grid of pins
  const CELL = 24, GCOLS = Math.ceil(W / CELL) + 1;
  const PIN_GRID = new Map();
  for (const p of STATIC.pins) {
    const k = Math.floor(p[0] / CELL) + Math.floor(p[1] / CELL) * GCOLS;
    if (!PIN_GRID.has(k)) PIN_GRID.set(k, []);
    PIN_GRID.get(k).push(p);
  }

  // ---------------------------------------------------------------- physics helpers
  function hitCircle(b, cx, cy, rr, e) {
    const dx = b.x - cx, dy = b.y - cy, d2 = dx * dx + dy * dy, min = R + rr;
    if (d2 >= min * min || d2 === 0) return false;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
    b.x = cx + nx * min; b.y = cy + ny * min;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
      b.vx *= FRICT; b.vy *= FRICT;
      // a ball balanced on a pin top gets a nudge
      if (Math.abs(nx) < 0.08 && ny < 0) b.vx += (b.rnd() - 0.5) * 30;
    }
    return true;
  }
  // segment with an optional velocity at the contact point (sv(x, y) -> [vx, vy])
  function hitSeg(b, s, e, sv) {
    const x1 = s[0], y1 = s[1], dx = s[2] - x1, dy = s[3] - y1, L2 = dx * dx + dy * dy;
    let t = ((b.x - x1) * dx + (b.y - y1) * dy) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = x1 + dx * t, py = y1 + dy * t, ox = b.x - px, oy = b.y - py, d2 = ox * ox + oy * oy;
    if (d2 >= R * R) return false;
    const d = Math.sqrt(d2) || 0.0001, nx = ox / d, ny = oy / d;
    b.x = px + nx * R; b.y = py + ny * R;
    const v = sv ? sv(px, py) : null;
    let rvx = b.vx - (v ? v[0] : 0), rvy = b.vy - (v ? v[1] : 0);
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      rvx -= (1 + e) * vn * nx; rvy -= (1 + e) * vn * ny;
      rvx *= FRICT; rvy *= FRICT;
      b.vx = rvx + (v ? v[0] : 0); b.vy = rvy + (v ? v[1] : 0);
    }
    return true;
  }

  // ---------------------------------------------------------------- the game
  function makeRng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  }

  function createGame(opts) {
    opts = opts || {};
    const rnd = makeRng(opts.seed || (Date.now() & 0xffffffff));
    const g = {
      t: 0, chips: opts.chips != null ? opts.chips : 3000, firing: false, power: opts.power != null ? opts.power : 0.55, fireAcc: 0,
      balls: [], nextId: 1,
      mode: "normal", round: 0, roundOpens: 0, count: 0, vInRound: false, roundEndT: 0, breakT: 0,
      wings: WINGS.map(() => ({ a: 0, target: 0 })), openQ: 0, openT: 0, gapT: 0, opening: false,
      plateA: 0, plateW: 0, chanceT: 0, ampK: 1,
      events: [], onEvent: opts.onEvent || null,
      stats: { normalT: 0, bonusT: 0, fired: 0, foul: 0, chucker: 0, opens: 0, captured: 0, capturedN: 0, v: 0, vN: 0, vB: 0, capturedB: 0, lostIn: 0, jackpots: 0, rounds: 0, paid: 0, out: 0 },
    };
    const emit = (name, data) => { if (g.onEvent) g.onEvent(name, data); };

    function spawn() {
      if (g.chips < 1) { g.firing = false; emit("empty"); return; }
      g.chips--; g.stats.fired++;
      const v = POWER_V[0] + (POWER_V[1] - POWER_V[0]) * Math.min(1, Math.max(0, g.power + (rnd() - 0.5) * 0.03));
      g.balls.push({ id: g.nextId++, x: 16, y: 560, vx: 0, vy: -v, zone: "rail", rnd, stillT: 0, gold: rnd() < GOLD_RATE });
      emit("fire");
    }
    function queueOpens(n) { g.openQ += n; g.stats.opens += n; }
    function startBonus() {
      g.mode = "bonus"; g.round = 0; g.stats.jackpots++;
      emit("jackpot");
      nextRound();
    }
    function nextRound() {
      g.round++; g.stats.rounds++; g.roundOpens = 0; g.count = 0; g.vInRound = false; g.roundEndT = 0;
      g.openQ = 0; g.breakT = 1.6;
      emit("roundStart", { round: g.round });
      if (g.round === OD_ROUND) emit("overdrive");
    }
    function endRoundCheck(dt) {
      if (g.mode !== "bonus" || g.breakT > 0) return;
      const done = g.roundOpens >= ROUND_OPENS || g.count >= ROUND_COUNT;
      if (!done) return;
      // wait for the balls in the 役物 to settle (at most 4 s)
      g.openQ = 0;
      const inside = g.balls.some((b) => b.zone === "in" || b.zone === "toIn");
      g.roundEndT += dt;
      if (inside && g.roundEndT < 4) return;
      if (g.vInRound && g.round < MAX_ROUNDS) nextRound();
      else { emit("bonusEnd", { rounds: g.round }); g.mode = "normal"; g.round = 0; }
    }

    // wings: one open at a time from the queue (bonus: keep opening until the round is done)
    function stepWings(dt) {
      if (g.mode === "bonus" && g.breakT <= 0 && g.roundOpens < ROUND_OPENS && g.count < ROUND_COUNT && !g.opening && g.gapT <= 0) g.openQ = Math.max(g.openQ, 1);
      if (g.opening) {
        g.openT -= dt;
        if (g.openT <= 0) { g.opening = false; g.gapT = OPEN_GAP; }
      } else if (g.gapT > 0) g.gapT -= dt;
      else if (g.openQ > 0) {
        g.openQ--; g.opening = true; g.openT = g.mode === "bonus" ? OPEN_BONUS : OPEN_NORMAL;
        if (g.mode === "bonus") g.roundOpens++;
        emit("wingOpen");
      }
      for (const w of g.wings) {
        w.target = g.opening ? 1 : 0;
        w.a += Math.max(-WING_SPEED * dt, Math.min(WING_SPEED * dt, w.target - w.a));
      }
    }
    const wingAngle = (i) => WINGS[i].closed + (WINGS[i].open - WINGS[i].closed) * g.wings[i].a;

    function plateSeg() {
      const a = g.plateA, c = Math.cos(a), s = Math.sin(a);
      return [PLATE.cx - c * PLATE.half, PLATE.cy - s * PLATE.half, PLATE.cx + c * PLATE.half, PLATE.cy + s * PLATE.half];
    }
    const plateVel = (px, py) => [-g.plateW * (py - PLATE.cy), g.plateW * (px - PLATE.cx)];
    g.shutterX = () => 180 + SHUTTER.amp * g.ampK * Math.sin(g.t * SHUTTER.w);
    g.vWin = () => (g.mode === "bonus" ? SHUTTER.winBonus : SHUTTER.win);

    function stepBall(b, dt) {
      b.vy += G * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.zone === "rail") {
        if (b.x < 8 + R) { b.x = 8 + R; b.vx = Math.abs(b.vx) * 0.3; }
        if (b.x > RAIL_X - R && b.y > 176) { b.x = RAIL_X - R; b.vx = -Math.abs(b.vx) * 0.3; }
        if (b.y < 176) b.zone = "field";
        else if (b.vy > 0 && b.y > 470) { b.dead = true; g.stats.foul++; g.chips++; emit("foul"); }   // too weak: the ball rolls back
        return;
      }
      if (b.zone === "field") {
        for (const s of STATIC.segs) hitSeg(b, s, E_WALL);
        const cx = Math.floor(b.x / CELL), cy = Math.floor(b.y / CELL);
        for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iy = cy - 1; iy <= cy + 1; iy++) {
          const list = PIN_GRID.get(ix + iy * GCOLS);
          if (list) for (const p of list) hitCircle(b, p[0], p[1], PIN_R, E_PIN);
        }
        // the wings: an open wing catches a ball on its outer side
        for (let i = 0; i < 2; i++) {
          if (g.wings[i].a < CATCH_AT) continue;
          const wd = WINGS[i], ang = wingAngle(i);
          const tx = wd.hx + Math.cos(ang) * wd.len, ty = wd.hy + Math.sin(ang) * wd.len;
          const minX = Math.min(wd.hx, tx) - 4, maxX = Math.max(wd.hx, tx) + 4;
          if (b.x > minX && b.x < maxX && b.y > ty - 10 && b.y < wd.hy + 2 && b.vy > -40) {
            b.zone = "toIn"; b.t = 0; b.fx = b.x; b.fy = b.y; b.side = i;
            g.stats.captured++; if (g.mode === "bonus") g.stats.capturedB++; else g.stats.capturedN++;
            if (g.mode === "bonus") { const pay = g.round >= OD_ROUND ? COUNT_PAY_OD : COUNT_PAY; g.count++; g.chips += pay; g.stats.paid += pay; }
            emit("capture", { side: i, gold: b.gold });
            if (g.mode === "normal") {
              if (b.gold) emit("goldCapture");
              else if (rnd() < CHANCE_RATE) { g.chanceT = CHANCE_SECS; emit("chance"); }
            }
            return;
          }
        }
        for (const c of CHUCKERS) {
          if (Math.abs(b.x - c.cx) < CHUCK_HALF && b.y > c.cy - 4 && b.y < c.cy + 8 && b.vy > 0) {
            b.dead = true; g.stats.chucker++; g.chips += c.pay; g.stats.paid += c.pay;
            if (g.mode === "normal") queueOpens(c.opens);
            emit("chucker", { opens: c.opens, x: c.cx });
            return;
          }
        }
        if (b.y > H + 10) { b.dead = true; g.stats.out++; }
      } else if (b.zone === "in") {
        for (const s of STATIC.inner) hitSeg(b, s, 0.35);
        hitSeg(b, plateSeg(), 0.3, plateVel);
        for (const p of STATIC.innerPins) hitCircle(b, p[0], p[1], 2.5, 0.45);
        // the moment that matters: the ball reaches the centre gap (the view slows time and zooms in)
        if (!b.near && b.y > FLOOR_Y - 26 && Math.abs(b.x - 180) < 18) {
          b.near = true;
          emit("vApproach", { decisive: g.mode === "normal" || !g.vInRound, gold: !!b.gold });
        }
        if (b.y > FLOOR_Y + 2) {
          b.dead = true;
          const win = b.gold ? GOLD_WIN : g.vWin(), miss = Math.abs(b.x - g.shutterX());
          if (miss < win) {
            g.stats.v++; if (g.mode === "bonus") g.stats.vB++; else g.stats.vN++;
            emit("v");
            if (g.mode === "normal") startBonus();
            else if (!g.vInRound) { g.vInRound = true; emit("vRound", { round: g.round }); }
          } else { g.stats.lostIn++; emit("lostIn", { near: miss < win + 6 }); }
        }
      }
    }
    function stepCaptured(b, dt) {   // carried by the wing into the 役物's top
      b.t += dt / 0.32;
      const ex = b.side ? IN.x1 - 14 : IN.x0 + 14, ey = IN.y0 + 6;
      const u = Math.min(1, b.t), mx = (b.fx + ex) / 2, my = Math.min(b.fy, ey) - 40;
      b.x = (1 - u) * (1 - u) * b.fx + 2 * u * (1 - u) * mx + u * u * ex;
      b.y = (1 - u) * (1 - u) * b.fy + 2 * u * (1 - u) * my + u * u * ey;
      if (u >= 1) { b.zone = "in"; b.vx = (b.side ? -1 : 1) * (20 + b.rnd() * 30); b.vy = 0; }
    }
    function collideBalls() {
      const bs = g.balls;
      for (let i = 0; i < bs.length; i++) {
        const a = bs[i];
        if (a.zone !== "field" && a.zone !== "in") continue;
        for (let j = i + 1; j < bs.length; j++) {
          const c = bs[j];
          if (c.zone !== a.zone) continue;
          const dx = c.x - a.x, dy = c.y - a.y, d2 = dx * dx + dy * dy;
          if (d2 >= 4 * R * R || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, push = (2 * R - d) / 2;
          a.x -= nx * push; a.y -= ny * push; c.x += nx * push; c.y += ny * push;
          const vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
          if (vn < 0) { const j2 = -vn * 0.9; a.vx -= j2 * nx; a.vy -= j2 * ny; c.vx += j2 * nx; c.vy += j2 * ny; }
        }
      }
    }
    // stuck guard: a ball that hardly moves for 3 s is let go (it would block a lane forever)
    function unstick(b, dt) {
      const sp = Math.abs(b.vx) + Math.abs(b.vy);
      b.stillT = sp < 12 ? b.stillT + dt : 0;
      if (b.stillT > 3) { b.vx += (b.rnd() - 0.5) * 120; b.vy -= 60; b.stillT = 0; }
    }

    g.step = function (dt) {
      dt = Math.min(dt, 0.1);
      g.t += dt;
      if (g.firing && g.mode !== "ending") {
        g.fireAcc += dt;
        while (g.fireAcc >= FIRE_GAP && g.firing) { g.fireAcc -= FIRE_GAP; spawn(); }
      }
      if (g.breakT > 0) g.breakT -= dt;
      if (g.mode === "bonus") g.stats.bonusT += dt; else g.stats.normalT += dt;
      stepWings(dt);
      // the shutter's swing: narrow on a CHANCE, still at the centre with a golden ball inside
      if (g.chanceT > 0) g.chanceT -= dt;
      g.goldIn = g.balls.some((b) => b.gold && (b.zone === "in" || b.zone === "toIn"));
      const ampTo = g.goldIn ? 0 : g.chanceT > 0 ? CHANCE_AMP : 1;
      g.ampK += (ampTo - g.ampK) * Math.min(1, dt * 3);
      let left = dt;
      while (left > 1e-6) {
        const h = Math.min(SUB, left); left -= h;
        const pa = g.plateA;
        g.plateA = PLATE.amp * Math.sin(g.t * PLATE.w + (dt - left) * PLATE.w);
        g.plateW = (g.plateA - pa) / h;
        for (const b of g.balls) {
          if (b.dead) continue;
          if (b.zone === "toIn") stepCaptured(b, h); else stepBall(b, h);
        }
        collideBalls();
      }
      for (const b of g.balls) if (!b.dead && (b.zone === "field" || b.zone === "in")) unstick(b, dt);
      g.balls = g.balls.filter((b) => !b.dead);
      endRoundCheck(dt);
    };
    g.setFiring = (on) => { g.firing = !!on && g.chips > 0; if (g.firing) g.fireAcc = FIRE_GAP; };
    g.setPower = (p) => { g.power = Math.min(1, Math.max(0, p)); };
    g.wingAngle = wingAngle;
    g.plateSeg = plateSeg;
    // for checks: start a bonus, or jump to round n (the 演出 as in play)
    g._test = { jackpot: startBonus, toRound(n) { g.round = n - 1; nextRound(); }, emit };
    return g;
  }

  // ---------------------------------------------------------------- drawing (neon)
  const COL = { bg: "#05070f", cyan: "#21e6ff", mag: "#ff3fd0", vio: "#8a5cff", pin: "#9fb6d8", gold: "#ffd34d", white: "#f4f8ff" };
  function neonLine(x, pts, col, w, glow) {
    x.lineCap = "round"; x.lineJoin = "round";
    for (const [lw, a] of glow ? [[w * 4, 0.12], [w * 2.2, 0.25], [w, 1]] : [[w, 1]]) {
      x.globalAlpha = a; x.strokeStyle = col; x.lineWidth = lw;
      x.beginPath(); x.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]);
      x.stroke();
    }
    x.globalAlpha = 1;
  }
  // draws picture `im` to cover the box (centre crop)
  function cover(x, im, bx, by, bw, bh) {
    const k = Math.max(bw / im.width, bh / im.height), sw = bw / k, sh = bh / k;
    x.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, bx, by, bw, bh);
  }

  function drawStatic(x, bg) {
    x.fillStyle = COL.bg; x.fillRect(0, 0, W, H);
    // city behind the glass: the AI picture, dimmed so the pins and balls stay clear
    if (bg) { cover(x, bg, 0, 0, W, H); x.fillStyle = "rgba(4,6,14,0.62)"; x.fillRect(0, 0, W, H); }
    const rnd = makeRng(7);
    for (let i = 0; i < (bg ? 0 : 26); i++) {
      const bw = 14 + rnd() * 26, bh = 60 + rnd() * 220, bx = rnd() * W;
      x.fillStyle = i % 3 ? "#0b1230" : "#120a2c"; x.fillRect(bx, H - bh, bw, bh);
      x.fillStyle = rnd() < 0.5 ? "rgba(33,230,255,0.35)" : "rgba(255,63,208,0.3)";
      for (let wy = H - bh + 8; wy < H - 6; wy += 10) for (let wx = bx + 3; wx < bx + bw - 3; wx += 6) if (rnd() < 0.3) x.fillRect(wx, wy, 2, 3);
    }
    x.fillStyle = "rgba(5,7,15,0.55)"; x.fillRect(0, 0, W, H);
    // a perspective grid on the floor
    x.globalAlpha = 0.25; x.strokeStyle = COL.vio; x.lineWidth = 1;
    for (let i = -8; i <= 8; i++) { x.beginPath(); x.moveTo(180 + i * 8, 470); x.lineTo(180 + i * 60, H); x.stroke(); }
    for (let y = 480; y < H; y += (y - 460) * 0.35) { x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
    x.globalAlpha = 1;
    // walls and arc
    for (const s of STATIC.segs) neonLine(x, s, COL.cyan, 1.6, true);
    // pins
    // pins: small, muted metal heads with no halo (drawn once). The user felt trypophobia at the field
    // of glowing dots (glow halos, bright heads), so they recede now: only a dim highlight.
    for (const p of STATIC.pins) {
      const pg = x.createRadialGradient(p[0] - 0.5, p[1] - 0.6, 0.1, p[0], p[1], PIN_R);
      pg.addColorStop(0, "#c3cbdb"); pg.addColorStop(0.5, "#6f7a92"); pg.addColorStop(1, "#2c3346");
      x.fillStyle = pg; x.beginPath(); x.arc(p[0], p[1], PIN_R * 0.85, 0, 7); x.fill();
    }
    // the 役物 body: gunmetal, lit from the top left, with a bevel
    const mg = x.createLinearGradient(YAKU.x0, ROOF_Y, YAKU.x1, YAKU.y1);
    mg.addColorStop(0, "#2a3350"); mg.addColorStop(0.45, "#141a30"); mg.addColorStop(1, "#090d1c");
    x.fillStyle = mg; x.fillRect(YAKU.x0, YAKU.y0, YAKU.x1 - YAKU.x0, YAKU.y1 - YAKU.y0);
    x.beginPath(); x.moveTo(YAKU.x0, YAKU.y0); x.lineTo(180, ROOF_Y); x.lineTo(YAKU.x1, YAKU.y0); x.closePath(); x.fill();
    x.strokeStyle = "rgba(255,255,255,0.18)"; x.lineWidth = 1;
    x.beginPath(); x.moveTo(YAKU.x0 + 3, YAKU.y1 - 3); x.lineTo(YAKU.x0 + 3, YAKU.y0 + 1); x.lineTo(180, ROOF_Y + 4); x.stroke();
    x.strokeStyle = "rgba(0,0,0,0.5)";
    x.beginPath(); x.moveTo(180, ROOF_Y + 4); x.lineTo(YAKU.x1 - 3, YAKU.y0 + 1); x.lineTo(YAKU.x1 - 3, YAKU.y1 - 3); x.lineTo(YAKU.x0 + 3, YAKU.y1 - 3); x.stroke();
    // feathers down both sides of the body (her wings), pink tips
    for (const sd of [-1, 1]) {
      const ex = sd < 0 ? YAKU.x0 + 1.5 : YAKU.x1 - 1.5;
      for (let k = 0; k < 7; k++) {
        const fy = IN.y0 + 2 + k * 16, len = 7.5 - k * 0.4;
        const fg = x.createLinearGradient(ex, fy, ex - sd * len, fy + 12);
        fg.addColorStop(0, "#e9eefb"); fg.addColorStop(1, k % 2 ? COL.mag : "#ff8fe6");
        x.fillStyle = fg; x.beginPath(); x.moveTo(ex, fy); x.lineTo(ex - sd * len, fy + 5); x.lineTo(ex, fy + 13); x.closePath(); x.fill();
      }
    }
    x.fillStyle = "#070b1a"; x.fillRect(IN.x0, IN.y0, IN.x1 - IN.x0, IN.y1 - IN.y0 + 6);
    // a soft violet glow from below in the clear interior (no pattern)
    const ig = x.createLinearGradient(0, IN.y0, 0, IN.y1);
    ig.addColorStop(0, "rgba(138,92,255,0)"); ig.addColorStop(1, "rgba(138,92,255,0.16)");
    x.fillStyle = ig; x.fillRect(IN.x0, IN.y0, IN.x1 - IN.x0, IN.y1 - IN.y0);
    neonLine(x, [YAKU.x0, YAKU.y0, 180, ROOF_Y, YAKU.x1, YAKU.y0, YAKU.x1, YAKU.y1, YAKU.x0, YAKU.y1, YAKU.x0, YAKU.y0], COL.mag, 2, true);
    for (const s of STATIC.inner) neonLine(x, s, COL.vio, 1.4, false);
    for (const p of STATIC.innerPins) { x.fillStyle = COL.pin; x.beginPath(); x.arc(p[0], p[1], 2.5, 0, 7); x.fill(); }
    // the small screen frame
    x.fillStyle = "#02040c"; x.fillRect(LCD.x0, LCD.y0, LCD.x1 - LCD.x0, LCD.y1 - LCD.y0);
    neonLine(x, [LCD.x0, LCD.y0, LCD.x1, LCD.y0, LCD.x1, LCD.y1, LCD.x0, LCD.y1, LCD.x0, LCD.y0], COL.cyan, 1, false);
    // chuckers
    for (const c of CHUCKERS) {
      neonLine(x, [c.cx - CHUCK_HALF - 2, c.cy - 6, c.cx - CHUCK_HALF - 2, c.cy + 8, c.cx + CHUCK_HALF + 2, c.cy + 8, c.cx + CHUCK_HALF + 2, c.cy - 6], COL.mag, 2, true);
      x.fillStyle = COL.mag; x.font = "bold 8px sans-serif"; x.textAlign = "center";
      x.fillText(c.opens === 2 ? "2開" : "1開", c.cx, c.cy + 18);
    }
    // the rail
    neonLine(x, [16, H, 16, 200], "rgba(33,230,255,0.25)", 6, false);
  }

  // AI art (霓虹天使's files under assets/hane/); anything missing keeps the drawn look
  const MOOD_ART = { cool: "calm", watch: "watch", chance: "wow", joy: "smile", sad: "sad", hot: "hot", od: "od" };
  function loadArt(base, onBg, onBig) {
    const a = {};
    if (!base) return a;
    const load = (k, f, cb) => { const im = new Image(); im.onload = () => { a[k] = im; if (cb) cb(); }; im.src = base + f; };
    load("bg", "bg.jpg", onBg); load("jackpot", "jackpot.jpg", () => onBig("jackpot")); load("od", "od.jpg", () => onBig("od"));
    for (const m of new Set(Object.values(MOOD_ART))) load("g_" + m, "girl_" + m + ".jpg");
    return a;
  }
  // the part of a heroine picture (fractions of its width / height) the small screen shows: her face
  const FACE = { cx: 0.5, cy: 0.45, w: 0.8 };

  function createView(canvas, game, artBase) {
    const ctx = canvas.getContext("2d");
    const stat = document.createElement("canvas");
    let scale = 1, dpr = 1;
    const fx = { flash: 0, flashCol: COL.white, rain: 0, text: "", textT: 0, mood: "", moodT: 0, pulse: 0,
      slowT: 0, zoom: 1, bigT: 0, bigText: "", odT: 0 };
    const FOCUS = { x: 180, y: 278 }, SLOW = 0.3, SLOW_SECS = 1.1, ZOOM = 1.75;
    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = canvas.clientWidth || W, ch = canvas.clientHeight || H;
      scale = Math.min(cw / W, ch / H);
      canvas.width = Math.round(W * scale * dpr); canvas.height = Math.round(H * scale * dpr);
      stat.width = canvas.width; stat.height = canvas.height;
      const s = stat.getContext("2d");
      s.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      drawStatic(s, art.bg);
      makeSprites();
      if (typeof buildBig === "function") { buildBig("jackpot"); buildBig("od"); }
    }
    const art = loadArt(artBase, () => resize(), (k) => buildBig(k));
    // the jackpot / OVERDRIVE picture composed once at screen size (a dim full-height copy behind, the
    // picture across, darkened): one drawImage a frame, where drawing the 1024 px picture twice a frame
    // cost ~40% of the fps at 4x CPU throttle. Built when the picture loads and on resize, not on the hit.
    const bigCache = {};
    function buildBig(k) {
      const pic = art[k];
      if (!pic || !stat.width) return null;
      let c = bigCache[k];
      if (c && c.width === stat.width && c.height === stat.height) return c;
      c = bigCache[k] = document.createElement("canvas");
      c.width = stat.width; c.height = stat.height;
      const g = c.getContext("2d"), sc = c.width / W, ph = W / pic.width * pic.height;
      g.setTransform(sc, 0, 0, sc, 0, 0);
      g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
      g.globalAlpha = 0.45; cover(g, pic, 0, 0, W, H); g.globalAlpha = 1;
      g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, 0, W, H);
      g.drawImage(pic, 0, H * 0.42 - ph / 2, W, ph);
      g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, 0, W, H);
      return c;
    }
    // a ball drawn once at screen resolution: a silver (or gold) sphere with a highlight
    const sprites = {};
    function makeSprites() {
      for (const [k, c0, c1, c2] of [["ball", "#ffffff", "#c7d1e4", "#4e5a74"], ["gold", "#fffbe0", "#ffd34d", "#8a5a00"]]) {
        const px = Math.max(8, Math.round((R * 2 + 2) * scale * dpr)), c = document.createElement("canvas");
        c.width = c.height = px;
        const g = c.getContext("2d"), r = px / 2;
        const gr = g.createRadialGradient(r * 0.7, r * 0.65, r * 0.08, r, r, r * 0.95);
        gr.addColorStop(0, c0); gr.addColorStop(0.5, c1); gr.addColorStop(1, c2);
        g.fillStyle = gr; g.beginPath(); g.arc(r, r, r * 0.92, 0, 7); g.fill();
        g.fillStyle = "rgba(33,230,255,0.35)"; g.beginPath(); g.arc(r * 1.25, r * 1.35, r * 0.25, 0, 7); g.fill();   // neon reflection
        sprites[k] = c;
      }
    }
    // sparks: short-lived bits of light (at most SPARK_MAX)
    const sparks = [], SPARK_MAX = 90;
    function burst(px, py, n, col, sp) {
      for (let i = 0; i < n && sparks.length < SPARK_MAX; i++) {
        const a = Math.random() * 6.283, v = (sp || 60) * (0.4 + Math.random());
        sparks.push({ x: px, y: py, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, t: 0.35 + Math.random() * 0.35, col });
      }
    }
    function drawSparks(x, dt) {
      if (!sparks.length) return;
      x.globalCompositeOperation = "lighter";
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.t -= dt; if (p.t <= 0) { sparks.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 160 * dt;
        x.globalAlpha = Math.min(1, p.t * 3); x.fillStyle = p.col; x.fillRect(p.x - 1, p.y - 1, 2, 2);
      }
      x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
    }
    resize();
    window.addEventListener("resize", resize);
    function say(text, t) { fx.text = text; fx.textT = t || 1.6; }
    const mood = (m, t) => { fx.mood = m; fx.moodT = t; };
    function onEvent(name, d) {
      if (name === "v") { fx.flash = 1; fx.flashCol = COL.gold; fx.rain = 1.4; mood("joy", 2.2); }
      if (name === "jackpot") { fx.bigT = 2.6; fx.bigText = "HACK SUCCESS"; say("やった！", 2.2); }
      if (name === "vRound") { say("継続！ まだいける！", 1.6); mood("joy", 1.6); }
      if (name === "roundStart" && d.round > 1) say("ROUND " + d.round, 1.4);
      if (name === "overdrive") { fx.bigT = 2.2; fx.bigText = "OVERDRIVE"; fx.odT = 2.2; say("オーバードライブ！", 2); }
      if (name === "bonusEnd") { say(d.rounds + " ROUNDS — ありがとう", 2.6); mood("joy", 2.6); }
      if (name === "chucker") { fx.pulse = 1; const c = CHUCKERS.find((k) => k.cx === d.x) || CHUCKERS[1]; burst(c.cx, c.cy, 10, COL.mag, 50); }
      if (name === "capture") { const wd = WINGS[d.side] || WINGS[0]; burst(wd.hx + wd.side * 18, wd.hy - 22, d.gold ? 24 : 12, d.gold ? COL.gold : COL.cyan, 70); }
      if (name === "v") burst(180, FLOOR_Y, 40, COL.gold, 120);
      if (name === "jackpot" || name === "overdrive") burst(180, 250, 60, COL.mag, 180);
      if (name === "capture") { fx.pulse = Math.max(fx.pulse, 0.6); if (game.mode === "normal") { mood("watch", 4); say("……来て", 1.5); } }
      if (name === "chance") { say("CHANCE!!", 2); mood("chance", 3); fx.flash = 0.5; fx.flashCol = COL.mag; }
      if (name === "goldCapture") { say("金の球……！", 2); mood("chance", 3.5); fx.flash = 0.7; fx.flashCol = COL.gold; }
      if (name === "vApproach" && d.decisive) { fx.slowT = SLOW_SECS; mood("watch", 2); }
      if (name === "lostIn" && d.near && (game.mode === "normal" || !game.vInRound)) { say("惜しい！", 1.6); mood("sad", 1.8); }
      else if (name === "lostIn" && game.mode === "normal") mood("sad", 1.2);
    }
    // real time -> game time: slow motion while the deciding ball meets the V window
    function timeScale(dt) {
      if (fx.slowT > 0) { fx.slowT -= dt; return SLOW; }
      return 1;
    }
    let last = 0;
    function render(dt) {
      const x = ctx, S = scale * dpr;
      // the camera: zooms in on the 役物 during the slow motion
      fx.zoom += ((fx.slowT > 0 ? ZOOM : 1) - fx.zoom) * Math.min(1, dt * (fx.slowT > 0 ? 7 : 3));
      const z = fx.zoom, ox = FOCUS.x * S * (1 - z), oy = FOCUS.y * S * (1 - z);
      x.setTransform(1, 0, 0, 1, 0, 0);
      if (z > 1.001) { x.fillStyle = COL.bg; x.fillRect(0, 0, canvas.width, canvas.height); }
      x.setTransform(z, 0, 0, z, ox, oy);
      x.drawImage(stat, 0, 0);
      x.setTransform(z * S, 0, 0, z * S, ox, oy);
      // overdrive: the field glows gold and magenta in turns
      const od = game.mode === "bonus" && game.round >= OD_ROUND;
      if (od) {
        x.globalAlpha = 0.1 + 0.06 * Math.sin(game.t * 8);
        x.fillStyle = Math.sin(game.t * 3) > 0 ? COL.gold : COL.mag; x.fillRect(0, 0, W, H);
        x.globalAlpha = 1;
      }
      // round glow: hotter with each round
      const heat = game.mode === "bonus" ? Math.min(1, game.round / 10) : 0;
      if (heat > 0) {
        x.globalAlpha = 0.25 + 0.2 * Math.sin(game.t * 6);
        neonLine(x, [YAKU.x0 - 3, YAKU.y0 - 3, YAKU.x1 + 3, YAKU.y0 - 3, YAKU.x1 + 3, YAKU.y1 + 3, YAKU.x0 - 3, YAKU.y1 + 3, YAKU.x0 - 3, YAKU.y0 - 3], heat > 0.6 ? COL.gold : COL.mag, 3, true);
        x.globalAlpha = 1;
      }
      // her halo over the roof: cyan, gold in a bonus, pink on a chance
      {
        const hc = game.mode === "bonus" ? COL.gold : game.chanceT > 0 || game.goldIn ? COL.mag : COL.cyan;
        const ha = Math.min(1, 0.55 + 0.25 * Math.sin(game.t * 2.4) + fx.pulse * 0.3);
        x.strokeStyle = hc; x.lineWidth = 5; x.globalAlpha = ha * 0.3;
        x.beginPath(); x.ellipse(180, ROOF_Y - 9, 24, 5, 0, 0, 7); x.stroke();
        x.globalAlpha = ha; x.lineWidth = 1.6;
        x.beginPath(); x.ellipse(180, ROOF_Y - 9, 24, 5, 0, 0, 7); x.stroke();
        x.globalAlpha = 1;
      }
      // the shutter with its V window
      const sx = game.shutterX();
      x.fillStyle = "rgba(138,92,255,0.55)"; x.fillRect(IN.x0 + 2, FLOOR_Y + 1, IN.x1 - IN.x0 - 4, 6);
      const vw = (game.goldIn ? GOLD_WIN : game.vWin()) + 1.5;
      if (game.chanceT > 0 || game.goldIn) {   // the announced chance: the window glows
        x.globalAlpha = 0.35 + 0.25 * Math.sin(game.t * 14); x.fillStyle = COL.gold; x.fillRect(sx - vw - 4, FLOOR_Y - 4, vw * 2 + 8, 15); x.globalAlpha = 1;
      }
      x.fillStyle = COL.gold; x.fillRect(sx - vw, FLOOR_Y, vw * 2, 7);
      x.fillStyle = "#1a1200"; x.font = "bold 7px sans-serif"; x.textAlign = "center"; x.fillText("V", sx, FLOOR_Y + 6);
      // the plate
      neonLine(x, game.plateSeg(), COL.cyan, 2.4, true);
      x.fillStyle = COL.cyan; x.beginPath(); x.arc(PLATE.cx, PLATE.cy, 3, 0, 7); x.fill();
      // the wings: robot arms (upper arm, joint, claw)
      for (let i = 0; i < 2; i++) {
        const wd = WINGS[i], ang = game.wingAngle(i);
        const tx = wd.hx + Math.cos(ang) * wd.len, ty = wd.hy + Math.sin(ang) * wd.len;
        const open = game.wings[i].a;
        neonLine(x, [wd.hx, wd.hy, tx, ty], open > 0.3 ? COL.gold : COL.mag, 4, true);
        const ca = ang + (wd.side < 0 ? 0.9 : -0.9);
        neonLine(x, [tx, ty, tx + Math.cos(ca) * 9, ty + Math.sin(ca) * 9], COL.white, 2, false);
        x.fillStyle = "#1a2244"; x.beginPath(); x.arc(wd.hx, wd.hy, 5, 0, 7); x.fill();
        x.strokeStyle = COL.cyan; x.lineWidth = 1.5; x.stroke();
      }
      // balls: a short light trail when fast, then the pre-rendered shiny ball
      x.lineCap = "round";
      for (const b of game.balls) {
        if (b.px != null) {
          const dx = b.x - b.px, dy = b.y - b.py, d2 = dx * dx + dy * dy;
          if (d2 > 9 && d2 < 900) {
            x.strokeStyle = b.gold ? "rgba(255,211,77,0.35)" : "rgba(160,220,255,0.28)"; x.lineWidth = R * 1.5;
            x.beginPath(); x.moveTo(b.px, b.py); x.lineTo(b.x, b.y); x.stroke();
          }
        }
        b.px = b.x; b.py = b.y;
        if (b.gold) { x.globalAlpha = 0.35; x.fillStyle = COL.gold; x.beginPath(); x.arc(b.x, b.y, R + 3, 0, 7); x.fill(); x.globalAlpha = 1; }
        x.drawImage(b.gold ? sprites.gold : sprites.ball, b.x - R - 1, b.y - R - 1, R * 2 + 2, R * 2 + 2);
      }
      drawSparks(x, dt);
      // the small screen: the heroine's eyes, the round, a line
      drawScreen(x, dt);
      // effects
      if (fx.rain > 0) {
        fx.rain -= dt;
        x.save(); x.beginPath(); x.rect(LCD.x0, LCD.y0, LCD.x1 - LCD.x0, LCD.y1 - LCD.y0); x.clip();
        x.fillStyle = "rgba(57,255,140,0.85)"; x.font = "7px monospace"; x.textAlign = "left";
        for (let i = 0; i < 16; i++) for (let j = 0; j < 6; j++) {
          const yy = LCD.y0 + ((game.t * 90 + i * 37 + j * 9) % 60);
          if ((i * 7 + j * 3) % 4) x.fillText(((i * j + Math.floor(game.t * 20)) % 2) ? "1" : "0", LCD.x0 + 4 + i * 6.3, yy);
        }
        x.restore();
      }
      // screen-space overlays (not zoomed)
      x.setTransform(S, 0, 0, S, 0, 0);
      if (z > 1.05) {   // the slow motion darkens the edges
        const g2 = x.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.62);
        g2.addColorStop(0, "rgba(0,0,0,0)"); g2.addColorStop(1, "rgba(0,0,0," + (0.55 * (z - 1) / (ZOOM - 1)).toFixed(3) + ")");
        x.fillStyle = g2; x.fillRect(0, 0, W, H);
      }
      if (fx.bigT > 0) drawBig(x, dt);
      if (od) {
        x.fillStyle = COL.gold; x.font = "bold 10px sans-serif"; x.textAlign = "right";
        x.globalAlpha = 0.6 + 0.4 * Math.sin(game.t * 6); x.fillText("OVERDRIVE", W - 14, 22); x.globalAlpha = 1;
      }
      if (fx.flash > 0) {
        fx.flash = Math.max(0, fx.flash - dt * 2.2);
        x.globalAlpha = fx.flash * 0.45; x.fillStyle = fx.flashCol; x.fillRect(0, 0, W, H); x.globalAlpha = 1;
      }
      fx.pulse = Math.max(0, fx.pulse - dt * 3);
      if (fx.moodT > 0) fx.moodT -= dt;
    }
    // jackpot / overdrive: a full-screen hack (code rain and a big title)
    function drawBig(x, dt) {
      fx.bigT -= dt;
      const a = Math.min(1, fx.bigT / 0.5, (2.6 - fx.bigT) / 0.2 + 0.2);
      const pic = fx.bigText === "OVERDRIVE" ? art.od : art.jackpot;
      if (pic) {
        // composed once at screen size (the dim full-height copy behind, the picture across, darkened),
        // then one drawImage a frame: drawing the 1024 px picture twice a frame cost a phone ~40% of its fps
        const bc = buildBig(fx.bigText === "OVERDRIVE" ? "od" : "jackpot");
        const zz = 1 + 0.06 * (2.6 - fx.bigT) / 2.6;   // a slow push-in
        x.globalAlpha = a; x.fillStyle = "#000"; x.fillRect(0, 0, W, H);
        x.save(); x.translate(W / 2, H * 0.42); x.scale(zz, zz); x.drawImage(bc, -W / 2, -H * 0.42, W, H); x.restore();
      } else { x.globalAlpha = 0.55 * a; x.fillStyle = "#000"; x.fillRect(0, 0, W, H); }
      x.globalAlpha = a; x.fillStyle = fx.bigText === "OVERDRIVE" ? COL.gold : "#39ff8c"; x.font = "10px monospace"; x.textAlign = "center";
      for (let i = 0; i < 16; i += pic ? 2 : 1) {
        const sp = 140 + (i * 53) % 90;
        for (let j = 0; j < 18; j++) {
          const yy = (game.t * sp + i * 71 + j * 34) % (H + 40) - 20;
          if ((i + j) % 3) x.fillText(((i * 7 + j + Math.floor(game.t * 14)) % 2) ? "1" : "0", 12 + i * 22.5, yy);
        }
      }
      const pop = 1 + 0.15 * Math.max(0, 1 - (2.6 - fx.bigT) * 3);
      x.save(); x.translate(W / 2, H * 0.42); x.scale(pop, pop);
      x.font = "900 34px sans-serif"; x.lineWidth = 8; x.strokeStyle = fx.bigText === "OVERDRIVE" ? COL.mag : COL.cyan; x.strokeText(fx.bigText, 0, 0);
      x.fillStyle = COL.white; x.fillText(fx.bigText, 0, 0);
      if (fx.bigText === "HACK SUCCESS") { x.font = "bold 16px sans-serif"; x.fillStyle = COL.gold; x.fillText("大當り", 0, 30); }
      x.restore(); x.globalAlpha = 1;
    }
    function drawScreen(x, dt) {
      const cx = (LCD.x0 + LCD.x1) / 2, ey = 172;
      const hot = game.mode === "bonus", od = hot && game.round >= OD_ROUND;
      const m = fx.moodT > 0 ? fx.mood : od ? "od" : hot ? "hot" : "cool";
      const blink = m === "cool" && (game.t % 4) < 0.12 ? 0.2 : 1;
      // her eyes: cool slits, watching the ball, wide on a chance, happy arcs, drooping when it misses
      const col = { cool: COL.cyan, watch: COL.cyan, chance: COL.gold, joy: COL.mag, sad: "#6f8fd8", hot: COL.mag, od: COL.gold }[m];
      const ball = game.balls.find((b) => b.zone === "in" || b.zone === "toIn");
      const face = art["g_" + MOOD_ART[m]];
      if (face) {
        const lw = LCD.x1 - LCD.x0, lh = LCD.y1 - LCD.y0, sw = face.width * FACE.w, sh = sw * lh / lw;
        const bob = Math.sin(game.t * 1.6) * 0.6 + (m === "chance" ? Math.sin(game.t * 30) * 0.5 : 0);
        x.save(); x.beginPath(); x.rect(LCD.x0 + 1, LCD.y0 + 1, lw - 2, lh - 2); x.clip();
        x.fillStyle = "#0b0f24"; x.fillRect(LCD.x0, LCD.y0, lw, lh);
        x.drawImage(face, face.width * FACE.cx - sw / 2, face.height * FACE.cy - sh / 2, sw, sh, LCD.x0, LCD.y0 + bob, lw, lh);
        x.fillStyle = "rgba(2,4,12,0.7)"; x.fillRect(LCD.x0, 188, lw, LCD.y1 - 188);   // a band for the text
        x.restore();
      }
      for (const s of face ? [] : [-1, 1]) {
        const ex = cx + s * 22;
        x.fillStyle = col; x.strokeStyle = col; x.lineCap = "round";
        if (m === "watch" || m === "chance") {
          const rr = m === "chance" ? 7.5 : 6, px = ball ? Math.max(-3, Math.min(3, (ball.x - 180) / 12)) : 0, py = ball ? Math.max(-2, Math.min(3, (ball.y - 250) / 30)) : 0;
          x.globalAlpha = 0.3; x.beginPath(); x.arc(ex, ey, rr + 3, 0, 7); x.fill(); x.globalAlpha = 1;
          x.lineWidth = 2; x.beginPath(); x.arc(ex, ey, rr, 0, 7); x.stroke();
          x.beginPath(); x.arc(ex + px, ey + py, m === "chance" ? 3.5 : 2.6, 0, 7); x.fill();
        } else if (m === "joy") {
          x.lineWidth = 3.2; x.beginPath(); x.moveTo(ex - 10, ey + 4); x.lineTo(ex, ey - 5); x.lineTo(ex + 10, ey + 4); x.stroke();
        } else if (m === "sad") {
          x.lineWidth = 3; x.beginPath(); x.moveTo(ex - 10, ey - 2 * s); x.lineTo(ex + 10, ey + 2 * s); x.stroke();
          x.lineWidth = 2; x.beginPath(); x.moveTo(ex - 6, ey + 6); x.lineTo(ex + 6, ey + 6); x.stroke();
        } else {
          const eh = (m === "cool" ? 3 + fx.pulse * 3 : 7) * blink;
          x.globalAlpha = 0.3; x.fillRect(ex - 13, ey - eh / 2 - 2, 26, eh + 4);
          x.globalAlpha = 1; x.fillRect(ex - 11, ey - eh / 2, 22, eh);
          if (m === "od") { x.fillStyle = COL.white; x.fillRect(ex - 2 + 6 * Math.sin(game.t * 9 + s), ey - 1, 3, 2); }
        }
      }
      const eyeCol = col;
      x.textAlign = "center";
      if (fx.textT > 0) {
        fx.textT -= dt;
        x.fillStyle = COL.white; x.font = "bold 11px sans-serif"; x.fillText(fx.text, cx, 196);
      } else if (hot) {
        x.fillStyle = eyeCol; x.font = "bold 10px sans-serif";
        x.fillText("ROUND " + game.round + "/" + MAX_ROUNDS + "   " + game.count + "/" + ROUND_COUNT, cx, 196);
      } else {
        x.fillStyle = "rgba(159,182,216,0.8)"; x.font = "9px sans-serif";
        x.fillText(game.openQ > 0 || game.opening ? "ARM OPEN" : "STANDBY", cx, 196);
      }
    }
    return { render, onEvent, resize, timeScale };
  }

  // ---------------------------------------------------------------- public
  PK.Hane = {
    W, H,
    create(opts) {
      opts = opts || {};
      let view = null;
      const game = createGame(Object.assign({}, opts, { onEvent: (n, d) => { if (view) view.onEvent(n, d); if (opts.onEvent) opts.onEvent(n, d); } }));
      if (opts.canvas) view = createView(opts.canvas, game, opts.art);
      let raf = 0, lastTs = 0;
      function frame(ts) {
        raf = requestAnimationFrame(frame);
        const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60;
        lastTs = ts;
        game.step(dt * (view ? view.timeScale(dt) : 1));
        if (view) view.render(dt);
      }
      if (opts.canvas) raf = requestAnimationFrame(frame);
      game.stop = () => cancelAnimationFrame(raf);
      return game;
    },
    // Headless: plays `seconds` of auto-fire at `power` and returns the stats.
    simulate(seconds, opts) {
      opts = opts || {};
      const g = createGame({ seed: opts.seed || 12345, power: opts.power != null ? opts.power : 0.55, chips: 1e9 });
      g.setFiring(true);
      const dt = 1 / 60;
      for (let t = 0; t < seconds; t += dt) g.step(dt);
      const s = Object.assign({}, g.stats);
      const shot = s.fired - s.foul;
      s.minutes = seconds / 60;
      s.chuckerPer100 = (100 * s.chucker) / Math.max(1, shot);
      s.capturePerOpen = s.capturedN / Math.max(1, s.opens);   // normal play
      s.vPerCapture = s.v / Math.max(1, s.captured);
      s.contRate = 1 - 1 / Math.max(1, s.rounds / Math.max(1, s.jackpots));
      s.minPerJackpot = s.normalT / 60 / Math.max(1, s.jackpots);   // minutes of normal play per jackpot
      s.bonusMin = s.bonusT / 60 / Math.max(1, s.jackpots);
      s.roundsPerJackpot = s.rounds / Math.max(1, s.jackpots);
      s.payout = s.paid / Math.max(1, shot);
      return s;
    },
    _consts: { CHANCE_RATE, GOLD_RATE, OD_ROUND, CHUCKERS, WINGS, GAP, SHUTTER, PLATE, YAKU, IN },
  };
})();
