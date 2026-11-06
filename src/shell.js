// 炎舞神龍 — the shell. Stage scaling, top bar, data counter, controls, menus, help, save/load,
// and the wiring between PK.createEngine, PK.Cabinet, PK.LCD and PK.Sound (dev/CONTRACT.md).
// The engine decides; the shell times every step and tells the other modules what to show.
(function () {
  "use strict";
  const PK = window.PK, L = PK.L, t = PK.t;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.floor(n).toLocaleString("en-US");

  // The machine being played: the one picked in the lobby (選擇機台), else the first one.
  const KEY_MACHINE = "pk.machine";
  const picked = PK.MACHINES[(function () { try { return localStorage.getItem(KEY_MACHINE); } catch (e) { return null; } })()];
  if (picked && picked.page && !picked.hidden) { location.replace(picked.page); return; }   // a machine with a page of its own
  const M = picked && !picked.page ? picked : PK.MACHINES.enbu;
  Object.assign(PK.TEXT, M.text);

  const VERSION = PK.VERSION;   // in src/machines.js

  // ---------------------------------------------------------------- storage
  // localStorage can be missing or throw (private windows, previews): the game still runs.
  const KEY_SAVE = "pk." + M.id + ".save", KEY_DAY = "pk." + M.id + ".day", KEY_SET = "pk.settings", KEY_VER = "pk.version";
  const load = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* not saved */ } };
  const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };

  const set = Object.assign({ dataOpen: false, saver: false, sound: true, volume: 0.8, captions: true, speed: 1, autoPush: false, fireMode: "auto", autoAim: true, power: 0.4, voice: true, tutorialSeen: false,
    wakeMin: 5, showFps: false, remind: true }, parse(load(KEY_SET)));
  const saveSettings = () => store(KEY_SET, JSON.stringify(set));
  // Once, for players from before v58: 打珠「自動」 turns 自動PUSH on too (settings are shared by all machines).
  if (!set.autoAll) { if (set.fireMode === "auto") set.autoPush = true; set.autoAll = true; saveSettings(); }

  // ---------------------------------------------------------------- 機率調整
  // Each player can pick the odds on their own phone (設定 → 機率調整): the machine's presets
  // (M.odds) over its own numbers, kept per machine (set.odds[id] = { hitN, rushN }, 1/n per spin;
  // none = the machine's own). A change applies on a reload, so one engine always runs on one set
  // of tables; the save and the records are kept.
  const ODDS = M.odds || PK.MACHINES.enbu.odds;
  if (set.hitN || set.rushN) {   // before v47 the odds were one setting for all (only 炎舞神龍 existed)
    set.odds = Object.assign({ enbu: { hitN: set.hitN || null, rushN: set.rushN || null } }, set.odds);
    delete set.hitN; delete set.rushN;
    saveSettings();
  }
  const myOdds = () => (set.odds && set.odds[M.id]) || {};
  function setMyOdds(o) {
    set.odds = Object.assign({}, set.odds);
    if (o) set.odds[M.id] = o; else delete set.odds[M.id];
  }
  function odds() {
    const sp = Object.assign({}, PK.engineTables.spec, M.engine && M.engine.spec);
    const own = (c) => Math.round(10 / c) / 10, my = myOdds();
    return { hitN: my.hitN || own(sp.normalChance), rushN: my.rushN || own(sp.rushChance), st: sp.st };
  }
  const rushPct = (rushN, st) => Math.round(100 * (1 - Math.pow(1 - 1 / rushN, st)));
  const oddsTables = () => ({ spec: { normalChance: 1 / odds().hitN, rushChance: 1 / odds().rushN } });
  // The machine's RUSH-rate texts are templates: fill them with the odds in use.
  (function () {
    const p = rushPct(odds().rushN, odds().st);
    ["lcd.rushRate", "cab.subDefault", "gl.rate"].forEach((k) => { if (M.text[k]) PK.TEXT[k] = t(k, { p, n: Math.round(p / 10) }); });
  })();
  const today = () => new Date().toDateString();

  // ---------------------------------------------------------------- static text
  function fillText() {
    document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
    $("crest").textContent = M.crest;
    $("title").textContent = M.name;
    if (M.name.length > 5) { $("title").style.fontSize = "17px"; $("title").style.letterSpacing = "1px"; }   // 轉生史萊姆與魔劍 ran into the ball count
    $("cSerial").textContent = M.serial;
    $("menuBtn").setAttribute("aria-label", t("ui.menu"));
    $("infoBtn").setAttribute("aria-label", t("ui.help"));
    // 名詞說明: the flow of one game, then terms grouped by where the player meets them
    const gl = $("glList");
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    gl.appendChild(el("h3", null, t("gl.flowTitle")));
    const flow = el("ol", "flow");
    t("gl.flow").split("|").forEach((step, i) => {
      if (i) flow.appendChild(el("li", "arrow", "→")).setAttribute("aria-hidden", "true");
      flow.appendChild(el("li", null, step));
    });
    gl.appendChild(flow);
    GLOSSARY.forEach(([head, keys]) => {
      gl.appendChild(el("h3", null, t(head)));
      const dl = el("dl");
      keys.forEach((k) => {
        const [term, def] = t(k).split("|");
        dl.appendChild(el("dt", null, term)); dl.appendChild(el("dd", null, def));
      });
      gl.appendChild(dl);
    });
  }

  const GLOSSARY = [
    ["glg.buttons", ["gl.handle", "gl.power", "gl.push", "gl.auto", "gl.right"]],
    ["glg.numbers", ["gl.balls", "gl.serial", "gl.sinceHit", "gl.totalSpins", "gl.todayHits", "gl.history", "gl.hold", "gl.st", "gl.sub"]],
    ["glg.win", ["gl.spin", "gl.reach", "gl.jackpot", "gl.round", "gl.upgrade", "gl.boss", "gl.awaken", "gl.rush", "gl.rate", "gl.jitan"]],
    ["glg.hints", ["gl.holdColor", "gl.stepup", "gl.gun", "gl.cutin", "gl.pseudo", "gl.battle", "gl.hot", "gl.kokuchi", "gl.revive", "gl.zone", "gl.reachVar", "gl.serif", "gl.premium", "gl.pushLong", "gl.zen", "gl.stLast"]],
  ].concat(M.devour ? [["glg.own", ["gl.vortex", "gl.awake", "gl.commanders", "gl.maou", "gl.renzen"]]] : []);   // 轉生史萊姆與魔劍's own rules first

  // ---------------------------------------------------------------- 力道旋鈕
  // The PLAY/STOP button is also the handle's knob. Its power 0..1 is drawn as a dot on a coloured
  // arc in the socket. Power 0 is at the lower left and 1 at the lower right, clockwise (the
  // socket's ticks: SVG angles 150..390 degrees); with 力道 自己調 a finger on the arc sets it.
  // Left lane: best 0.32-0.48 (green), nothing below 0.14 or from 0.66; right (右打): from 0.74,
  // full from 0.82 (red). Otherwise the knob turns itself and every ball is aimed perfectly.
  // zones: [from, to, colour, label key, label colour, best?]
  const KNOB = { R: L.handle.r + 12, hit: L.handle.r + 24, a0: 150, span: 240, auto: { left: 0.4, right: 0.91 },
    zones: [[0, 0.14, "#7a8292", "ui.zWeak", "#0a2a78"], [0.14, 0.32, "#ffd84a", "ui.zLeft", "#0a2a78"], [0.32, 0.48, "#3dff8a", "ui.zLeftBest", "#06733a", true],
      [0.48, 0.66, "#ffd84a", "ui.zLeft", "#0a2a78"], [0.66, 0.74, "#7a8292", "ui.zStrong", "#0a2a78"], [0.74, 0.82, "#ff9a3a", "ui.zRight", "#a33a00"], [0.82, 1, "#ff3a2a", "ui.zRightBest", "#c01800", true]] };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  function shotOf(pw) {
    if (pw >= 0.74) return { side: "right", eff: clamp01((pw - 0.74) / 0.08) };
    return { side: "left", eff: clamp01(1 - Math.max(0, Math.abs(pw - 0.4) - 0.08) / 0.18) };
  }
  function knobXY(pw, r) {
    const a = (KNOB.a0 + KNOB.span * pw) * Math.PI / 180;
    return [KNOB.R + r * Math.cos(a), KNOB.R + r * Math.sin(a)];
  }
  const zoneOf = (pw) => KNOB.zones.find((z) => pw <= z[1]) || KNOB.zones[KNOB.zones.length - 1];
  function arcD(p0, p1, r) {
    const [x0, y0] = knobXY(p0, r), [x1, y1] = knobXY(p1, r);
    return "M" + x0.toFixed(1) + "," + y0.toFixed(1) + " A" + r + "," + r + " 0 " + (KNOB.span * (p1 - p0) > 180 ? 1 : 0) + " 1 " + x1.toFixed(1) + "," + y1.toFixed(1);
  }
  // A neon gauge in the socket: the dim zones, a glowing fill up to the power in its zone's colour,
  // a bright orb with a short trail, and a ring of light that bursts on reaching a best zone.
  function buildKnob() {
    const svg = $("knob"), d = 2 * KNOB.R, r = L.handle.r + 4;
    svg.setAttribute("width", d); svg.setAttribute("height", d); svg.setAttribute("viewBox", "0 0 " + d + " " + d);
    let h = '<defs><filter id="kGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.6" result="b"/>' +
      '<feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';
    KNOB.zones.forEach(([p0, p1, c]) => { h += '<path d="' + arcD(p0, p1, r) + '" fill="none" stroke="' + c + '" stroke-width="6" stroke-opacity=".3"/>'; });
    h += '<path id="kFill" fill="none" stroke-width="7" stroke-linecap="round" filter="url(#kGlow)"/>';
    for (let i = 3; i >= 1; i--) h += '<circle class="kTrail" id="kT' + i + '" r="' + (7 - i) + '" fill="#fff" opacity="0"/>';
    h += '<circle id="kBurst" r="8" fill="none" stroke-width="3" opacity="0"/>';
    h += '<circle id="knobDot" r="7" fill="#ffffff" stroke-width="2.5" filter="url(#kGlow)"/>';
    svg.innerHTML = h;
  }
  const knobTrail = [];
  function drawKnob(pw) {
    const r = L.handle.r + 4, z = zoneOf(pw), [x, y] = knobXY(pw, r);
    const fill = $("kFill"), dot = $("knobDot");
    fill.setAttribute("d", arcD(0, Math.max(0.004, pw), r)); fill.setAttribute("stroke", z[2]);
    dot.setAttribute("cx", x.toFixed(1)); dot.setAttribute("cy", y.toFixed(1)); dot.setAttribute("stroke", z[2]);
    knobTrail.unshift(pw); knobTrail.length = Math.min(knobTrail.length, 10);
    for (let i = 1; i <= 3; i++) {
      const tp = knobTrail[i * 3] != null ? knobTrail[i * 3] : pw, [tx, ty] = knobXY(tp, r), el = $("kT" + i);
      el.setAttribute("cx", tx.toFixed(1)); el.setAttribute("cy", ty.toFixed(1)); el.setAttribute("fill", z[2]);
      el.setAttribute("opacity", Math.abs(tp - pw) > 0.004 ? String(0.5 - i * 0.13) : "0");
    }
    // the grip spins faster the harder the shot
    $("handle").querySelector(".grip").style.animationDuration = (1.5 - 1.1 * pw).toFixed(2) + "s";
  }
  function knobBurst(pw) {
    const b = $("kBurst"), [x, y] = knobXY(pw, L.handle.r + 4);
    b.setAttribute("cx", x.toFixed(1)); b.setAttribute("cy", y.toFixed(1)); b.setAttribute("stroke", zoneOf(pw)[2]);
    b.classList.remove("go"); void b.getBBox(); b.classList.add("go");
    try { if (navigator.vibrate) navigator.vibrate(18); } catch (e) { /* no vibration */ }
  }

  // ---------------------------------------------------------------- stage scaling
  // Uniform scale to fit; the machine sits near the data counter and leftover height becomes
  // the lit floor below it.
  // Console controls sit on the cabinet's sockets (PK.L, design units).
  function placeControls() {
    const H = L.handle, P = L.push, Q = L.panel, I = L.infoBtn;
    const at = (id, x, y) => { $(id).style.left = x + "px"; $(id).style.top = y + "px"; };
    at("handle", H.cx - H.r, H.cy - H.r);
    at("knob", H.cx - KNOB.R, H.cy - KNOB.R);
    at("knobHit", H.cx - KNOB.hit, H.cy - KNOB.hit);
    at("push", P.x + (P.w - 116) / 2, P.y + 14);
    at("panel", Q.x + (Q.w - 176) / 2, Q.y + 8);
    at("infoBtn", I.x, I.y);
  }
  // The stage fills the height when the phone is tall enough: its outer frame may run off the sides
  // by up to SIDE_CROP of its width (2% a side: the 總玉數 panel starts 12 units in), so a narrow
  // phone shows the machine a little bigger instead of leaving a band of empty space under it.
  const SIDE_CROP = 0.04;
  function fit() {
    const wrap = $("stageWrap"), w = wrap.clientWidth, h = wrap.clientHeight;
    const s = Math.min(h / L.stage.h, w / (L.stage.w * (1 - SIDE_CROP)));
    const x = (w - L.stage.w * s) / 2, y = Math.max(0, (h - L.stage.h * s) * 0.5);
    $("stage").style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) scale(" + s.toFixed(4) + ")";
  }

  // ---------------------------------------------------------------- 螢幕保持開啟
  // While the player is playing the screen stays on (Screen Wake Lock), for set.wakeMin minutes after
  // the last touch (0 = the phone's own setting); then the phone may turn it off, so a game left on
  // auto never runs all night. A hidden page loses the lock, so it is asked for again on return.
  let wakeLock = null, wakeAsking = false, lastTouch = Date.now();
  function wake() {
    const want = set.wakeMin > 0 && !document.hidden && Date.now() - lastTouch < set.wakeMin * 60000;
    if (want && !wakeLock && !wakeAsking && navigator.wakeLock) {
      wakeAsking = true;
      navigator.wakeLock.request("screen").then((l) => {
        wakeAsking = false; wakeLock = l;
        l.addEventListener("release", () => { if (wakeLock === l) wakeLock = null; });
      }, () => { wakeAsking = false; });
    } else if (!want && wakeLock) { const l = wakeLock; wakeLock = null; l.release().catch(() => {}); }
  }
  document.addEventListener("pointerdown", () => { lastTouch = Date.now(); wake(); }, { capture: true, passive: true });
  document.addEventListener("visibilitychange", wake);
  setInterval(wake, 15000);

  // ---------------------------------------------------------------- 提示字幕
  const capLast = {};
  let capTimer = 0;
  function caption(key, vars) {
    if (!set.captions) return;
    const now = Date.now();
    if (capLast[key] && now - capLast[key] < 45000) return;   // same tip at most every 45 s
    capLast[key] = now;
    const el = $("caption");
    el.lastChild.textContent = t("cap." + key, vars);
    el.classList.add("show");
    clearTimeout(capTimer);
    capTimer = setTimeout(() => el.classList.remove("show"), 3800);
  }
  let toastTimer = 0;
  function toast(msg, ms) {
    const el = $("toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || 2200);
  }

  // ---------------------------------------------------------------- 我的紀錄 + 成就
  // Kept apart from the game save: 重新開始 starts a new game but keeps the player's records.
  const KEY_REC = "pk." + M.id + ".records";
  const ACH = ["first", "rush", "s3", "s5", "s10", "r10", "boss", "boss10", "awaken", "spsp", "rainbow", "revive", "premium", "rich", "hits100"];
  let queueToast = null;   // toasts that wait their turn (achievements, missions, levels)
  let replaying = false;   // a 演出鑑賞 replay: counts toward nothing
  const rec = (function () {
    const r = Object.assign({ hits: 0, rushes: 0, bestStreak: 0, bestBonus: 0, bestRush: 0, boss: 0, got: {}, seen: {} }, parse(load(KEY_REC)));
    const keep = () => store(KEY_REC, JSON.stringify(r));
    const best = (k, v) => { if (v > r[k]) r[k] = v; };
    // unlock toasts wait their turn, so two at once are both read
    const queue = [];
    function nextToast() {
      if (!queue.length) return;
      snd("coin"); toast(queue[0]);
      setTimeout(() => { queue.shift(); nextToast(); }, 2500);
    }
    queueToast = (msg) => { queue.push(msg); if (queue.length === 1) nextToast(); };
    function ach(id) {
      if (replaying || r.got[id]) return;
      r.got[id] = Date.now();
      queueToast(t("rec.unlocked", { name: t("ach." + id).split("|")[0] }));
    }
    return {
      data: r, ach: (id) => { ach(id); keep(); },
      seen(id) {   // 演出鑑賞: the first time an 演出 plays, it joins the gallery
        if (replaying || r.seen[id] || !EXHIBIT.some((x) => x[0] === id)) return;
        r.seen[id] = Date.now(); keep();
        queueToast(t("ex.new", { name: t("ex." + id).split("|")[0] }));
      },
      hit(kind, streak, reach) {
        r.hits++; best("bestStreak", streak);
        ach("first");
        if (streak >= 3) ach("s3");
        if (streak >= 5) ach("s5");
        if (streak >= 10) ach("s10");
        if (kind === "10R") ach("r10");
        if (reach && reach.type === "spsp") ach("spsp");
        if (r.hits >= 100) ach("hits100");
        keep();
      },
      rush() { r.rushes++; ach("rush"); keep(); },
      bonusEnd(gained) { best("bestBonus", gained); keep(); },
      rushEnd(streak, gained) { best("bestStreak", streak); best("bestRush", gained); if (gained >= 10000) ach("rich"); keep(); },
      boss() { r.boss++; ach("boss"); if (r.boss >= 10) ach("boss10"); keep(); },
    };
  })();
  // ---------------------------------------------------------------- 演出鑑賞
  // Every 演出 seen in play is kept (rec.seen) and can be replayed on the machine from the menu:
  // [id, the spin script that shows it]. A replay plays only on the LCD (no balls, no engine) and
  // counts toward no record, achievement or mission.
  const RX = (type, color, extra) => Object.assign({ type, color, push: false, revive: false }, extra || {});
  const WIN = (f) => ({ hit: true, kind: "3R", final: [f, f, f] });
  const EXHIBIT = [
    ["reach", { final: [4, 5, 4], reach: RX("normal", "blue") }],
    ["chanceUp", Object.assign(WIN(6), { reach: RX("normal", "gold"), extras: { from: "red" } })],
    ["count", Object.assign(WIN(2), { reach: RX("normal", "red"), extras: { count: true } })],
    ["slip", Object.assign(WIN(5), { reach: RX("normal", "red"), extras: { slip: true } })],
    ["devTease", { final: [8, 2, 8], reach: RX("normal", "blue"), extras: { tease: "fail" } }],
    ["sp", Object.assign(WIN(5), { reach: RX("sp", "red") })],
    ["battleWin", Object.assign(WIN(7), { reach: RX("battle", "red", { push: true }) })],
    ["battleLose", { final: [6, 7, 6], reach: RX("battle", "blue", { push: true }) }],
    ["revive", Object.assign(WIN(1), { reach: RX("sp", "gold", { revive: true }) })],
    ["spsp", Object.assign(WIN(9), { reach: RX("spsp", "rainbow", { push: true }) })],
    ["stepup", { final: [1, 9, 4], stepup: 5 }],
    ["gun", { final: [6, 2, 6], gun: true, reach: RX("normal", "red") }],
    ["pseudo", { final: [5, 3, 7], pseudo: 3 }],
    ["cutinGold", Object.assign(WIN(8), { cutin: "gold", reach: RX("normal", "gold") })],
    ["serifGold", Object.assign(WIN(5), { serif: "gold", reach: RX("normal", "red") })],
    ["holdRainbow", Object.assign(WIN(3), { holdColor: "gold", holdChangeTo: "rainbow", reach: RX("normal", "gold") })],
    ["zone", Object.assign(WIN(2), { zoneLast: true, reach: RX("normal", "red") })],
    ["kokuchi", Object.assign(WIN(3), { kokuchi: true, reach: RX("normal", "gold") })],
    ["premium", Object.assign(WIN(3), { premium: true, reach: RX("normal", "blue") })],
    ["pushLong", Object.assign(WIN(7), { longPush: true, reach: RX("battle", "gold", { push: true }) })],
  ];
  let exPlay = null;   // set at boot: (script) => plays it, or false when the machine is busy
  function showGallery() {
    const ul = $("exList"), seen = rec.data.seen;
    ul.innerHTML = "";
    $("exHead").textContent = t("ex.head", { n: EXHIBIT.filter((x) => seen[x[0]]).length, m: EXHIBIT.length });
    EXHIBIT.forEach(([id, sc]) => {
      const [name, how] = t("ex." + id).split("|"), got = !!seen[id];
      const li = document.createElement("li");
      li.className = got ? "got" : "";
      li.innerHTML = "<div><b></b><small></small></div>";
      li.querySelector("b").textContent = name;
      li.querySelector("small").textContent = got ? how : t("ex.locked");
      if (got) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "exPlay"; b.textContent = t("ex.play");
        b.addEventListener("click", () => { if (exPlay && exPlay(sc) === false) toast(t("ex.busy")); });
        li.appendChild(b);
      }
      ul.appendChild(li);
    });
  }

  // ---------------------------------------------------------------- 每日任務 + 等級
  // Three missions a day, the same three all day (picked from MISSIONS by the date), each paying
  // balls and 經驗. 經驗 also comes from every jackpot and 龍兵; levels bring titles. Kept with the
  // records, so 重新開始 keeps them. The shell sets mis.pay (it owns the engine).
  const MISSIONS = [   // [id, goal, balls, 經驗]
    ["spins", 150, 300, 30], ["reach", 8, 300, 30], ["hit", 1, 500, 50], ["boss", 2, 500, 50],
    ["sp", 1, 400, 40], ["fire", 1500, 300, 30], ["streak", 2, 800, 80], ["push", 3, 300, 30],
  ];
  const XP = { hit: 10, boss: 5 };
  const LV_TITLE_AT = [1, 3, 6, 10, 15];   // the level each title in lv.titles starts at
  const xpFor = (lv) => 100 * lv;          // 經驗 from level lv to lv + 1
  const LOGIN = [200, 300, 400, 500, 600, 800, 1000];   // balls on day 1..7 in a row, then day 7's
  const mis = (function () {
    const r = rec.data;
    r.lv = Object.assign({ n: 1, xp: 0 }, r.lv);
    let saveT = 0;
    const save = (now) => { clearTimeout(saveT); if (now) store(KEY_REC, JSON.stringify(r)); else saveT = setTimeout(() => save(true), 3000); };
    function todays() {
      const d = today();
      if (!r.day || r.day.date !== d) {
        let h = 2166136261;   // the date picks three different missions
        for (const c of d) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
        const pool = MISSIONS.map((m) => m[0]), ids = [];
        while (ids.length < 3) { h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0; ids.push(pool.splice(h % pool.length, 1)[0]); }
        r.day = { date: d, ids, prog: {}, done: {} };
        save(true);
      }
      return r.day;
    }
    const title = () => { const ts = t("lv.titles").split("|"); let k = 0; LV_TITLE_AT.forEach((at, i) => { if (r.lv.n >= at) k = i; }); return ts[k]; };
    function gainXp(n) {
      r.lv.xp += n;
      while (r.lv.xp >= xpFor(r.lv.n)) {
        r.lv.xp -= xpFor(r.lv.n); r.lv.n++;
        queueToast(t("lv.up", { n: r.lv.n, title: title() }));
      }
    }
    function step(id, v, isMax) {
      const day = todays();
      if (day.ids.indexOf(id) < 0 || day.done[id]) return;
      const m = MISSIONS.find((x) => x[0] === id);
      day.prog[id] = isMax ? Math.max(day.prog[id] || 0, v) : (day.prog[id] || 0) + v;
      if (day.prog[id] >= m[1]) {
        day.prog[id] = m[1]; day.done[id] = true;
        if (mis.pay) mis.pay(m[2]);
        queueToast(t("ms.done", { name: t("ms." + id, { n: m[1] }), n: fmt(m[2]) }));
        gainXp(m[3]);
        save(true);
      } else save(id === "fire" ? false : true);
    }
    // 每日登入: the first visit of a day pays, more on each day in a row (a missed day starts over).
    const loginPay = (d) => LOGIN[Math.min(d, LOGIN.length) - 1];
    function login() {
      const d = today(), L = r.login || {};
      if (L.last === d) return null;
      const y = new Date(); y.setDate(y.getDate() - 1);
      const streak = L.last === y.toDateString() ? (L.streak || 0) + 1 : 1;
      r.login = { last: d, streak };
      save(true);
      return { streak, n: loginPay(streak) };
    }
    return {
      pay: null, login, loginPay,
      add(id, n) { step(id, n || 1, false); },
      max(id, v) { step(id, v, true); },
      xp(kind) { gainXp(XP[kind] || 0); save(true); },
      title, todays, data: r,
    };
  })();
  // ---------------------------------------------------------------- 遊戲大廳 (home)
  // The site opens here (珠光遊樂館): a card per machine in PK.MACHINES, the last one played first
  // (繼續玩), each with its own balls, then one for the machine still being made. The machine last
  // played is loaded behind it, so picking it just closes the hall; picking another saves the choice
  // and reloads straight into it (KEY_ENTER, once). Each machine keeps its own balls, save and records.
  const KEY_ENTER = "pk.enter";
  // The machine rests while the hall is up (the user: it kept playing behind the hall): the shell
  // sets hallRest at boot to stop shooting and the sound; it is called with false on the way back in.
  let hallRest = null;
  function showHome(onEnter) {
    if (hallRest) hallRest(true);
    const ul = $("homeList");
    ul.innerHTML = "";
    const card = (m, on, click) => {
      const li = document.createElement("li");
      li.className = on ? "on" : "";
      li.innerHTML = '<span class="pic"><em></em></span><div class="info"><b></b><small></small><span class="row"><i></i><u></u></span></div>';
      if (m && m.card) li.querySelector(".pic").style.backgroundImage = "url(" + m.assetsBase + m.card + ")";
      if (m && m.preview) {   // the machine itself, in front of its art
        const im = document.createElement("img");
        im.className = "mach"; im.alt = ""; im.src = m.assetsBase + m.preview;
        im.onerror = () => im.remove();
        li.querySelector(".pic").appendChild(im);
      }
      li.querySelector("em").textContent = on ? t("hall.last") : "";
      li.querySelector("b").textContent = m ? m.name : t("lobby.soon");
      li.querySelector("small").textContent = m ? m.tagline || "" : t("lobby.soonBody");
      if (m) {
        const sv = parse(load("pk." + m.id + ".save"));
        const n = sv && sv.S && sv.S.chips != null ? sv.S.chips : PK.engineTables.units.startChips;
        li.querySelector("i").textContent = t("hall.balls", { n: fmt(n) });
        li.querySelector("u").textContent = t(on ? "hall.continue" : "hall.play");
      } else li.classList.add("soon");
      if (click) { li.tabIndex = 0; li.setAttribute("role", "button"); li.addEventListener("click", click); }
      return ul.appendChild(li);
    };
    const ids = Object.keys(PK.MACHINES).filter((id) => !PK.MACHINES[id].hidden);
    ids.sort((a, b) => (PK.MACHINES[b] === M) - (PK.MACHINES[a] === M));
    ids.forEach((id) => {
      const m = PK.MACHINES[id], on = m === M;
      card(m, on, on ? () => { $("home").hidden = true; PK.Cabinet.pause(false); if (hallRest) hallRest(false); snd("button"); onEnter(); }
        : () => { store(KEY_MACHINE, id); try { sessionStorage.setItem(KEY_ENTER, "1"); } catch (e) { /* the hall shows again */ } if (m.page) location.href = m.page; else location.reload(); });
    });
    card(null, false, null);
    $("home").hidden = false;
    PK.Cabinet.pause(true);
  }
  function showMissions() {
    const r = mis.data, day = mis.todays(), ul = $("msList");
    $("msLevel").textContent = t("lv.level", { n: r.lv.n, title: mis.title() });
    $("msXp").style.width = Math.round((100 * r.lv.xp) / xpFor(r.lv.n)) + "%";
    $("msXpTxt").textContent = t("lv.xp", { a: r.lv.xp, b: xpFor(r.lv.n) });
    const d = (r.login && r.login.streak) || 1;
    $("msLogin").textContent = t("login.line", { d, n: fmt(mis.loginPay(d + 1)) });
    ul.innerHTML = "";
    day.ids.forEach((id) => {
      const m = MISSIONS.find((x) => x[0] === id), v = day.prog[id] || 0, li = document.createElement("li");
      if (day.done[id]) li.className = "got";
      li.innerHTML = "<i aria-hidden=\"true\"></i><div><b></b><small></small><span class=\"bar\"><u></u></span></div>";
      li.querySelector("i").textContent = day.done[id] ? "✓" : "";
      li.querySelector("b").textContent = t("ms." + id, { n: fmt(m[1]) });
      li.querySelector("small").textContent = t("ms.reward", { a: fmt(v), b: fmt(m[1]), n: fmt(m[2]), x: m[3] });
      li.querySelector("u").style.width = Math.round((100 * v) / m[1]) + "%";
      ul.appendChild(li);
    });
  }
  // 珠子走勢: the balls after every spin of this game (the engine keeps them, halving the samples as
  // they grow), drawn like the slump graph of a real data counter. Up = more balls than at the start.
  let gameStats = null;   // set at boot: () => the engine's state
  function drawSlump() {
    const cv = $("recSlump"), s = gameStats && gameStats();
    if (!cv || !s) return;
    const pts = s.stats.slump.concat([s.chips]), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth || 300, h = cv.clientHeight || 130;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const base = pts[0], lo = Math.min(base, ...pts), hi = Math.max(base, ...pts), span = Math.max(1, hi - lo);
    const pad = 8, X = (i) => pad + ((w - 2 * pad) * i) / Math.max(1, pts.length - 1), Y = (v) => pad + ((h - 2 * pad) * (hi - v)) / span;
    g.strokeStyle = "rgba(255,255,255,0.18)"; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(pad, Y(base)); g.lineTo(w - pad, Y(base)); g.stroke(); g.setLineDash([]);
    // the area to the start line: gold above (more balls), red below
    [["rgba(255,201,77,0.35)", (v) => Math.max(v, base)], ["rgba(255,78,58,0.35)", (v) => Math.min(v, base)]].forEach(([col, f]) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(X(0), Y(base));
      pts.forEach((v, i) => g.lineTo(X(i), Y(f(v))));
      g.lineTo(X(pts.length - 1), Y(base)); g.closePath(); g.fill();
    });
    g.strokeStyle = "#ffc94d"; g.lineWidth = 2; g.lineJoin = "round"; g.beginPath();
    pts.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.stroke();
    const d = s.chips - base;
    $("recSlumpCap").textContent = t("rec.slumpCap", { n: fmt(s.stats.totalSpins), d: (d >= 0 ? "+" : "−") + fmt(Math.abs(d)), max: fmt(s.stats.maxChips) });
  }
  function showRecords() {
    const r = rec.data, dl = $("recStats"), ul = $("recAch");
    dl.innerHTML = ""; ul.innerHTML = "";
    const add = (parent, tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return parent.appendChild(e); };
    [["rec.hits", "rec.times", r.hits], ["rec.rushes", "rec.times", r.rushes], ["rec.bestStreak", "rec.streak", r.bestStreak],
      ["rec.bestBonus", "rec.balls", r.bestBonus], ["rec.bestRush", "rec.balls", r.bestRush], ["rec.boss", "rec.times", r.boss]].forEach(([k, u, v]) => {
      add(dl, "dt", null, t(k)); add(dl, "dd", null, t(u, { n: fmt(v) }));
    });
    $("recAchHead").textContent = t("rec.achHead", { n: ACH.filter((id) => r.got[id]).length, m: ACH.length });
    ACH.forEach((id) => {
      const [name, how] = t("ach." + id).split("|"), li = add(ul, "li", r.got[id] ? "got" : null);
      add(li, "i", null, r.got[id] ? "★" : "☆").setAttribute("aria-hidden", "true");
      const d = add(li, "div"); add(d, "b", null, name); add(d, "small", null, how);
    });
  }

  // ---------------------------------------------------------------- 日文配音
  // Voice lines by moment (assets/vo_<name>.wav, from assets/voice_jobs.json on the PC): the
  // narrator calls the 演出, the hero speaks in fights. The hero's attack lines take turns.
  // A line with more takes (VO_TAKES: reach, reach_2, reach_3) plays one of them at random, so the
  // frequent ones do not repeat word for word; a take not loaded yet falls back to the first.
  const VO_TAKES = { reach: 3, jackpot: 3, push: 2, rushCont: 2, final: 2, win: 2, minionStart: 2, minionDown: 2 };
  const VOICE_LINES = ["reach", "spReach", "spsp", "battle", "push", "jackpot", "rushIn", "rushEnd", "chance", "hot",
    "atk1", "atk2", "atk3", "atk4", "atk5", "final", "win", "lose", "revive", "minionStart", "minionDown", "awakenCall", "awakenOk", "awakenNg",
    "zone", "zoneLast", "zen", "stLast", "chanceUp", "rushCont", "rushStage1", "rushStage2", "upgrade", "holdRainbow", "kokuchi",
    "stepup", "pseudo", "battleHint", "pushLong", "premium", "serif_white", "serif_blue", "serif_green", "serif_red", "serif_gold"].concat(...Object.keys(VO_TAKES).map((n) => Array.from({ length: VO_TAKES[n] - 1 }, (_, i) => n + "_" + (i + 2))));
  let atkN = 0;
  const vo = (name) => {
    if (!set.voice) return;
    const k = Math.floor(Math.random() * (VO_TAKES[name] || 1));
    if (!(k && PK.Sound.voice(name + "_" + (k + 1)))) PK.Sound.voice(name);
  };

  // ---------------------------------------------------------------- sound helpers
  let unlocked = false;
  function unlockOnce() {
    if (unlocked) return;
    unlocked = true;
    PK.Sound.unlock();
    PK.Sound.setEnabled(set.sound);
    PK.Sound.setVolume(set.volume);
  }
  const snd = (name) => PK.Sound.play(name);

  // ---------------------------------------------------------------- game
  function start(hot) {
    hot = hot || {};
    const saved = hot.save || load(KEY_SAVE);
    const eng = PK.createEngine(saved ? { restore: saved, machine: M.id, tables: oddsTables() } : { machine: M.id, startChips: M.refill, tables: oddsTables() });
    if (eng.restoreError) console.warn("[shell] save not restored, new game:", eng.restoreError);
    if (eng.warnings.length) console.warn("[shell] engine:", eng.warnings);
    let day = hot.day || parse(load(KEY_DAY));
    if (!day || day.date !== today()) day = { date: today(), hits: 0 };
    // A save taken during a hit spin's 演出 is restored as already won (settle()): count that hit now.
    const pre = typeof saved === "string" ? parse(saved) : saved;
    if (!eng.restoreError && pre && pre.S && pre.S.spinning && pre.S.spinning.hit) { day.hits++; dirty = true; }

    let mode = eng.state.mode;
    let firing = false;     // the player's handle switch
    let spinning = false;   // an LCD spin is playing
    let bonusFlow = false;  // jackpot fanfare .. bonus ending: no spins, the shell steps the bonus
    let holdFire = false;   // no shooting while nothing can be won (fanfare, round break, ending)
    let resetting = false;
    let prevHolds = { holds: eng.state.holds.length, rushHolds: eng.state.rushHolds.length };

    // ---- save
    let dirty = false;
    function save(force) {
      if (resetting || (!dirty && !force)) return;
      dirty = false;
      store(KEY_SAVE, eng.serialize());
      store(KEY_DAY, JSON.stringify(day));
    }
    setInterval(save, 4000);
    document.addEventListener("visibilitychange", () => {
      PK.Cabinet.pause(document.hidden);
      if (document.hidden) save(true);
    });
    window.addEventListener("pagehide", () => save(true));
    if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
      window.claude.hot.snapshot(() => ({ save: eng.serialize(), day }));
    }

    // ---- display
    function showChips(chips) {
      $("balls").textContent = fmt(chips);
      $("coinsVal").textContent = fmt(chips);
    }
    function showCounter() {
      const st = eng.state.stats;
      $("cSince").textContent = $("dbSince").textContent = fmt(st.spinsSinceHit);
      $("cTotal").textContent = $("dbTotal").textContent = fmt(st.totalSpins);
      $("cToday").textContent = $("dbToday").textContent = fmt(day.hits);
      // 大當履歷: one bar per hit, newest on the right; height = spins it took (capped), colour = mode
      const last = st.history.slice(-10), list = $("histList");
      $("histEmpty").hidden = last.length > 0;   // say what the empty graph is for
      list.innerHTML = "";
      for (let i = 0; i < 10; i++) {
        const h = last[i - (10 - last.length)], li = document.createElement("li");
        const bar = document.createElement("u"), n = document.createElement("i");
        if (h) {
          li.className = h.mode === "rush" ? "hR" : h.mode === "jitan" ? "hJ" : "hN";
          bar.style.height = Math.round(8 + 92 * Math.min(1, h.spins / 300)) + "%";
          n.textContent = fmt(h.spins);
        } else { li.className = "empty"; n.textContent = "\u00a0"; }
        li.title = h ? h.type : "";
        li.appendChild(bar); li.appendChild(n);
        list.appendChild(li);
      }
    }
    const rushy = () => mode === "rush" || mode === "jitan";
    const bonusy = () => mode === "bonus" || mode === "bonusPending";
    function lights(theme) { PK.Cabinet.setLights(theme); $("app").dataset.theme = theme; }   // the hall glows with it
    // Music waits for the first PLAY: the page stays quiet until the player starts.
    let musicOn = false, bgmWant = null;
    function bgm(name) { bgmWant = name; if (musicOn) PK.Sound.bgm(name); }
    // The sub display says what matters now (it used to show the RUSH continuation rate all the time).
    const SPEC = eng.tables.spec;
    // 轉生史萊姆與魔劍 (M.devour, M.commanders; dev/MACHINE3.md): kept per machine apart from the engine save
    const KEY_M3 = "pk." + M.id + ".m3";
    const m3 = Object.assign({ gauge: 0, gems: 0 }, parse(load(KEY_M3)));
    const saveM3 = () => store(KEY_M3, JSON.stringify(m3));
    function showM3() {
      if (M.devour) PK.Cabinet.setGauge(m3.gauge / M.devour.need, eng.state.awake > 0);
      if (M.commanders) { PK.Cabinet.setGems(m3.gems); PK.LCD.setCommanders(M.commanders, m3.gems); }
    }
    function devour() {
      if (!M.devour) return;
      if (++m3.gauge >= M.devour.need) {
        m3.gauge = 0;
        eng.awaken(M.devour.mul, M.devour.spins);
        PK.LCD.announce(t("lcd.awake"), "gold"); vo("m3awake");
        lights("rainbow"); setTimeout(modeLook, 2200);
        snd("rushIn"); caption("awake", { n: M.devour.spins });
      }
      saveM3(); showM3(); showSub();
    }
    const RECRUIT_AT = 4500;   // ms after the jackpot starts
    function recruit() {
      const C4 = M.commanders;
      if (!C4 || eng.state.rushBoost) return;   // all four are waiting for their RUSH
      if (m3.gems < C4.length) {
        m3.gems++;
        // its cut-in once the jackpot's fanfare is over (RECRUIT_AT), then 魔王降臨 after it
        const i = m3.gems - 1, last = m3.gems >= C4.length;
        setTimeout(() => {
          PK.LCD.playRecruit(i);
          if (!last) vo("m3recruit");   // the fourth is followed by 魔王降臨's own line
          caption("recruit", { name: C4[i], k: i + 1 });
        }, RECRUIT_AT);
      }
      if (m3.gems >= C4.length) {   // 魔王降臨: the next RUSH one step up the presets (the best stays the best)
        const cur = odds().rushN, up = ODDS.rush.filter((n) => n < cur).sort((a, b) => b - a)[0] || cur;
        eng.boostNextRush(1 / up);
        setTimeout(() => { PK.LCD.playMaou(); caption("maou"); vo("m3maou"); }, RECRUIT_AT + 3300);
      }
      saveM3(); showM3();
    }
    if (M.commanders) eng.on("rushBoost", () => { m3.gems = 0; saveM3(); showM3(); });   // the boosted RUSH has begun
    if (M.devour) eng.on("awake", () => { showM3(); showSub(); });
    function showSub() {
      const rc = eng.state.rushBoostOn || SPEC.rushChance;
      if (mode === "rush") PK.Cabinet.setSub(t("cab.subRush", { p: Math.round(100 * (1 - Math.pow(1 - rc, SPEC.st))) }));
      else if (M.devour && eng.state.awake > 0 && mode === "normal") PK.Cabinet.setSub(t("cab.subAwake", { n: eng.state.awake }));
      else if (mode === "jitan") PK.Cabinet.setSub(t("cab.subJitan"));
      else if (bonusy()) PK.Cabinet.setSub(t("cab.subBonus"));
      else PK.Cabinet.setSub(t("cab.subNormal", { n: Math.round(10 / SPEC.normalChance) / 10 }));
    }
    function modeLook() {
      showSub();
      lights(rushy() ? "rush" : bonusy() ? "bonus" : "normal");
      bgm(rushy() ? "rush" : bonusy() ? "bonus" : "normal");
    }
    function pushPrompt(on) { $("push").classList.toggle("prompt", on); }

    // ---- shooting
    const FIRE_GAP = 0.6;   // seconds between balls: 100 a minute, like a real machine
    const BONUS_GAP = FIRE_GAP / 3;   // bonus rounds run three times as fast (the player found them long)
    const AUTO_TAP = 0.33;   // AUTO PUSH hits the bonus boss three times a second
    let tapAcc = 0;
    let fireAcc = 0, lastTs = 0;
    function setFiring(on) {
      if (on && eng.state.chips < 1) { openRefill(); on = false; }
      firing = on;
      if (on) fireAcc = FIRE_GAP;   // first ball right away
      if (on && !musicOn) { musicOn = true; if (bgmWant) PK.Sound.bgm(bgmWant); }
      $("handle").classList.toggle("on", on);
      $("knob").classList.toggle("on", on);
      $("handle").setAttribute("aria-pressed", String(on));
      showHandle();
    }
    function showHandle() {
      const m = manual();
      $("handleBig").textContent = t(firing && !m ? "ui.stopBig" : "ui.play");
      $("handleLbl").textContent = t(m ? (firing ? "ui.release" : "ui.hold") : firing ? "ui.shooting" : "ui.shoot");
    }
    // ---- 打珠 and 力道 (the bar under the machine). 自動: a tap on the knob starts and stops a
    // steady stream at the best power. 手動: the knob is the handle, shooting only while it is held;
    // with 力道 自己調 the finger on the ring sets the power and the shots follow it as it slides.
    const manual = () => set.fireMode === "manual";
    const selfPower = () => manual() && !set.autoAim;
    let power = selfPower() ? clamp01(+set.power || 0) : KNOB.auto[eng.aim()];
    let shown = power;
    function showPower() {
      const z = zoneOf(power), el = $("handlePw");
      el.textContent = selfPower() ? t(z[3]) : t(manual() ? "ui.powerBest" : "ui.powerAuto");
      el.style.color = selfPower() && !M.theme ? z[4] : "";   // the zone's ink is for machine 1's blue knob
    }
    function autoPower() { if (!selfPower()) power = KNOB.auto[eng.aim()]; }
    function showModes() {
      document.querySelectorAll("#mFire button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === set.fireMode)));
      document.querySelectorAll("#mPower button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.v === "best") === !!set.autoAim)));
      $("mPowerBox").classList.toggle("off", !manual());   // 自動 always shoots at the best power
      showHandle(); showPower();
    }
    document.querySelectorAll("#mFire button").forEach((b) => b.addEventListener("click", () => {
      snd("button");
      if (firing) setFiring(false);
      set.fireMode = b.dataset.v;
      // 打珠「自動」 makes everything automatic (the user: 開自動就都自動): PUSH / HACK too.
      // It can still be switched off on its own.
      if (set.fireMode === "auto" && !set.autoPush) { set.autoPush = true; showAuto(); PK.LCD.setAutoPush(true); }
      saveSettings();
      if (selfPower()) power = clamp01(+set.power || 0); else autoPower();
      showModes();
      toast(t(manual() ? "ui.fireManualHint" : "ui.fireAutoHint"));
    }));
    document.querySelectorAll("#mPower button").forEach((b) => b.addEventListener("click", () => {
      snd("button");
      if (!manual()) { toast(t("ui.powerNeedsManual")); return; }
      set.autoAim = b.dataset.v === "best"; saveSettings();
      if (selfPower()) power = clamp01(+set.power || 0); else autoPower();
      showModes();
      if (selfPower()) toast(t("ui.powerSelfHint"));
    }));
    function loop(ts) {
      requestAnimationFrame(loop);
      const dt = lastTs ? Math.min(0.25, (ts - lastTs) / 1000) : 0;
      lastTs = ts;
      if (document.hidden) return;
      care(dt);
      if (Math.abs(shown - power) > 0.001) { shown += (power - shown) * Math.min(1, dt * 10); drawKnob(shown); }
      if (set.autoPush && PK.LCD.bossActive()) {
        tapAcc += dt;
        if (tapAcc >= AUTO_TAP) { tapAcc = 0; doPush(); }
      } else tapAcc = 0;
      if (!firing || holdFire) return;
      const gap = mode === "bonus" ? BONUS_GAP : FIRE_GAP;
      fireAcc += dt;
      while (fireAcc >= gap && firing) { fireAcc -= gap; fireOne(); }
    }
    // ---- keeping the phone cool (the player asked: no overheating, the screen on while playing)
    // 閒置: nothing fired, spun or played for IDLE_AFTER s -> the LCD and the cabinet draw one frame
    // in 3. The frame rate is measured every second (shown with set.showFps); a phone that stays
    // under SLOW_FPS while playing for SLOW_SECS (it got hot and slowed down) gets 省電模式, once.
    // Before that, a gentler step: under LITE_FPS for LITE_SECS (RUSH and jackpots ran at ~40 on the
    // user's phone) halves the particles and wisps for the rest of the visit, silently, at full resolution.
    const IDLE_AFTER = 3, SLOW_FPS = 40, SLOW_SECS = 8, LITE_FPS = 52, LITE_SECS = 4, REMIND_EVERY = 3600;
    let busyT = 0, idleOn = false, fpsN = 0, fpsT = 0, slowS = 0, liteS = 0, liteOn = false, autoSaved = false, playS = 0, remindAt = REMIND_EVERY;
    function care(dt) {
      const busy = firing || spinning || bonusFlow;
      busyT = busy ? 0 : busyT + dt;
      const idleNow = busyT > IDLE_AFTER;
      if (idleNow !== idleOn) { idleOn = idleNow; PK.LCD.setIdle(idleOn); PK.Cabinet.setIdle(idleOn); }
      if (busy) playS += dt;
      if (set.remind && playS >= remindAt) { remindAt += REMIND_EVERY; toast(t("ui.remind", { h: Math.round(playS / 3600) }), 6000); }
      fpsN++; fpsT += dt;
      if (fpsT < 1) return;
      const fps = Math.round(fpsN / fpsT);
      fpsN = 0; fpsT = 0;
      if (set.showFps) $("fps").textContent = t("ui.fps", { n: fps }) + (idleOn ? " 閒置" : "") + (set.saver ? " 省電" : liteOn ? " 輕量" : "");
      liteS = busy && !idleOn && fps < LITE_FPS ? liteS + 1 : 0;
      if (liteS >= LITE_SECS && !liteOn) { liteOn = true; PK.LCD.setLite(true); PK.Cabinet.setLite(true); }
      slowS = busy && !idleOn && fps < SLOW_FPS ? slowS + 1 : 0;
      if (slowS >= SLOW_SECS && !set.saver && !autoSaved) {
        autoSaved = true; set.saver = true; applySaver(); saveSettings(); showSaver();
        toast(t("ui.autoSaver"), 6000);
      }
    }
    function fireOne() {
      // 自動: aimed perfectly. 手動: the knob decides, and a tip says what to fix.
      const shot = selfPower() ? shotOf(power) : null;
      if (shot && shot.side !== eng.aim()) caption(eng.aim() === "right" ? "aimRight" : "aimLeft");
      else if (shot && shot.eff < 0.5) caption("aimWeak");
      const b = eng.fireBall(shot);
      if (!b) { setFiring(false); openRefill(); return; }
      mis.add("fire");
      snd("fire");
      PK.Cabinet.launch(b.target, b.side, () => arrive(b));
    }
    function arrive(b) {
      const r = eng.ballArrived(b.id);
      if (!r) return;
      if (r.target === "heso" && (r.result === "hold" || r.result === "lost")) devour();
      if (r.result === "hold") snd("pocket");
      else if (r.result === "lost") { snd("lost"); caption("lost"); }
      else if (r.result === "pay") snd("payout");
    }

    // ---- spins
    let kickQueued = false;
    function kick() {
      if (kickQueued) return;
      kickQueued = true;
      setTimeout(() => { kickQueued = false; trySpin(); }, 0);
    }
    function trySpin() {
      if (spinning || bonusFlow || !eng.canSpin()) return;
      spinning = true;
      const sc = eng.startSpin();
      showCounter();
      mis.add("spins");
      PK.LCD.playSpin(sc, { speed: set.speed, autoPush: set.autoPush, onEvent: (n) => onLcdEvent(n, sc) }).then(() => {
        eng.endSpin();
        spinning = false;
        pushPrompt(false);
        if (sc.hit) startJackpot(sc);
        else { modeLook(); kick(); }
      });
    }
    // 演出鑑賞: a replay holds the spins back (spinning) and plays the script on the LCD only, in
    // normal play; afterwards the machine carries on as before.
    exPlay = (sc) => {
      if (spinning || bonusFlow || mode !== "normal") return false;
      closeSheets();
      spinning = true; replaying = true;
      const s = Object.assign({ id: Date.now(), mode: "normal", hit: false, kind: null, next: null, holdColor: "blue", holdChangeTo: null, pseudo: 0, stepup: 0,
        gun: false, cutin: null, kokuchi: false, reach: null, fast: false, stAfter: null, serif: null, premium: false, longPush: false }, sc);
      PK.LCD.playSpin(s, { speed: set.speed, autoPush: set.autoPush, onEvent: (n) => onLcdEvent(n, s) }).then(() => {
        spinning = false; replaying = false;
        pushPrompt(false);
        modeLook(); kick();
      });
      return true;
    };
    // LCD 演出 events -> lights, sound, captions.
    function onLcdEvent(n, sc) {
      const r = sc.reach || {};
      const seenAs = { chanceUp: 1, count: 1, slip: 1, devTease: 1, battleWin: 1, battleLose: 1, revive: 1, gun: 1, zone: 1, kokuchi: 1, premium: 1, pushLong: 1 };
      if (seenAs[n]) rec.seen(n);
      else if (n === "reach" && (r.type === "normal" || r.type === "sp" || r.type === "spsp")) rec.seen(r.type === "normal" ? "reach" : r.type);
      else if (n === "stepup:5") rec.seen("stepup");
      else if (n.startsWith("pseudo:")) rec.seen("pseudo");
      else if (n === "cutin" && sc.cutin === "gold") rec.seen("cutinGold");
      else if (n === "serif:gold") rec.seen("serifGold");
      if (n === "spinStart") snd("spin");
      else if (n.startsWith("reelStop")) snd("stop");
      else if (n.startsWith("stepup:")) { snd("stepup"); caption("stepup"); if (+n.slice(7) >= 3) vo("stepup"); }
      else if (n === "gun") { snd("gun"); caption("gun"); }
      else if (n === "cutin") { snd("cutin"); caption("cutin"); vo(sc.cutin === "blue" ? "chance" : "hot"); }
      else if (n.startsWith("pseudo:")) { snd("pseudo"); caption("pseudo"); vo("pseudo"); }
      else if (n === "holdChange") { snd("holdChange"); caption("holdChange"); }
      else if (n === "reach") {
        snd("reach");
        if (!replaying) { mis.add("reach"); if (r.type !== "normal") mis.add("sp"); }
        bgm(r.type === "battle" ? "battle" : "reach");
        lights(r.color === "rainbow" ? "rainbow" : r.color === "gold" || r.type === "spsp" ? "hot" : "reach");
        caption(r.type === "battle" ? "battle" : r.type === "spsp" ? "spsp" : "reach");
        vo(r.type === "battle" ? "battle" : r.type === "sp" ? "spReach" : r.type === "spsp" ? "spsp" : "reach");
      } else if (n === "reachUp") { caption("skip"); snd("reachUp"); lights(r.color === "rainbow" ? "rainbow" : "hot"); PK.Cabinet.flash("#ff5a2a"); }
      else if (n === "pushPrompt") { snd("push"); pushPrompt(true); caption("push"); vo("push"); }
      else if (n === "pushLong") { snd("push"); pushPrompt(true); caption("pushLong"); vo("pushLong"); }
      else if (n.startsWith("serif:")) { snd(n === "serif:gold" || n === "serif:red" ? "holdChange" : "stepup"); caption("serif"); vo("serif_" + n.slice(6)); if (n === "serif:gold") lights("hot"); }
      else if (n === "premium") { snd("kokuchi"); lights("rainbow"); caption("premium"); vo("premium"); rec.ach("premium"); }
      else if (n === "pushHit") { if (!replaying) mis.add("push"); snd("pushHit"); pushPrompt(false); PK.Cabinet.flash("#ffffff"); }
      else if (n === "zen") { snd("kokuchi"); lights("rainbow"); caption("zen"); vo("zen"); }
      else if (n === "stLast") { snd("reach"); caption("stLast"); vo("stLast"); }
      else if (n === "zone") { snd("stepup"); lights("hot"); caption("zone"); vo("zone"); }
      else if (n === "zoneLast") { snd("reachUp"); PK.Cabinet.flash("#ff5a2a"); vo("zoneLast"); }
      else if (n === "chanceUp") { snd("holdChange"); lights("hot"); caption("chanceUp"); vo("chanceUp"); }
      else if (n === "count") { snd("stepup"); caption("count"); }
      else if (n === "slip") snd("stop");
      else if (n === "devTease") { snd("reachUp"); PK.Cabinet.flash("#ffd84a"); }
      else if (n === "atk:hero") { snd("slash"); vo("atk" + (atkN++ % 5 + 1)); }
      else if (n === "atk:dragon") snd("gun");
      else if (n === "battleHint") { snd("holdChange"); lights("hot"); caption("battleHint"); vo("battleHint"); }
      else if (n === "slowmo") snd("reachUp");
      else if (n === "finalBlow") { snd("cutin"); vo("final"); }
      else if (n === "battleWin") { snd("win"); vo("win"); }
      else if (n === "battleLose") { snd("lose"); vo("lose"); }
      else if (n === "revive") { snd("kokuchi"); lights("rainbow"); caption("revive"); rec.ach("revive"); vo("revive"); }
      else if (n === "kokuchi") { snd("kokuchi"); lights("rainbow"); PK.Cabinet.flash("#ffffff"); caption("kokuchi"); vo("kokuchi"); }
      else if (n === "hitConfirm") { lights("bonus"); PK.Cabinet.flash("#ffd84a"); }
      else if (n === "miss") { pushPrompt(false); modeLook(); }
    }

    // ---- bonus: fanfare -> rounds (with breaks) -> ending -> RUSH / 時短 / normal
    // ラウンド昇格: a 10R or 6R jackpot may first show as 3R and grow at the start of round 2. Every
    // heso 10R does (the 3R that grows), and half of the RUSH ones (never on 777, which shows its
    // rounds). Display only: the engine decided the rounds at the hit.
    let shownRounds = 0;   // 0 = show the engine's
    const showRounds = (s) => PK.LCD.showRound(s.round, shownRounds || s.rounds, s.bonusGained);
    function startJackpot(sc) {
      if (sc.mode === "normal" || sc.mode === "jitan") recruit();   // the spin's own mode: the shell's is already bonusPending
      bonusFlow = true; holdFire = true;
      if (day.date !== today()) day = { date: today(), hits: 0 };
      day.hits++; dirty = true;
      rec.hit(sc.kind, eng.state.rushStreak, sc.reach);
      mis.add("hit"); mis.max("streak", eng.state.rushStreak); mis.xp("hit");
      showCounter();
      snd("jackpot");
      lights("bonus"); PK.Cabinet.flash("#ffd84a");
      bgm("bonus");
      caption("jackpot");
      vo(mode === "rush" ? "rushCont" : "jackpot");
      shownRounds = sc.kind !== "3R" && sc.final[0] !== 7 && (sc.src === "heso" || Math.random() < 0.5) ? 3 : 0;
      PK.LCD.playJackpot(shownRounds ? Object.assign({}, sc, { kind: "3R" }) : sc).then(() => eng.beginBonus());
    }
    eng.on("roundStart", (e) => {
      holdFire = false;
      if (shownRounds && e.round === 2) { shownRounds = 0; PK.LCD.playRoundUpgrade(e.rounds); snd("kokuchi"); lights("rainbow"); caption("upgrade"); vo("upgrade"); }
      showRounds(eng.state);
      snd("round");
      if (e.round >= e.rounds) { caption("awaken"); vo("awakenCall"); }
      else if (e.round === 1) { caption("minion"); vo("minionStart"); }
    });
    eng.on("roundEnd", (e) => {
      if (e.last) return;   // bonusEnd follows
      holdFire = true;
      PK.LCD.playRoundBreak(e.round).then(() => eng.nextRound());
    });
    eng.on("bonusEnd", (e) => {
      holdFire = true;
      rec.bonusEnd(e.gained);
      // the 神龍覚醒チャレンジ reveals the next mode first; the sounds wait for it
      const onReveal = (ok) => {
        if (ok) { snd("rushIn"); rec.ach("awaken"); vo("awakenOk"); }
        else if (e.next === "jitan") { snd("lose"); caption("awakenNg"); vo("awakenNg"); }
      };
      PK.LCD.playBonusEnd({ gained: e.gained, next: e.next, streak: eng.state.rushStreak, onReveal }).then(() => {
        eng.finishBonus();
        bonusFlow = false; holdFire = false;
        kick();
      });
    });
    eng.on("rushEnd", (e) => {
      rec.rushEnd(e.streak, e.gained);
      snd("rushEnd"); vo("rushEnd");
      PK.LCD.playRushEnd({ streak: e.streak, gained: e.gained });
      caption("rushEnd");
    });

    // ---- engine state -> display
    eng.on("chips", (e) => {
      showChips(e.chips);
      dirty = true;
      if (mode === "bonus" && e.delta > 0) showRounds(eng.state);
    });
    eng.on("holds", (e) => {
      dirty = true;   // also covers every spin start
      PK.LCD.setHolds(e.holds, e.rushHolds);
      // tip when a hot-coloured hold arrives
      ["holds", "rushHolds"].forEach((q) => {
        const a = e[q];
        if (a.length > prevHolds[q]) {
          const c = a[a.length - 1].color;
          if (c === "red") caption("holdHot");
          else if (c === "gold") caption("holdGold");
          else if (c === "rainbow") { caption("holdRainbow"); rec.ach("rainbow"); rec.seen("holdRainbow"); vo("holdRainbow"); }
        }
        prevHolds[q] = a.length;
      });
      kick();
    });
    let rushCounted = false;   // one 進入 RUSH per chain, not one per hit inside it
    eng.on("mode", (e) => {
      dirty = true;
      mode = e.to;
      if (mode === "rush" && !rushCounted) { rushCounted = true; rec.rush(); vo("rushIn"); }
      else if (mode === "normal") rushCounted = false;
      applyMode(true);
      kick();
    });
    eng.on("st", (e) => {
      const s = eng.state;
      PK.LCD.setRush({ st: e.st, streak: s.rushStreak, gained: s.rushGained });
      if (mode === "rush" && e.st < 11) caption("st");
    });
    eng.on("jitan", (e) => PK.LCD.setRush({ st: e.jitan }));
    eng.on("attacker", (open) => PK.Cabinet.setAttacker(open));
    eng.on("denchu", (open) => PK.Cabinet.setDenchu(open));

    function applyMode(changed) {
      if (mode !== "bonusPending") PK.LCD.setMode(mode);
      PK.LCD.setAim(eng.aim());
      autoPower();
      if (!spinning || mode === "bonusPending") modeLook();
      if (rushy()) { const s = eng.state; PK.LCD.setRush({ st: mode === "rush" ? s.st : s.jitan, streak: s.rushStreak, gained: s.rushGained }); }
      if (changed && mode === "rush") caption("rush");
      if (changed && mode === "jitan") caption("jitan");
    }

    // ---- controls
    // The knob takes the touches (#knobHit covers the button and its ring): the centre is the
    // button, the ring sets the power (angle: KNOB.a0 + KNOB.span * power; below the knob, the gap
    // goes to the nearer end).
    const hit = $("knobHit");
    function knobAt(e) {
      const r = $("handle").getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      return { ang: Math.atan2(dy, dx) * 180 / Math.PI, dist: Math.hypot(dx, dy) / (r.width / 2) };   // dist in button radii
    }
    function powerAt(ang) {
      const s = (((ang - KNOB.a0) % 360) + 360) % 360;
      return s <= KNOB.span ? s / KNOB.span : s < KNOB.span + (360 - KNOB.span) / 2 ? 1 : 0;
    }
    function powerFrom(e) {
      const k = knobAt(e);
      if (k.dist < 0.62) return;   // on the button itself: keep the power
      const p = powerAt(k.ang), z0 = zoneOf(power), z1 = zoneOf(p);
      if (Math.floor(p * 20) !== Math.floor(power * 20)) snd("tick");
      power = p;
      if (z1 !== z0) { showPower(); if (z1[5]) { knobBurst(p); snd("button"); } }
    }
    let held = null;
    hit.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (!manual()) { snd("button"); setFiring(!firing); return; }   // 自動: a tap starts / stops
      held = e.pointerId;
      try { hit.setPointerCapture(e.pointerId); } catch (err) { /* still works while the finger stays on it */ }
      if (selfPower()) powerFrom(e);
      setFiring(true);
      if (firing && !holdFire) { fireAcc = 0; fireOne(); }   // the first ball at once, so a quick tap shoots one
    });
    hit.addEventListener("pointermove", (e) => { if (held === e.pointerId && selfPower()) powerFrom(e); });
    const release = (e) => {
      if (held !== e.pointerId) return;
      held = null;
      setFiring(false);
      if (selfPower()) { set.power = power; saveSettings(); }
    };
    hit.addEventListener("pointerup", release);
    hit.addEventListener("pointercancel", release);
    hit.addEventListener("lostpointercapture", release);
    // the keyboard still reaches the button: 自動 starts / stops, 手動 shoots one ball
    $("handle").addEventListener("click", (e) => {
      if (e.detail !== 0) return;
      snd("button");
      if (manual()) fireOne(); else setFiring(!firing);
    });
    function showAuto() {
      $("autoBtn").textContent = t(set.autoPush ? "ui.autoOn" : "ui.auto");
      $("autoBtn").setAttribute("aria-pressed", String(set.autoPush));
      $("sAuto").setAttribute("aria-pressed", String(set.autoPush));
      $("sAuto").textContent = t(set.autoPush ? "set.on" : "set.off");
    }
    function toggleAuto() {
      set.autoPush = !set.autoPush; saveSettings(); showAuto();
      PK.LCD.setAutoPush(set.autoPush);   // also for the PUSH already waiting
      toast(t(set.autoPush ? "ui.autoOnHint" : "ui.autoOffHint"));
    }
    $("autoBtn").addEventListener("click", () => { snd("button"); toggleAuto(); });
    // PUSH: answers a prompt or 連打, or hits the boss in a bonus (knocking it out pays BOSS_REWARD).
    const BOSS_REWARD = 100;
    function doPush() {
      const r = PK.LCD.push();
      if (r === "bossDown") { eng.refill(BOSS_REWARD); snd("win"); PK.Cabinet.flash("#ffd84a"); rec.boss(); mis.add("boss"); mis.xp("boss"); vo("minionDown"); }
      else if (r === "boss") snd("slash");
      else if (r === "awaken") snd("stepup");
      else snd("button");
    }
    $("push").addEventListener("pointerdown", doPush);           // pointerdown: fast enough for 連打
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => $("push").addEventListener(ev, () => PK.LCD.release()));   // ends a 長押し
    $("push").addEventListener("click", (e) => { if (e.detail === 0) doPush(); });   // keyboard
    $("infoBtn").addEventListener("click", () => openSheet("glossary"));
    $("menuBtn").addEventListener("click", () => openSheet("menu"));

    // ---- sheets
    function openSheet(id) {
      snd("button");
      document.querySelectorAll(".sheet").forEach((s) => { s.hidden = s.id !== id; });
      const first = $(id).querySelector("button");
      if (first) first.focus({ preventScroll: true });
    }
    function closeSheets() { document.querySelectorAll(".sheet").forEach((s) => { s.hidden = true; }); }
    // A ✕ at the top right of every sheet (the user: the 關閉 at the very bottom was out of the way);
    // the bottom 關閉 buttons are hidden where it is (src/ui.css .hasX).
    document.querySelectorAll(".sheet:not(#tutorial) > .card").forEach((c) => {
      const x = document.createElement("button");
      x.type = "button"; x.className = "closeX"; x.setAttribute("data-close", ""); x.setAttribute("aria-label", t("ui.close")); x.textContent = "✕";
      c.insertBefore(x, c.firstChild);
      c.parentNode.classList.add("hasX");
    });
    document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => { snd("button"); closeSheets(); }));
    document.querySelectorAll(".sheet").forEach((s) => s.addEventListener("click", (e) => { if (e.target === s && s.id !== "tutorial") closeSheets(); }));
    $("mRefill").addEventListener("click", () => openRefill());
    $("mSettings").addEventListener("click", () => {
      $("resetBox").hidden = false; $("resetAsk").hidden = true;
      pend.hitN = pend.rushN = 0; showOdds();
      openSheet("settings");
    });
    $("mGlossary").addEventListener("click", () => openSheet("glossary"));
    $("mTutorial").addEventListener("click", () => openTutorial());
    $("mRecords").addEventListener("click", () => { showRecords(); openSheet("records"); drawSlump(); });
    $("mGallery").addEventListener("click", () => { showGallery(); openSheet("gallery"); });
    // the nav bar opens what the (shorter) menu used to
    document.querySelectorAll("#navBar [data-go]").forEach((b) => b.addEventListener("click", () => $(b.dataset.go).click()));
    // the data bar folds the full counter and the 大當履歷 away; the machine gets the room
    const showData = () => { $("dataPanel").hidden = !set.dataOpen; $("dataBar").setAttribute("aria-expanded", String(!!set.dataOpen)); fit(); };
    $("dataBar").addEventListener("click", () => { set.dataOpen = !set.dataOpen; saveSettings(); snd("button"); showData(); });
    showData();
    gameStats = () => eng.state;
    $("mMissions").addEventListener("click", () => { showMissions(); openSheet("missions"); });
    $("mLobby").addEventListener("click", () => { snd("button"); closeSheets(); showHome(() => {}); });
    mis.pay = (n) => { eng.refill(n); PK.Cabinet.flash("#ffd84a"); };
    const lg = mis.login();
    if (lg) { mis.pay(lg.n); queueToast(t("login.bonus", { d: lg.streak, n: fmt(lg.n) })); }

    function openRefill() {
      $("refillTitle").textContent = t(eng.state.chips < 1 ? "refill.title" : "refill.titleMenu");
      $("refillBody").textContent = t("refill.body", { n: fmt(M.refill) });
      $("refillBtn").textContent = t("refill.btn", { n: fmt(M.refill) });
      openSheet("refill");
    }
    $("refillBtn").addEventListener("click", () => {
      eng.refill(M.refill);
      snd("coin");
      closeSheets();
      toast(t("refill.done", { n: fmt(M.refill) }));
    });

    // settings
    function showVoice() {
      $("sVoice").setAttribute("aria-pressed", String(set.voice));
      $("sVoice").textContent = t(set.voice ? "set.on" : "set.off");
    }
    $("sVoice").addEventListener("click", () => { set.voice = !set.voice; PK.Sound.setVoice(set.voice); saveSettings(); showVoice(); snd("button"); });
    function showSaver() {
      $("sSaver").setAttribute("aria-pressed", String(set.saver));
      $("sSaver").textContent = t(set.saver ? "set.on" : "set.off");
      $("saverBadge").hidden = !set.saver;   // a badge on screen while it is on
    }
    $("saverBadge").addEventListener("click", () => $("mSettings").click());
    // 省電模式, or a phone that reports 4 GB or less (Android Chrome does; iPhones report nothing),
    // also keeps the music lighter: it takes effect before the first sound, so a reload applies it.
    const applySaver = () => {
      PK.LCD.setSaver(set.saver); PK.Cabinet.setSaver(set.saver);
      PK.Sound.setLowMemory(set.saver || (navigator.deviceMemory || 8) <= 4);
    };
    $("sSaver").addEventListener("click", () => { set.saver = !set.saver; applySaver(); saveSettings(); showSaver(); snd("button"); });
    function showCare() {
      document.querySelectorAll("#sWake button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.min === set.wakeMin)));
      $("sFps").setAttribute("aria-pressed", String(set.showFps)); $("sFps").textContent = t(set.showFps ? "set.on" : "set.off");
      $("sRemind").setAttribute("aria-pressed", String(set.remind)); $("sRemind").textContent = t(set.remind ? "set.on" : "set.off");
      $("fps").hidden = !set.showFps;
    }
    document.querySelectorAll("#sWake button").forEach((b) => {
      b.textContent = +b.dataset.min ? t("set.wakeMin", { n: b.dataset.min }) : t("set.wakeOff");
      b.addEventListener("click", () => { set.wakeMin = +b.dataset.min; saveSettings(); showCare(); wake(); snd("button"); });
    });
    $("sFps").addEventListener("click", () => { set.showFps = !set.showFps; saveSettings(); showCare(); snd("button"); });
    $("sRemind").addEventListener("click", () => { set.remind = !set.remind; saveSettings(); showCare(); snd("button"); });
    showCare();
    function showSettings() {
      $("sSound").setAttribute("aria-pressed", String(set.sound));
      $("mSound").setAttribute("aria-pressed", String(set.sound));
      $("mSound").setAttribute("aria-label", t(set.sound ? "ui.soundOff" : "ui.soundOn"));
      $("sSound").textContent = t(set.sound ? "set.on" : "set.off");
      $("sCaptions").setAttribute("aria-pressed", String(set.captions));
      $("sCaptions").textContent = t(set.captions ? "set.on" : "set.off");
      $("sVolume").value = String(set.volume);
      document.querySelectorAll("#sSpeed button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.speed === set.speed)));
      showAuto();
      showVoice();
    }
    $("sSound").addEventListener("click", () => { set.sound = !set.sound; PK.Sound.setEnabled(set.sound); saveSettings(); showSettings(); snd("button"); });
    $("mSound").addEventListener("click", () => $("sSound").click());
    $("sCaptions").addEventListener("click", () => {
      set.captions = !set.captions; saveSettings(); showSettings(); snd("button");
      if (!set.captions) $("caption").classList.remove("show");
    });
    $("sAuto").addEventListener("click", () => { snd("button"); toggleAuto(); });
    $("sVolume").addEventListener("input", () => { set.volume = +$("sVolume").value; PK.Sound.setVolume(set.volume); saveSettings(); });
    document.querySelectorAll("#sSpeed button").forEach((b) => b.addEventListener("click", () => { set.speed = +b.dataset.speed; saveSettings(); showSettings(); snd("button"); }));
    $("sReset").addEventListener("click", () => {
      $("resetQ").textContent = t("set.resetAsk", { n: fmt(M.refill) });
      $("resetBox").hidden = true; $("resetAsk").hidden = false;
    });
    $("sResetNo").addEventListener("click", () => { $("resetBox").hidden = false; $("resetAsk").hidden = true; });
    // 機率調整: picked here, applied by a reload
    const pend = { hitN: 0, rushN: 0 };
    function showOdds() {
      const o = odds(), h = pend.hitN || o.hitN, r = pend.rushN || o.rushN, p = rushPct(r, o.st) / 100;
      document.querySelectorAll("#sHit button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.n === h)));
      document.querySelectorAll("#sRush button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.n === r)));
      $("sHitHint").textContent = t("set.hitHint", { m: ODDS.hitMinutes[h] || "?" });
      $("sRushHint").textContent = t("set.rushHint", { k: (p / (1 - p)).toFixed(1) });
      $("sOddsApply").hidden = h === o.hitN && r === o.rushN;
      $("sOddsDefault").hidden = !(myOdds().hitN || myOdds().rushN) || !$("sOddsApply").hidden;   // only when the odds are not the machine's own
    }
    [["sHit", ODDS.hit, "hitN", (n) => "1/" + n], ["sRush", ODDS.rush, "rushN", (n) => rushPct(n, odds().st) + "%"]].forEach(([id, list, key, label]) => {
      list.forEach((n) => {
        const b = document.createElement("button");
        b.type = "button"; b.dataset.n = String(n); b.textContent = label(n);
        b.addEventListener("click", () => { snd("button"); pend[key] = n; showOdds(); });
        $(id).appendChild(b);
      });
    });
    $("sOddsApply").addEventListener("click", () => {
      const o = odds();
      setMyOdds({ hitN: pend.hitN || o.hitN, rushN: pend.rushN || o.rushN });
      saveSettings(); save(true);
      location.reload();
    });
    // 恢復預設: the machine's own odds again, kept apart from 重新開始 (the user's choice)
    $("sOddsDefault").addEventListener("click", () => {
      setMyOdds(null);
      saveSettings(); save(true);
      location.reload();
    });
    $("sResetYes").addEventListener("click", () => {
      resetting = true;
      try { localStorage.removeItem(KEY_SAVE); localStorage.removeItem(KEY_DAY); } catch (e) { /* nothing saved */ }
      location.reload();
    });

    // tutorial
    let tutPage = 0;
    function openTutorial() { tutPage = 0; showTutorial(); openSheet("tutorial"); }
    function showTutorial() {
      const p = tutPage + 1;
      $("tutArt").innerHTML = TUT_ART[tutPage];
      $("tutTitle").textContent = t("tut.p" + p + "t");
      // one line per paragraph, **word** highlighted (built as nodes, never as HTML)
      const body = $("tutBody");
      body.textContent = "";
      t("tut.p" + p).split("\n").forEach((line) => {
        const el = document.createElement("p");
        line.split("**").forEach((part, i) => { const n = i % 2 ? document.createElement("b") : document.createTextNode(part); if (i % 2) n.textContent = part; el.appendChild(n); });
        body.appendChild(el);
      });
      $("tutColors").hidden = p !== 3;
      $("tutTip").hidden = p !== TUT_ART.length;
      $("tutStep").textContent = p + " / " + TUT_ART.length;
      $("tutDots").innerHTML = TUT_ART.map((_, i) => "<i" + (i === tutPage ? ' class="on"' : "") + "></i>").join("");
      $("tutPrev").textContent = t(tutPage ? "tut.prev" : "tut.skip");
      $("tutNext").textContent = t(p === TUT_ART.length ? "tut.go" : "tut.next");
    }
    function endTutorial() {
      set.tutorialSeen = true; saveSettings();
      closeSheets();
      caption("start");
    }
    $("tutPrev").addEventListener("click", () => { snd("button"); if (tutPage) { tutPage--; showTutorial(); } else endTutorial(); });
    $("tutNext").addEventListener("click", () => { snd("button"); if (tutPage < TUT_ART.length - 1) { tutPage++; showTutorial(); } else endTutorial(); });
    const HOLD_COLS = ["#4aa8ff", "#45d47c", "#ff4e3a", "#ffc94d", "#ff8ad8"];
    $("tutColors").innerHTML = t("tut.colors").split("|").map((name, i) => '<span style="color:' + HOLD_COLS[i] + '">● ' + name + "</span>").join("");

    // ---- boot the modules
    $("app").dataset.machine = M.id;   // per-machine colours in src/ui.css
    PK.Cabinet.mount({ back: $("cabBack"), field: $("field"), front: $("cabFront"), assetsBase: M.assetsBase, machine: M.cabinet, theme: M.theme });
    PK.Cabinet.onPin(() => PK.Sound.play("tick"));   // the rattle of balls on the pins
    PK.LCD.mount($("lcd"), { assetsBase: M.assetsBase, theme: M.theme, maxHolds: eng.tables.units.maxHolds });
    $("lcd").addEventListener("click", () => { if (PK.LCD.skip()) snd("button"); });   // 演出スキップ: tap to fast-forward
    PK.LCD.onBonusEvent((n) => { if (n === "atk:minion") snd("gun"); else if (n.startsWith("rushStage:")) { snd("rushIn"); lights("rainbow"); vo("rushStage" + n.slice(10)); } });   // a 龍兵 claws; RUSH climbs a stage
    PK.Sound.useFiles(M.assetsBase, { soft: M.softMusic });   // AI-made music in assets/ replaces the synthesized beds
    PK.Sound.useVoices(VOICE_LINES.concat(M.devour ? ["m3awake", "m3recruit", "m3maou"] : []));   // 轉生史萊姆與魔劍's own moments
    PK.Sound.setVoice(set.voice);
    applySaver(); showSaver(); showM3();
    const s0 = eng.state;
    PK.LCD.setHolds(s0.holds, s0.rushHolds);
    applyMode(false);
    PK.Cabinet.setAttacker(s0.attacker);
    PK.Cabinet.setDenchu(s0.denchu);
    if (mode === "bonus") { bonusFlow = true; PK.LCD.showRound(s0.round, s0.rounds, s0.bonusGained); }
    showChips(s0.chips);
    showCounter();
    showSettings();
    setFiring(false);
    drawKnob(shown); showModes();
    requestAnimationFrame(loop);
    const welcome = () => {
    if (!set.tutorialSeen) openTutorial();
    // 加到主畫面: once, on the visit after the tutorial, on the public site (it has the manifest)
    // and not already opened from the home screen.
    else if (!set.homeTip && document.querySelector("link[rel=manifest]") && !navigator.standalone &&
      !(window.matchMedia && matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches)) {
      set.homeTip = true; saveSettings();
      openSheet("homeTip");
    }
    else caption("start");
    };
    let entered = false;
    try { entered = sessionStorage.getItem(KEY_ENTER) === "1"; sessionStorage.removeItem(KEY_ENTER); } catch (e) { /* no session storage: show the hall */ }
    hallRest = (on) => {
      if (on) { if (firing) setFiring(false); PK.Sound.setEnabled(false); }
      else PK.Sound.setEnabled(set.sound);
    };
    if (entered) welcome(); else showHome(welcome);
    // The phone's back button / gesture (the user: it closed the whole game every time). Extra history
    // entries catch it: back closes an open sheet, else goes from the machine to the 遊戲大廳, and in the
    // hall it asks once (a second back within BACK_EXIT seconds really leaves). Chrome skips history
    // entries a page adds without a tap (it then left at once on the user's phone), so the entries are
    // added on the player's taps, up to GUARDS ahead, and counted down as back uses them.
    const BACK_EXIT = 2, GUARDS = 3;
    let backArmT = -99, guards = 0;
    const arm = () => {
      try { while (guards < GUARDS) { history.pushState({ pk: guards + 1 }, ""); guards++; } } catch (e) { /* no history API: back leaves */ }
    };
    document.addEventListener("pointerup", arm, true);   // a touch grants activation on its pointerup (not its pointerdown)
    document.addEventListener("click", arm, true);
    document.addEventListener("keydown", arm, true);
    window.addEventListener("popstate", () => {
      guards = Math.max(0, guards - 1);
      const open = [...document.querySelectorAll(".sheet")].some((x) => !x.hidden);
      if (open) { closeSheets(); return; }
      if ($("home").hidden) { snd("button"); showHome(() => {}); return; }
      const now = performance.now() / 1000;
      if (now - backArmT < BACK_EXIT) { try { history.go(-(guards + 1)); } catch (e) { /* stay */ } return; }
      backArmT = now;
      toast(t("ui.backExit"), BACK_EXIT * 1000);
    });
    $("menuVer").textContent = t("ui.version", { v: VERSION });
    const lastVer = +load(KEY_VER) || 0;
    store(KEY_VER, String(VERSION));
    if (lastVer && lastVer !== VERSION) toast(t("ui.updated", { v: VERSION }), 5000);   // shown while the page is still loading
    kick();
    bootDone();
    // dev/test hook (not used by the game)
    PK.shell = { eng, setFiring, get busy() { return { spinning, bonusFlow, holdFire, mode }; } };
  }

  // ---------------------------------------------------------------- loading screen
  // index.html's #boot covers the bare page while the scripts load. Once the game has started it
  // waits for the fonts and the hall's pictures (at most BOOT_WAIT ms), fills the bar and fades out.
  const BOOT_WAIT = 4000;
  function bootDone() {
    const el = $("boot");
    if (!el) return;   // already gone (a hot reload)
    window.PKBOOT = () => {};   // shell.js's own load event comes after this; the bar is ours now
    {   // the bar keeps creeping while the fonts and pictures load, so it never looks stuck
      const b = $("bootBar"), p = $("bootPct");
      if (b) { b.style.transition = "width " + BOOT_WAIT / 1000 + "s cubic-bezier(.2,.6,.3,1)"; b.style.width = "98%"; }
      if (p) p.textContent = "準備機台中…";
    }
    const imgs = [...document.querySelectorAll("#home:not([hidden]) img")].filter((im) => !im.complete)
      .map((im) => new Promise((ok) => { im.addEventListener("load", ok); im.addEventListener("error", ok); }));
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const b = $("bootBar"), p = $("bootPct");
      if (b) { b.style.transition = "width .2s ease"; b.style.width = "100%"; }
      if (p) p.textContent = "100%";
      setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 500); }, 200);
    };
    Promise.all([fonts, ...imgs]).then(finish, finish);
    setTimeout(finish, BOOT_WAIT);
  }

  // ---------------------------------------------------------------- tutorial art
  // Real game frames (img/tutorial/, made by dev/make_tutorial_art.js) with labelled call-outs.
  // Coordinates are in the 320x170 art box (the frames are 640x340).
  const SVG = (body) => '<svg class="tutArt" viewBox="0 0 320 170" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">' + body + "</svg>";
  const pic = (n) => '<image href="img/tutorial/' + (M.tutPrefix || "") + 'tut' + n + '.jpg" x="0" y="0" width="320" height="170" preserveAspectRatio="xMidYMid slice"/>';   // each machine's own frames
  // gold-edged label centred at x,y
  const tag = (x, y, s) => {
    const w = s.length * 12.5 + 18;
    return '<rect x="' + (x - w / 2) + '" y="' + (y - 11) + '" width="' + w + '" height="22" rx="11" fill="rgba(8,10,16,0.88)" stroke="#ffc94d" stroke-width="1.2"/>' +
      '<text x="' + x + '" y="' + (y + 4.5) + '" text-anchor="middle" font-family="Noto Sans TC, sans-serif" font-weight="900" font-size="12" fill="#ffffff">' + s + "</text>";
  };
  // arrow from (x1,y1) to the point (x2,y2)
  const arrow = (x1, y1, x2, y2) => {
    const a = Math.atan2(y2 - y1, x2 - x1), h = 6, p = (d) => (x2 - h * Math.cos(a + d)).toFixed(1) + " " + (y2 - h * Math.sin(a + d)).toFixed(1);
    return '<path d="M' + x1 + " " + y1 + " L" + x2 + " " + y2 + '" stroke="#ffc94d" stroke-width="2"/><path d="M' + x2 + " " + y2 + " L" + p(0.5) + " L" + p(-0.5) + ' Z" fill="#ffc94d"/>';
  };
  const TUT_ART = [   // one picture per page of tut.p1..p5
    SVG(pic(1) + arrow(267, 108, 267, 124) + tag(262, 96, t("tut.aHandle"))),
    SVG(pic(1) + arrow(160, 64, 160, M.tutPrefix ? 28 : 36) + tag(160, 76, t("tut.aHeso"))),   // 霓虹天使: the turntable sits higher
    SVG(pic(3) + arrow(196, 152, 136, 152) + tag(250, 152, t("tut.aHolds"))),
    SVG(pic(4) + tag(160, 156, t("tut.aReach"))),
    SVG(pic(2) + tag(160, 156, t("tut.aSame"))),
  ];

  // ---------------------------------------------------------------- go
  fillText();
  buildKnob();
  placeControls();
  fit();
  window.addEventListener("resize", fit);   // registered before the modules mount, so it runs first
  document.addEventListener("pointerdown", unlockOnce, { capture: true });
  document.addEventListener("keydown", unlockOnce, { capture: true });
  const hot = window.claude && window.claude.hot;
  if (hot && hot.ready) hot.ready(start); else start(hot && hot.data);
})();
