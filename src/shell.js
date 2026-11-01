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
  const M = PK.MACHINES[(function () { try { return localStorage.getItem(KEY_MACHINE); } catch (e) { return null; } })()] || PK.MACHINES.enbu;
  Object.assign(PK.TEXT, M.text);

  // The version the player sees (menu, and a toast after an update): the Artifact version this is
  // published as. Bump it on every publish; the public site is built from the same files.
  const VERSION = 36;

  // ---------------------------------------------------------------- storage
  // localStorage can be missing or throw (private windows, previews): the game still runs.
  const KEY_SAVE = "pk." + M.id + ".save", KEY_DAY = "pk." + M.id + ".day", KEY_SET = "pk.settings", KEY_VER = "pk.version";
  const load = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* not saved */ } };
  const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };

  const set = Object.assign({ sound: true, volume: 0.8, captions: true, speed: 1, autoPush: false, fireMode: "auto", autoAim: true, power: 0.4, voice: true, tutorialSeen: false }, parse(load(KEY_SET)));
  const saveSettings = () => store(KEY_SET, JSON.stringify(set));

  // ---------------------------------------------------------------- 機率調整
  // Each player can pick the odds on their own phone (設定 → 機率調整): presets over the machine's
  // numbers (set.hitN / set.rushN = 1/n per spin, null = the machine's own). A change applies on a
  // reload, so one engine always runs on one set of tables; the save and the records are kept.
  const ODDS = {
    hit: [49.9, 69.9, 99.9, 149.9, 199.9],                        // 1/n per normal spin
    hitMinutes: { 49.9: 4, 69.9: 5, 99.9: 7, 149.9: 11, 199.9: 13 }, // mean minutes to a jackpot (simulated)
    rush: [20, 16, 12, 9, 5.5],                                    // 1/n per RUSH spin
  };
  function odds() {
    const sp = Object.assign({}, PK.engineTables.spec, M.engine && M.engine.spec);
    const own = (c) => Math.round(10 / c) / 10;
    return { hitN: set.hitN || own(sp.normalChance), rushN: set.rushN || own(sp.rushChance), st: sp.st };
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
    $("coinsLbl").textContent = t("ui.coins");
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
    ["glg.numbers", ["gl.balls", "gl.coins", "gl.serial", "gl.sinceHit", "gl.totalSpins", "gl.todayHits", "gl.history", "gl.hold", "gl.st", "gl.sub"]],
    ["glg.win", ["gl.spin", "gl.reach", "gl.jackpot", "gl.round", "gl.upgrade", "gl.boss", "gl.awaken", "gl.rush", "gl.rate", "gl.jitan"]],
    ["glg.hints", ["gl.holdColor", "gl.stepup", "gl.gun", "gl.cutin", "gl.pseudo", "gl.battle", "gl.hot", "gl.kokuchi", "gl.revive", "gl.zone", "gl.reachVar", "gl.zen", "gl.stLast"]],
  ];

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
  function fit() {
    const wrap = $("stageWrap"), w = wrap.clientWidth, h = wrap.clientHeight;
    const s = Math.min(w / L.stage.w, h / L.stage.h);
    const x = (w - L.stage.w * s) / 2, y = (h - L.stage.h * s) * 0.2;
    $("stage").style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) scale(" + s.toFixed(4) + ")";
  }

  // ---------------------------------------------------------------- 提示字幕
  const capLast = {};
  let capTimer = 0;
  function caption(key) {
    if (!set.captions) return;
    const now = Date.now();
    if (capLast[key] && now - capLast[key] < 45000) return;   // same tip at most every 45 s
    capLast[key] = now;
    const el = $("caption");
    el.lastChild.textContent = t("cap." + key);
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
  const ACH = ["first", "rush", "s3", "s5", "s10", "r10", "boss", "boss10", "awaken", "spsp", "rainbow", "revive", "rich", "hits100"];
  let queueToast = null;   // toasts that wait their turn (achievements, missions, levels)
  const rec = (function () {
    const r = Object.assign({ hits: 0, rushes: 0, bestStreak: 0, bestBonus: 0, bestRush: 0, boss: 0, got: {} }, parse(load(KEY_REC)));
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
      if (r.got[id]) return;
      r.got[id] = Date.now();
      queueToast(t("rec.unlocked", { name: t("ach." + id).split("|")[0] }));
    }
    return {
      data: r, ach: (id) => { ach(id); keep(); },
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
    return {
      pay: null,
      add(id, n) { step(id, n || 1, false); },
      max(id, v) { step(id, v, true); },
      xp(kind) { gainXp(XP[kind] || 0); save(true); },
      title, todays, data: r,
    };
  })();
  // ---------------------------------------------------------------- 選擇機台 (lobby)
  // A card per machine in PK.MACHINES, then one for the machine still being made. Picking another
  // machine saves the choice and reloads; each machine keeps its own balls, save and records.
  function showLobby() {
    const ul = $("lobbyList");
    ul.innerHTML = "";
    const card = (img, name, line, tag, on, click) => {
      const li = document.createElement("li");
      if (on) li.className = "on";
      li.innerHTML = '<span class="pic"></span><div><b></b><small></small></div><em></em>';
      if (img) li.querySelector(".pic").style.backgroundImage = "url(" + img + ")";
      li.querySelector("b").textContent = name;
      li.querySelector("small").textContent = line;
      li.querySelector("em").textContent = tag;
      if (click) { li.tabIndex = 0; li.setAttribute("role", "button"); li.addEventListener("click", click); }
      return ul.appendChild(li);
    };
    Object.keys(PK.MACHINES).forEach((id) => {
      const m = PK.MACHINES[id], on = m === M;
      card(m.card ? m.assetsBase + m.card : null, m.name, m.tagline || "", on ? t("lobby.playing") : t("lobby.play"), on,
        on ? null : () => { store(KEY_MACHINE, id); location.reload(); });
    });
    card(null, t("lobby.soon"), t("lobby.soonBody"), "", false, null).classList.add("soon");
  }
  function showMissions() {
    const r = mis.data, day = mis.todays(), ul = $("msList");
    $("msLevel").textContent = t("lv.level", { n: r.lv.n, title: mis.title() });
    $("msXp").style.width = Math.round((100 * r.lv.xp) / xpFor(r.lv.n)) + "%";
    $("msXpTxt").textContent = t("lv.xp", { a: r.lv.xp, b: xpFor(r.lv.n) });
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
  const VOICE_LINES = ["reach", "spReach", "spsp", "battle", "push", "jackpot", "rushIn", "rushEnd", "chance", "hot",
    "atk1", "atk2", "atk3", "final", "win", "lose", "revive", "minionStart", "minionDown", "awakenCall", "awakenOk", "awakenNg"];
  let atkN = 0;
  const vo = (name) => { if (set.voice) PK.Sound.voice(name); };

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
      $("coinsVal").textContent = fmt(chips * 100);
    }
    function showCounter() {
      const st = eng.state.stats;
      $("cSince").textContent = fmt(st.spinsSinceHit);
      $("cTotal").textContent = fmt(st.totalSpins);
      $("cToday").textContent = fmt(day.hits);
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
    function showSub() {
      if (mode === "rush") PK.Cabinet.setSub(t("cab.subRush", { p: Math.round(100 * (1 - Math.pow(1 - SPEC.rushChance, SPEC.st))) }));
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
      el.style.color = selfPower() ? z[4] : "";
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
      set.fireMode = b.dataset.v; saveSettings();
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
    // LCD 演出 events -> lights, sound, captions.
    function onLcdEvent(n, sc) {
      const r = sc.reach || {};
      if (n === "spinStart") snd("spin");
      else if (n.startsWith("reelStop")) snd("stop");
      else if (n.startsWith("stepup:")) { snd("stepup"); caption("stepup"); }
      else if (n === "gun") { snd("gun"); caption("gun"); }
      else if (n === "cutin") { snd("cutin"); caption("cutin"); vo(sc.cutin === "blue" ? "chance" : "hot"); }
      else if (n.startsWith("pseudo:")) { snd("pseudo"); caption("pseudo"); }
      else if (n === "holdChange") { snd("holdChange"); caption("holdChange"); }
      else if (n === "reach") {
        snd("reach");
        mis.add("reach"); if (r.type !== "normal") mis.add("sp");
        bgm(r.type === "battle" ? "battle" : "reach");
        lights(r.color === "rainbow" ? "rainbow" : r.color === "gold" || r.type === "spsp" ? "hot" : "reach");
        caption(r.type === "battle" ? "battle" : r.type === "spsp" ? "spsp" : "reach");
        vo(r.type === "battle" ? "battle" : r.type === "sp" ? "spReach" : r.type === "spsp" ? "spsp" : "reach");
      } else if (n === "reachUp") { snd("reachUp"); lights(r.color === "rainbow" ? "rainbow" : "hot"); PK.Cabinet.flash("#ff5a2a"); }
      else if (n === "pushPrompt") { snd("push"); pushPrompt(true); caption("push"); vo("push"); }
      else if (n === "pushHit") { mis.add("push"); snd("pushHit"); pushPrompt(false); PK.Cabinet.flash("#ffffff"); }
      else if (n === "zen") { snd("kokuchi"); lights("rainbow"); caption("zen"); }
      else if (n === "stLast") { snd("reach"); caption("stLast"); }
      else if (n === "zone") { snd("stepup"); lights("hot"); caption("zone"); }
      else if (n === "zoneLast") { snd("reachUp"); PK.Cabinet.flash("#ff5a2a"); }
      else if (n === "chanceUp") { snd("holdChange"); lights("hot"); caption("chanceUp"); }
      else if (n === "count") { snd("stepup"); caption("count"); }
      else if (n === "slip") snd("stop");
      else if (n === "devTease") { snd("reachUp"); PK.Cabinet.flash("#ffd84a"); }
      else if (n === "atk:hero") { snd("slash"); vo("atk" + (atkN++ % 3 + 1)); }
      else if (n === "atk:dragon") snd("gun");
      else if (n === "slowmo") snd("reachUp");
      else if (n === "finalBlow") { snd("cutin"); vo("final"); }
      else if (n === "battleWin") { snd("win"); vo("win"); }
      else if (n === "battleLose") { snd("lose"); vo("lose"); }
      else if (n === "revive") { snd("kokuchi"); lights("rainbow"); caption("revive"); rec.ach("revive"); vo("revive"); }
      else if (n === "kokuchi") { snd("kokuchi"); lights("rainbow"); PK.Cabinet.flash("#ffffff"); caption("kokuchi"); }
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
      vo("jackpot");
      shownRounds = sc.kind !== "3R" && sc.final[0] !== 7 && (sc.src === "heso" || Math.random() < 0.5) ? 3 : 0;
      PK.LCD.playJackpot(shownRounds ? Object.assign({}, sc, { kind: "3R" }) : sc).then(() => eng.beginBonus());
    }
    eng.on("roundStart", (e) => {
      holdFire = false;
      if (shownRounds && e.round === 2) { shownRounds = 0; PK.LCD.playRoundUpgrade(e.rounds); snd("kokuchi"); lights("rainbow"); caption("upgrade"); }
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
      PK.LCD.playBonusEnd({ gained: e.gained, next: e.next, onReveal }).then(() => {
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
          else if (c === "rainbow") { caption("holdRainbow"); rec.ach("rainbow"); }
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
    $("mRecords").addEventListener("click", () => { showRecords(); openSheet("records"); });
    $("mMissions").addEventListener("click", () => { showMissions(); openSheet("missions"); });
    $("mLobby").addEventListener("click", () => { showLobby(); openSheet("lobby"); });
    mis.pay = (n) => { eng.refill(n); PK.Cabinet.flash("#ffd84a"); };

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
    function showSettings() {
      $("sSound").setAttribute("aria-pressed", String(set.sound));
      $("sSound").textContent = t(set.sound ? "set.on" : "set.off");
      $("sCaptions").setAttribute("aria-pressed", String(set.captions));
      $("sCaptions").textContent = t(set.captions ? "set.on" : "set.off");
      $("sVolume").value = String(set.volume);
      document.querySelectorAll("#sSpeed button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.speed === set.speed)));
      showAuto();
      showVoice();
    }
    $("sSound").addEventListener("click", () => { set.sound = !set.sound; PK.Sound.setEnabled(set.sound); saveSettings(); showSettings(); snd("button"); });
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
      set.hitN = pend.hitN || o.hitN; set.rushN = pend.rushN || o.rushN;
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
      $("tutBody").textContent = t("tut.p" + p);
      $("tutColors").hidden = p !== 3;
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
    PK.Cabinet.mount({ back: $("cabBack"), field: $("field"), front: $("cabFront"), assetsBase: M.assetsBase, machine: M.cabinet });
    PK.Cabinet.onPin(() => PK.Sound.play("tick"));   // the rattle of balls on the pins
    PK.LCD.mount($("lcd"), { assetsBase: M.assetsBase });
    PK.LCD.onBonusEvent((n) => { if (n === "atk:minion") snd("gun"); });   // a 龍兵 claws
    PK.Sound.useFiles(M.assetsBase);   // AI-made music in assets/ replaces the synthesized beds
    PK.Sound.useVoices(VOICE_LINES);
    PK.Sound.setVoice(set.voice);
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
    if (!set.tutorialSeen) openTutorial();
    else caption("start");
    $("menuVer").textContent = t("ui.version", { v: VERSION });
    const lastVer = +load(KEY_VER) || 0;
    store(KEY_VER, String(VERSION));
    if (lastVer && lastVer !== VERSION) toast(t("ui.updated", { v: VERSION }), 5000);   // shown while the page is still loading
    kick();
    // dev/test hook (not used by the game)
    PK.shell = { eng, setFiring, get busy() { return { spinning, bonusFlow, holdFire, mode }; } };
  }

  // ---------------------------------------------------------------- tutorial art
  // Real game frames (img/tutorial/, made by dev/make_tutorial_art.js) with labelled call-outs.
  // Coordinates are in the 320x170 art box (the frames are 640x340).
  const SVG = (body) => '<svg class="tutArt" viewBox="0 0 320 170" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">' + body + "</svg>";
  const pic = (n) => '<image href="img/tutorial/tut' + n + '.jpg" x="0" y="0" width="320" height="170" preserveAspectRatio="xMidYMid slice"/>';
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
  const TUT_ART = [
    SVG(pic(1) + arrow(160, 64, 160, 36) + tag(160, 76, t("tut.aHeso")) + arrow(267, 108, 267, 124) + tag(262, 96, t("tut.aHandle"))),
    SVG(pic(2) + tag(160, 156, t("tut.aSame"))),
    SVG(pic(3) + arrow(196, 152, 136, 152) + tag(250, 152, t("tut.aHolds"))),
    SVG(pic(4) + tag(160, 156, t("tut.aReach"))),
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
