// 霓虹天使 — machine 2's shell (hane.html): the cabinet around PK.Hane's field, sound and her voice,
// and the same services as 炎舞神龍's shell (src/shell.js): top bar, nav bar, save, free refill,
// daily missions and levels, login gift, records and achievements, settings, help, tutorial, lobby.
// Settings are shared with machine 1 (pk.settings); balls, records and missions are this machine's.
(function () {
  "use strict";
  const PK = window.PK, M = PK.MACHINES.neon, VERSION = PK.VERSION;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.floor(n).toLocaleString("en-US");
  const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] != null ? v[k] : ""));

  // ---------------------------------------------------------------- storage
  const load = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* not saved */ } };
  const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  const KEY_SAVE = "pk.neon.save", KEY_REC = "pk.neon.records", KEY_SET = "pk.settings", KEY_VER = "pk.version", KEY_MACHINE = "pk.machine";
  store(KEY_MACHINE, M.id);   // opening machine 1's page brings the player back here
  const set = Object.assign({ sound: true, volume: 0.8, voice: true, captions: true, wakeMin: 5, remind: true, hanePower: 0.45, haneTutorialSeen: false }, parse(load(KEY_SET)));
  const saveSettings = () => store(KEY_SET, JSON.stringify(set));
  const today = () => new Date().toDateString();
  const BEST = 0.45;

  // ---------------------------------------------------------------- toast and tips
  let toastTimer = 0;
  function toast(msg, ms) {
    const el = $("toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || 2200);
  }
  const queue = [];
  function nextToast() { if (!queue.length) return; toast(queue[0]); setTimeout(() => { queue.shift(); nextToast(); }, 2500); }
  const queueToast = (msg) => { queue.push(msg); if (queue.length === 1) nextToast(); };
  // 提示字幕: each tip once a session at most every 45 s, while the setting is on
  const TIPS = {
    start: "按右下的 PLAY 開始打珠。珠子進下面的入賞口，她的手臂就會張開接珠。",
    capture: "手臂接住的珠子在中間機關裡滾，掉下去時碰上金色的 V 窗就是大當！",
    chance: "CHANCE！這次 V 窗會停在中間附近，比較容易進。",
    gold: "金色珠子！V 窗停在正中間而且變寬。",
    jackpot: "大當！手臂會一直張開，這回合再有珠子進 V，就繼續下一回合。",
    od: "OVERDRIVE！第 5 回合起，每顆接到的珠子更值錢。",
    hack: "HACK 按鈕在發光，按下去看看！（不影響中獎機率）",
  };
  const tipLast = {};
  let tipTimer = 0;
  function tip(key) {
    if (!set.captions) return;
    const now = Date.now();
    if (tipLast[key] && now - tipLast[key] < 45000) return;
    tipLast[key] = now;
    const el = $("caption");
    el.lastChild.textContent = TIPS[key];
    el.classList.add("show");
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => el.classList.remove("show"), 4200);
  }

  // ---------------------------------------------------------------- records + achievements
  const ACH = [
    ["first", "第一次大當", "中第一次大當"],
    ["od", "OVERDRIVE", "連到第 5 回合"],
    ["r10", "十連", "一次大當連到第 10 回合"],
    ["r15", "滿貫", "一次大當連滿 15 回合"],
    ["gold", "金色珠子", "金色珠子被手臂接住"],
    ["hack10", "駭客", "在 HACK 發光時按下 10 次"],
    ["rich", "大豐收", "一次大當拿到 1,000 顆以上"],
    ["hits50", "常客", "累計中 50 次大當"],
  ];
  const rec = Object.assign({ hits: 0, bestRounds: 0, bestBonus: 0, od: 0, gold: 0, hack: 0, got: {} }, parse(load(KEY_REC)));
  rec.lv = Object.assign({ n: 1, xp: 0 }, rec.lv);
  const keepRec = () => store(KEY_REC, JSON.stringify(rec));
  function ach(id) {
    if (rec.got[id]) return;
    rec.got[id] = Date.now(); keepRec();
    queueToast("★ 解鎖成就「" + ACH.find((a) => a[0] === id)[1] + "」");
  }
  function showRecords() {
    const dl = $("recStats"), ul = $("recAch");
    dl.innerHTML = ""; ul.innerHTML = "";
    const add = (parent, tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return parent.appendChild(e); };
    [["大當次數", fmt(rec.hits) + " 次"], ["最多連續回合", fmt(rec.bestRounds) + " 回合"], ["單次大當最多", fmt(rec.bestBonus) + " 顆"],
      ["OVERDRIVE", fmt(rec.od) + " 次"], ["金色珠子", fmt(rec.gold) + " 次"], ["按出 HACK", fmt(rec.hack) + " 次"]].forEach(([k, v]) => { add(dl, "dt", null, k); add(dl, "dd", null, v); });
    $("recAchHead").textContent = "成就 " + ACH.filter((a) => rec.got[a[0]]).length + " / " + ACH.length;
    ACH.forEach(([id, name, how]) => {
      const li = add(ul, "li", rec.got[id] ? "got" : null);
      add(li, "i", null, rec.got[id] ? "★" : "☆").setAttribute("aria-hidden", "true");
      const d = add(li, "div"); add(d, "b", null, name); add(d, "small", null, how);
    });
  }

  // ---------------------------------------------------------------- 每日任務 + 等級 + 每日登入
  // As machine 1: three missions a day picked by the date, balls and 經驗; jackpots give 經驗 too.
  const MISSIONS = [   // [id, text, goal, balls, 經驗]
    ["fire", "打出 {n} 顆珠", 1500, 300, 30], ["capture", "手臂接住 {n} 顆珠", 40, 300, 30], ["chance", "看到 {n} 次 CHANCE", 3, 300, 30],
    ["hit", "中 {n} 次大當", 1, 500, 50], ["v", "珠子進 V {n} 次", 4, 400, 40], ["rounds", "一次大當連到第 {n} 回合", 5, 800, 80],
    ["hack", "在發光時按 HACK {n} 次", 3, 300, 30],
  ];
  const TITLES = ["見習駭客", "霓虹駭客", "天使之友", "夜城傳說", "霓虹天使之主"], TITLE_AT = [1, 3, 6, 10, 15];
  const LOGIN = [200, 300, 400, 500, 600, 800, 1000];
  const xpFor = (lv) => 100 * lv;
  const title = () => { let k = 0; TITLE_AT.forEach((at, i) => { if (rec.lv.n >= at) k = i; }); return TITLES[k]; };
  let recSaveT = 0;
  const saveRecSoon = () => { clearTimeout(recSaveT); recSaveT = setTimeout(keepRec, 3000); };
  function todays() {
    const d = today();
    if (!rec.day || rec.day.date !== d) {
      let h = 2166136261;
      for (const c of d + "neon") h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
      const pool = MISSIONS.map((m) => m[0]), ids = [];
      while (ids.length < 3) { h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0; ids.push(pool.splice(h % pool.length, 1)[0]); }
      rec.day = { date: d, ids, prog: {}, done: {}, hits: 0 };
      keepRec();
    }
    return rec.day;
  }
  function gainXp(n) {
    rec.lv.xp += n;
    while (rec.lv.xp >= xpFor(rec.lv.n)) { rec.lv.xp -= xpFor(rec.lv.n); rec.lv.n++; queueToast("▲ 升級！Lv." + rec.lv.n + "「" + title() + "」"); }
  }
  let pay = () => {};
  function step(id, v, isMax) {
    const day = todays();
    if (day.ids.indexOf(id) < 0 || day.done[id]) return;
    const m = MISSIONS.find((x) => x[0] === id);
    day.prog[id] = isMax ? Math.max(day.prog[id] || 0, v) : (day.prog[id] || 0) + v;
    if (day.prog[id] >= m[2]) {
      day.prog[id] = m[2]; day.done[id] = true;
      pay(m[3]);
      queueToast("✓ 任務完成「" + fill(m[1], { n: fmt(m[2]) }) + "」＋" + fmt(m[3]) + " 顆");
      gainXp(m[4]); keepRec();
    } else saveRecSoon();
  }
  const mis = { add: (id, n) => step(id, n || 1, false), max: (id, v) => step(id, v, true) };
  const loginPay = (d) => LOGIN[Math.min(d, LOGIN.length) - 1];
  function login() {
    const d = today(), L = rec.login || {};
    if (L.last === d) return null;
    const y = new Date(); y.setDate(y.getDate() - 1);
    const streak = L.last === y.toDateString() ? (L.streak || 0) + 1 : 1;
    rec.login = { last: d, streak }; keepRec();
    return { streak, n: loginPay(streak) };
  }
  function showMissions() {
    const day = todays(), ul = $("msList");
    $("msLevel").textContent = "Lv." + rec.lv.n + "　" + title();
    $("msXp").style.width = Math.round((100 * rec.lv.xp) / xpFor(rec.lv.n)) + "%";
    $("msXpTxt").textContent = "經驗 " + rec.lv.xp + " / " + xpFor(rec.lv.n) + "（滿了升級）";
    const d = (rec.login && rec.login.streak) || 1;
    $("msLogin").textContent = "已連續登入 " + d + " 天。明天再來送 " + fmt(loginPay(d + 1)) + " 顆（連續 7 天起每天 1,000 顆；中斷一天就從頭算）。";
    ul.innerHTML = "";
    day.ids.forEach((id) => {
      const m = MISSIONS.find((x) => x[0] === id), v = day.prog[id] || 0, li = document.createElement("li");
      if (day.done[id]) li.className = "got";
      li.innerHTML = "<i aria-hidden=\"true\"></i><div><b></b><small></small><span class=\"bar\"><u></u></span></div>";
      li.querySelector("i").textContent = day.done[id] ? "✓" : "";
      li.querySelector("b").textContent = fill(m[1], { n: fmt(m[2]) });
      li.querySelector("small").textContent = fmt(v) + " / " + fmt(m[2]) + "　獎勵 " + fmt(m[3]) + " 顆＋經驗 " + m[4];
      li.querySelector("u").style.width = Math.round((100 * v) / m[2]) + "%";
      ul.appendChild(li);
    });
  }

  // ---------------------------------------------------------------- 選擇機台
  function showLobby() {
    const ul = $("lobbyList");
    ul.innerHTML = "";
    const card = (img, name, line, tag, on, click) => {
      const li = document.createElement("li");
      if (on) li.className = "on";
      li.innerHTML = '<span class="pic"></span><div><b></b><small></small></div><em></em>';
      if (img) li.querySelector(".pic").style.backgroundImage = "url(" + img + ")";
      li.querySelector("b").textContent = name; li.querySelector("small").textContent = line; li.querySelector("em").textContent = tag;
      if (click) { li.tabIndex = 0; li.setAttribute("role", "button"); li.addEventListener("click", click); }
      return ul.appendChild(li);
    };
    Object.keys(PK.MACHINES).forEach((id) => {
      const m = PK.MACHINES[id], on = m === M;
      card(m.card ? m.assetsBase + m.card : null, m.name, m.tagline || "", on ? "遊玩中" : "切換", on,
        on ? null : () => { save(); store(KEY_MACHINE, id); location.href = m.page || "index.html"; });
    });
    card(null, "更多機台　製作中", "不同風格、不同玩法，敬請期待", "", false, null).classList.add("soon");
  }

  // ---------------------------------------------------------------- 名詞說明 + 新手教學
  const GLOSSARY = [
    ["玩法", [
      ["力道", "珠子打出去的力道。按「最佳」最容易進入賞口。"],
      ["入賞口", "下方三個口。兩側的讓手臂開 1 次（1開），中間的開 2 次（2開）；進去也會給幾顆珠子。"],
      ["羽根（はね）", "中間機關兩側她的機械手臂。張開時把旁邊落下的珠子接進機關。"],
      ["役物（やくもの）", "中間的機關。接進來的珠子在裡面滾，最後從中間的洞掉下去。"],
      ["V 窗", "機關底部左右滑動的金色窗口。掉下的珠子碰上它就是 V。"],
    ]],
    ["大當", [
      ["大當（大当り）", "平常珠子進 V 就中大當。大當時手臂會一直開，接到的珠子每顆給 10 顆。"],
      ["回合（ROUND）", "手臂開 18 次或接到 8 顆，這回合就結束；這回合有珠子進 V 才進下一回合，最多 15 回合。"],
      ["OVERDRIVE（超載）", "第 5 回合起：每顆接到的珠子給 12 顆，燈光和音樂全開。"],
    ]],
    ["好兆頭", [
      ["CHANCE", "手臂接到珠子時偶爾出現：這次 V 窗會停在中間附近，比較容易進。"],
      ["金色珠子", "很少出現的金珠；被接進去時 V 窗停在正中間而且變寬。"],
      ["慢動作", "決定勝負的珠子靠近 V 窗時，畫面會放慢、拉近。"],
      ["HACK 按鈕", "發光時按下會出現切入演出，跟真的機台的 PUSH 一樣，不影響中獎機率。"],
    ]],
  ];
  function buildGlossary() {
    const gl = $("glList");
    GLOSSARY.forEach(([head, items]) => {
      const h = document.createElement("h3"); h.textContent = head; gl.appendChild(h);
      const dl = document.createElement("dl");
      items.forEach(([term, def]) => { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = term; dd.textContent = def; dl.appendChild(dt); dl.appendChild(dd); });
      gl.appendChild(dl);
    });
  }
  // one picture (a real frame, img/tutorial/hane<n>.jpg made by dev/make_hane_tutorial.js), a title, two short lines
  const TUT = [
    ["按 PLAY 打珠", "按右下的 **PLAY**，珠子就會一直打出去。\n力道用下面的 **最佳** 就好。"],
    ["手臂會接珠", "珠子掉進下方的 **入賞口**，她的 **機械手臂** 就會張開。\n張開時接住的珠子會被送進中間機關。"],
    ["碰上 V 就大當", "機關裡的珠子掉下去時碰上金色的 **V** 窗，就是 **大當**！\n出現 **CHANCE** 或 **金色珠子** 時機會更大。"],
    ["大當與 OVERDRIVE", "大當時手臂一直張開；這回合再有珠子進 V，就 **繼續下一回合**（最多 15）。\n第 5 回合起是 **OVERDRIVE**。發光的 **HACK** 按鈕可以按按看。"],
  ];
  let tutPage = 0;
  function showTutorial() {
    const p = tutPage + 1, [ttl, body] = TUT[tutPage];
    $("tutArt").innerHTML = '<img class="tutArt" alt="" src="img/tutorial/hane' + p + '.jpg" onerror="this.remove()">';
    $("tutTitle").textContent = ttl;
    const el = $("tutBody");
    el.textContent = "";
    body.split("\n").forEach((line) => {
      const pEl = document.createElement("p");
      line.split("**").forEach((part, i) => { const n = i % 2 ? document.createElement("b") : document.createTextNode(part); if (i % 2) n.textContent = part; pEl.appendChild(n); });
      el.appendChild(pEl);
    });
    $("tutStep").textContent = p + " / " + TUT.length;
    $("tutDots").innerHTML = TUT.map((_, i) => "<i" + (i === tutPage ? ' class="on"' : "") + "></i>").join("");
    $("tutPrev").textContent = tutPage ? "上一頁" : "略過";
    $("tutNext").textContent = p === TUT.length ? "開始玩！" : "下一頁";
  }
  function endTutorial() { set.haneTutorialSeen = true; saveSettings(); closeSheets(); tip("start"); }

  // ---------------------------------------------------------------- sound
  // Everything goes through a softening filter: the user found the chosen music harsh (its highs
  // measured ~50% brighter than machine 1's) and picked 「柔和」 (-7 dB above 3 kHz, low-pass 9 kHz).
  // The master gain follows 設定 (sound on/off, volume).
  let ac = null, out = null, master = null, musicBus = null;
  function audioInit() {
    if (ac) return;
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; return; }
    const sh = ac.createBiquadFilter(), lp = ac.createBiquadFilter();
    master = ac.createGain();
    sh.type = "highshelf"; sh.frequency.value = 3000; sh.gain.value = -7;
    lp.type = "lowpass"; lp.frequency.value = 9000; lp.Q.value = 0.5;
    sh.connect(lp); lp.connect(master); master.connect(ac.destination); out = sh;
    musicBus = ac.createGain(); musicBus.gain.value = 0.55; musicBus.connect(out);
    applyVolume();
    music.load();
  }
  const applyVolume = () => { if (master) master.gain.value = set.sound ? set.volume : 0; };
  // A voice: an oscillator with a 5 ms attack (no click) and an exponential decay, optionally through
  // its own low-pass (lp Hz). Sines and triangles, not square waves.
  function tone(f0, f1, dur, type, vol, delay, lp) {
    if (!ac) return;
    const t = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1 || f0, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.06, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let n = o;
    if (lp) { const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; o.connect(f); n = f; }
    n.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
  }
  // a bell: a sine and quieter partials ringing out
  function bell(f, vol, delay, dur) {
    tone(f, f, dur || 0.5, "sine", vol, delay); tone(f * 2.01, f * 2.01, (dur || 0.5) * 0.6, "sine", vol * 0.35, delay); tone(f * 3, f * 3, (dur || 0.5) * 0.3, "sine", vol * 0.15, delay);
  }
  // a short burst of filtered noise (mechanical clicks, the servo)
  let noiseBuf = null;
  function noise(dur, freq, q, vol, delay) {
    if (!ac) return;
    if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const t = ac.currentTime + (delay || 0), s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + dur + 0.02);
  }
  const click = () => noise(0.03, 2400, 2, 0.05);
  // fetch + decode, cached
  const bufs = {};
  function buffer(url) {
    if (!bufs[url]) bufs[url] = fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status))).then((ab) => new Promise((ok, no) => ac.decodeAudioData(ab, ok, no)));
    return bufs[url];
  }
  // where a song has sound (AI songs can open and close on silence): loop that stretch
  function soundRange(b) {
    const d = b.getChannelData(0), th = 0.02, st = 256;
    let a = 0, e = d.length - 1;
    while (a < e && Math.abs(d[a]) < th) a += st;
    while (e > a && Math.abs(d[e]) < th) e -= st;
    return [a / b.sampleRate, e / b.sampleRate];
  }
  // music: normal / bonus / overdrive, crossfaded
  const music = {
    want: "", cur: null,
    load() { ["normal", "bonus", "od"].forEach((k) => buffer(M.assetsBase + "na_bgm_" + k + ".mp3").catch(() => {})); },
    set(k) {
      if (!ac || k === this.want) return;
      this.want = k;
      buffer(M.assetsBase + "na_bgm_" + k + ".mp3").then((b) => {
        if (this.want !== k) return;
        const t = ac.currentTime, src = ac.createBufferSource(), g = ac.createGain(), [a, e] = soundRange(b);
        src.buffer = b; src.loop = true; src.loopStart = a; src.loopEnd = e;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 1.2);
        src.connect(g); g.connect(musicBus); src.start(t, a);
        if (this.cur) { const c = this.cur; c.g.gain.setValueAtTime(c.g.gain.value, t); c.g.gain.linearRampToValueAtTime(0, t + 1.2); c.src.stop(t + 1.3); }
        this.cur = { src, g };
      }, () => {});
    },
  };
  // her voice (冥鳴ひまり): one line at a time, the music ducks under it
  let voiceUntil = 0;
  function voice(names, chance) {
    if (!ac || !set.voice || (chance != null && Math.random() > chance) || ac.currentTime < voiceUntil) return;
    const n = Array.isArray(names) ? names[Math.floor(Math.random() * names.length)] : names;
    buffer(M.assetsBase + "vo_" + n + ".wav").then((b) => {
      const t = ac.currentTime;
      if (t < voiceUntil) return;
      voiceUntil = t + b.duration;
      const src = ac.createBufferSource(), g = ac.createGain(); g.gain.value = 0.9;
      src.buffer = b; src.connect(g); g.connect(out); src.start(t);
      musicBus.gain.setTargetAtTime(0.25, t, 0.05); musicBus.gain.setTargetAtTime(0.55, t + b.duration, 0.3);
    }, () => {});
  }
  const SND = {
    chucker: () => { noise(0.04, 3200, 2, 0.06); bell(1568, 0.045, 0.01, 0.35); },
    wingOpen: () => { tone(180, 320, 0.22, "sawtooth", 0.03, 0, 700); noise(0.18, 900, 3, 0.02); },
    capture: () => { tone(660, 990, 0.08, "triangle", 0.06); bell(1319, 0.04, 0.06, 0.3); },
    lostIn: (d) => (d && d.near ? [587, 523, 440].forEach((f, i) => tone(f, f * 0.98, 0.22, "triangle", 0.05, i * 0.13)) : tone(260, 160, 0.3, "sine", 0.05)),
    v: () => [1047, 1319, 1568, 2093].forEach((f, i) => bell(f, 0.05, i * 0.06, 0.6)),
    jackpot: () => { [523, 659, 784].forEach((f) => tone(f, f, 1.4, "triangle", 0.045, 0, 2500)); [1047, 1319, 1568, 2093].forEach((f, i) => bell(f, 0.04, 0.15 + i * 0.08, 0.7)); },
    roundStart: () => [784, 1047].forEach((f, i) => bell(f, 0.05, i * 0.08, 0.4)),
    vRound: () => [988, 1319, 1760].forEach((f, i) => bell(f, 0.045, i * 0.06, 0.45)),
    bonusEnd: () => [784, 659, 523].forEach((f, i) => bell(f, 0.05, i * 0.14, 0.7)),
    vApproach: (d) => { if (d && d.decisive) [0, 0.32, 0.64].forEach((t) => { tone(70, 45, 0.14, "sine", 0.22, t); tone(60, 40, 0.1, "sine", 0.16, t + 0.12); }); },   // heartbeat
    chance: () => { tone(400, 1200, 0.35, "sawtooth", 0.035, 0, 1500); [880, 1175, 880, 1175].forEach((f, i) => tone(f, f, 0.1, "triangle", 0.05, 0.1 + i * 0.1)); },
    goldCapture: () => [1568, 1976, 2349, 3136].forEach((f, i) => bell(f, 0.035, i * 0.05, 0.6)),
    overdrive: () => { tone(160, 1400, 0.9, "sawtooth", 0.04, 0, 1800); [1047, 1319, 1568, 2093].forEach((f, i) => bell(f, 0.05, 0.55 + i * 0.08, 0.8)); },
  };
  const VOICE = {
    capture: (d) => { if (game.mode === "normal" && !d.gold) voice("na_capture", 0.25); },
    chance: () => voice("na_chance"),
    goldCapture: () => voice("na_gold"),
    lostIn: (d) => { if (d && d.near) voice(["na_near", "na_near2"]); },
    jackpot: () => { voiceUntil = 0; voice(["na_jackpot", "na_jackpot2"]); },
    vRound: () => voice(["na_vround", "na_vround2"]),
    overdrive: () => { voiceUntil = 0; voice("na_od"); },
    bonusEnd: (d) => { voiceUntil = 0; voice(d.rounds >= 10 ? "na_endbig" : "na_end"); },
  };

  // ---------------------------------------------------------------- the cabinet: LEDs, cut-in, HACK
  const cab = $("cab"), cut = $("cut");
  let flashUntil = 0, flashKind = "chance", hackUntil = 0;
  // the speakers pulse on the music's beat (normal 100, bonus 128, overdrive 150 BPM)
  const BEAT = { normal: 100, chance: 100, gold: 100, bonus: 128, od: 150 };
  const AMB = { normal: "rgba(33,160,255,0.3)", chance: "rgba(255,63,208,0.38)", gold: "rgba(255,200,60,0.4)", bonus: "rgba(255,200,60,0.4)", od: "rgba(255,63,208,0.45)" };
  function led() {
    const s = game.mode === "bonus" ? (game.round >= 5 ? "od" : "bonus") : performance.now() < flashUntil ? flashKind : "normal";
    if (cab.dataset.s !== s) {
      cab.dataset.s = s;
      cab.style.setProperty("--beat", (60 / BEAT[s]).toFixed(3) + "s");
      $("app").style.setProperty("--amb", AMB[s]);   // the hall glows with the machine
    }
    const lit = performance.now() < hackUntil;
    if ($("hack").dataset.lit !== (lit ? "1" : "0")) $("hack").dataset.lit = lit ? "1" : "0";
  }
  function cutIn(text, col) {
    $("cutT").textContent = text; cut.querySelector(".band").style.setProperty("--cc", col);
    cut.classList.remove("go"); void cut.offsetWidth; cut.classList.add("go");
  }
  // HACK: like 炎舞神龍's PUSH, a button for the moment, not for the odds. It lights for a few seconds
  // on a chance, a golden ball, the deciding ball's approach and a jackpot; pressed while lit it
  // answers with a HACK!! cut-in, a chime and a buzz, once per lighting.
  const lightHack = (sec) => { hackUntil = Math.max(hackUntil, performance.now() + sec * 1000); tip("hack"); };
  const CAB = {
    chance: () => { flashKind = "chance"; flashUntil = performance.now() + 3200; cutIn("CHANCE!!", "#ff3fd0"); lightHack(3); },
    goldCapture: () => { flashKind = "gold"; flashUntil = performance.now() + 3500; cutIn("GOLDEN!!", "#ffd34d"); lightHack(3.5); },
    vApproach: (d) => { if (d && d.decisive) lightHack(2); },
    jackpot: () => lightHack(3),
    vRound: () => cutIn("継続!!", "#21e6ff"),
  };
  // The wing sculptures beside the topper, drawn once per size (the AI drew whole robots instead of
  // a wing). A 200 x 300 box; the shoulder low on the inner side, a mechanical bone up and out, nine
  // armoured feathers fanning from it, each white metal with a pink neon edge; the right one mirrored.
  function drawWing(cv, hPx) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.style.height = hPx + "px"; cv.style.width = hPx * 2 / 3 + "px";
    cv.width = Math.round(hPx * 2 / 3 * dpr); cv.height = Math.round(hPx * dpr);
    const g = cv.getContext("2d"), P = [178, 250], B = [80, 110];
    g.setTransform(cv.width / 200, 0, 0, cv.height / 300, 0, 0);
    g.lineJoin = g.lineCap = "round";
    for (let i = 8; i >= 0; i--) {
      const t = i / 8, bx = P[0] + (B[0] - P[0]) * (0.12 + 0.88 * t), by = P[1] + (B[1] - P[1]) * (0.12 + 0.88 * t);
      const a = (165 + 72 * t) * Math.PI / 180, len = 70 + 35 * t + 10 * Math.sin(t * Math.PI);
      const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, hw = 9.5 - 2 * t;
      const tx = bx + ux * len, ty = by + uy * len;
      const pt = (f, s) => [bx + ux * len * f + nx * hw * s, by + uy * len * f + ny * hw * s];
      const path = new Path2D();
      const p0 = pt(0, 1), p1 = pt(0.35, 1.25), p2 = pt(0.35, -1.25), p3 = pt(0, -1);
      path.moveTo(p0[0], p0[1]); path.quadraticCurveTo(p1[0], p1[1], tx, ty); path.quadraticCurveTo(p2[0], p2[1], p3[0], p3[1]); path.closePath();
      const gr = g.createLinearGradient(bx, by, tx, ty);
      gr.addColorStop(0, "#4e5872"); gr.addColorStop(0.25, "#dfe6f5"); gr.addColorStop(0.8, "#ffffff"); gr.addColorStop(1, "#b8c3dc");
      g.fillStyle = gr; g.fill(path);
      g.strokeStyle = "rgba(8,11,20,0.85)"; g.lineWidth = 1.3; g.stroke(path);
      const e0 = pt(0.08, 1.02), e1 = pt(0.5, 1.05);
      for (const [lw, col] of [[5, "rgba(255,63,208,0.25)"], [1.6, "#ff5fdc"]]) {
        g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(e0[0], e0[1]); g.quadraticCurveTo(e1[0], e1[1], tx - ux * 6, ty - uy * 6); g.stroke();
      }
    }
    const bg = g.createLinearGradient(P[0], P[1] - 10, P[0] + 10, P[1]);
    bg.addColorStop(0, "#8e98b2"); bg.addColorStop(1, "#2a3044");
    g.strokeStyle = "#0a0d16"; g.lineWidth = 15; g.beginPath(); g.moveTo(P[0], P[1]); g.lineTo(B[0], B[1]); g.stroke();
    g.strokeStyle = bg; g.lineWidth = 12; g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 2; g.beginPath(); g.moveTo(P[0] - 3, P[1] - 4); g.lineTo(B[0] - 3, B[1] - 4); g.stroke();
    for (const [x, y, r] of [[P[0], P[1], 11], [B[0], B[1], 8], [(P[0] + B[0]) / 2, (P[1] + B[1]) / 2, 6]]) {
      const jg = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
      jg.addColorStop(0, "#ffffff"); jg.addColorStop(0.5, "#9aa4bd"); jg.addColorStop(1, "#2a3044");
      g.fillStyle = jg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      g.fillStyle = "#ff3fd0"; g.beginPath(); g.arc(x, y, r * 0.35, 0, 7); g.fill();
    }
  }
  // Fit the cabinet into the stage area (before the game's view measures the canvas; registered
  // first, so on a resize it runs before the view redraws). In field widths w: room for the wings
  // 0.13, the head 0.40, the frame's padding 2 x 0.045 (less a 0.01 overlap), the console 0.27
  // (+ 6 px); 1.09 w wide.
  function fit() {
    const m = $("stageWrap"), hr = PK.Hane.H / PK.Hane.W;
    const w = Math.max(100, Math.min((m.clientWidth - 8) / 1.09, (m.clientHeight - 14) / (0.88 + hr)));
    const c = $("hfield"); c.style.width = w + "px"; c.style.height = w * hr + "px";
    cab.style.setProperty("--w", w + "px");
    document.querySelectorAll(".wing").forEach((cv) => drawWing(cv, w * 0.4 * 1.7));
  }
  fit(); window.addEventListener("resize", fit);

  // ---------------------------------------------------------------- the game
  const saved = parse(load(KEY_SAVE));
  let bonusStart = 0;   // the balls when the jackpot began (for 單次大當最多)
  const game = PK.Hane.create({
    canvas: $("hfield"), chips: saved && saved.chips >= 0 ? saved.chips : M.refill, power: set.hanePower, art: M.assetsBase + "hane/",
    onEvent: (n, d) => {
      d = d || {};
      if (SND[n]) SND[n](d);
      if (VOICE[n]) VOICE[n](d);
      if (CAB[n]) CAB[n](d);
      led();
      if (n === "jackpot" || n === "roundStart") music.set(game.round >= 5 ? "od" : "bonus");
      if (n === "overdrive") music.set("od");
      if (n === "bonusEnd") music.set("normal");
      // records, missions, tips
      if (n === "fire") mis.add("fire");
      if (n === "capture") { mis.add("capture"); if (game.mode === "normal") tip("capture"); }
      if (n === "chance") { mis.add("chance"); tip("chance"); }
      if (n === "goldCapture") { rec.gold++; ach("gold"); tip("gold"); }
      if (n === "v") mis.add("v");
      if (n === "jackpot") {
        bonusStart = game.chips; rec.hits++; todays().hits = (todays().hits || 0) + 1;
        ach("first"); if (rec.hits >= 50) ach("hits50");
        mis.add("hit"); gainXp(10); keepRec(); tip("jackpot");
      }
      if (n === "roundStart") mis.max("rounds", d.round);
      if (n === "overdrive") { rec.od++; ach("od"); tip("od"); keepRec(); }
      if (n === "bonusEnd") {
        const gained = Math.max(0, game.chips - bonusStart);
        if (d.rounds > rec.bestRounds) rec.bestRounds = d.rounds;
        if (gained > rec.bestBonus) rec.bestBonus = gained;
        if (d.rounds >= 10) ach("r10");
        if (d.rounds >= 15) ach("r15");
        if (gained >= 1000) ach("rich");
        keepRec(); save();
      }
      if (n === "empty") { setPlay(false); openRefill(true); }
    },
  });
  pay = (n) => { game.chips += n; showChips(); save(); };
  function save() { store(KEY_SAVE, JSON.stringify({ chips: Math.floor(game.chips) })); }
  setInterval(save, 5000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) { save(); keepRec(); } });
  window.addEventListener("pagehide", () => { save(); keepRec(); });

  function showChips() {
    $("coinsVal").textContent = $("trayN").textContent = fmt(game.chips);
    $("dbToday").textContent = fmt(todays().hits || 0);
    $("dbHits").textContent = fmt(rec.hits);
    $("dbBest").textContent = fmt(rec.bestRounds);
  }

  // ---------------------------------------------------------------- controls
  let playStart = 0;
  function setPlay(on) {
    if (on) { audioInit(); if (ac && ac.state === "suspended") ac.resume(); if (!music.want) { music.set(game.mode === "bonus" ? "bonus" : "normal"); voice("na_start"); } }
    game.setFiring(on);
    $("play").setAttribute("aria-pressed", String(game.firing));
    $("play").textContent = game.firing ? "STOP" : "PLAY";
    if (game.firing && !playStart) playStart = Date.now();
  }
  $("play").addEventListener("click", () => { if (game.chips < 1) { openRefill(true); return; } setPlay(!game.firing); });
  $("hack").addEventListener("click", () => {
    audioInit();
    if (performance.now() < hackUntil) {
      hackUntil = 0;
      cutIn("HACK!!", "#21e6ff");
      [1319, 1760, 2349].forEach((f, i) => bell(f, 0.05, i * 0.05, 0.5));
      if (navigator.vibrate) navigator.vibrate(40);
      rec.hack++; if (rec.hack >= 10) ach("hack10"); mis.add("hack"); saveRecSoon();
    } else click();   // just the button's click
    led();
  });
  const showPow = () => { $("power").value = String(game.power); $("powV").textContent = Math.round(game.power * 100); };
  $("power").addEventListener("input", () => { game.setPower(+$("power").value); set.hanePower = game.power; saveSettings(); showPow(); });
  $("best").addEventListener("click", () => { game.setPower(BEST); set.hanePower = BEST; saveSettings(); showPow(); click(); });

  // ---------------------------------------------------------------- sheets
  function openSheet(id) {
    click();
    document.querySelectorAll(".sheet").forEach((s) => { s.hidden = s.id !== id; });
    const first = $(id).querySelector("button");
    if (first) first.focus({ preventScroll: true });
  }
  function closeSheets() { document.querySelectorAll(".sheet").forEach((s) => { s.hidden = true; }); }
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => { click(); closeSheets(); }));
  document.querySelectorAll(".sheet").forEach((s) => s.addEventListener("click", (e) => { if (e.target === s && s.id !== "tutorial") closeSheets(); }));
  document.querySelectorAll("#navBar [data-go]").forEach((b) => b.addEventListener("click", () => $(b.dataset.go).click()));
  $("menuBtn").addEventListener("click", () => openSheet("menu"));
  $("mLobby").addEventListener("click", () => { showLobby(); openSheet("lobby"); });
  $("mMissions").addEventListener("click", () => { showMissions(); openSheet("missions"); });
  $("mRecords").addEventListener("click", () => { showRecords(); openSheet("records"); });
  $("mGlossary").addEventListener("click", () => openSheet("glossary"));
  $("mTutorial").addEventListener("click", () => { tutPage = 0; showTutorial(); openSheet("tutorial"); });
  $("mRefill").addEventListener("click", () => openRefill(false));
  $("mSettings").addEventListener("click", () => { $("resetBox").hidden = false; $("resetAsk").hidden = true; showSettings(); openSheet("settings"); });
  $("tutPrev").addEventListener("click", () => { click(); if (tutPage) { tutPage--; showTutorial(); } else endTutorial(); });
  $("tutNext").addEventListener("click", () => { click(); if (tutPage < TUT.length - 1) { tutPage++; showTutorial(); } else endTutorial(); });

  function openRefill(empty) {
    $("refillTitle").textContent = empty ? "珠子用完了" : "免費補充珠子";
    $("refillBody").textContent = "這是免費遊戲，不用花錢。按下面的按鈕就能補充 " + fmt(M.refill) + " 顆珠子。";
    $("refillBtn").textContent = "免費補充 " + fmt(M.refill) + " 顆";
    openSheet("refill");
  }
  $("refillBtn").addEventListener("click", () => { pay(M.refill); closeSheets(); toast("已補充 " + fmt(M.refill) + " 顆珠子"); });

  // settings (shared with machine 1)
  const onOff = (id, on) => { $(id).setAttribute("aria-pressed", String(on)); $(id).textContent = on ? "開" : "關"; };
  function showSettings() {
    onOff("sSound", set.sound); onOff("sVoice", set.voice); onOff("sCaptions", set.captions); onOff("sRemind", set.remind);
    $("mSound").setAttribute("aria-pressed", String(set.sound));
    $("mSound").setAttribute("aria-label", set.sound ? "關閉聲音" : "打開聲音");
    $("sVolume").value = String(set.volume);
    document.querySelectorAll("#sWake button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.min === set.wakeMin)));
  }
  const toggle = (key, after) => () => { set[key] = !set[key]; saveSettings(); showSettings(); if (after) after(); click(); };
  $("sSound").addEventListener("click", toggle("sound", applyVolume));
  $("mSound").addEventListener("click", () => $("sSound").click());
  $("sVoice").addEventListener("click", toggle("voice"));
  $("sCaptions").addEventListener("click", toggle("captions", () => { if (!set.captions) $("caption").classList.remove("show"); }));
  $("sRemind").addEventListener("click", toggle("remind"));
  $("sVolume").addEventListener("input", () => { set.volume = +$("sVolume").value; applyVolume(); saveSettings(); });
  document.querySelectorAll("#sWake button").forEach((b) => b.addEventListener("click", () => { set.wakeMin = +b.dataset.min; saveSettings(); showSettings(); wake(); click(); }));
  $("sReset").addEventListener("click", () => {
    $("resetQ").textContent = "確定要從 " + fmt(M.refill) + " 顆珠子重新開始嗎？我的紀錄和等級都會保留。";
    $("resetBox").hidden = true; $("resetAsk").hidden = false;
  });
  $("sResetNo").addEventListener("click", () => { $("resetBox").hidden = false; $("resetAsk").hidden = true; });
  $("sResetYes").addEventListener("click", () => { game.chips = M.refill; save(); location.reload(); });

  // ---------------------------------------------------------------- 螢幕保持開啟 + 玩太久提醒
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
  let remindAt = 60;
  setInterval(() => {
    showChips(); led();
    if (set.remind && playStart && game.firing && (Date.now() - playStart) / 60000 >= remindAt) { toast("已經玩了 " + remindAt / 60 + " 小時，休息一下吧！", 5000); remindAt += 60; }
  }, 250);

  // ---------------------------------------------------------------- boot
  buildGlossary();
  showPow(); showSettings(); showChips(); led();
  $("menuVer").textContent = "目前版本：第 " + VERSION + " 版";
  const lastVer = +load(KEY_VER) || 0;
  store(KEY_VER, String(VERSION));
  if (lastVer && lastVer !== VERSION) toast("遊戲已更新到第 " + VERSION + " 版", 5000);
  const lg = login();
  if (lg) { pay(lg.n); queueToast("▲ 每日登入第 " + lg.streak + " 天：送 " + fmt(lg.n) + " 顆珠子"); }
  if (!set.haneTutorialSeen) { tutPage = 0; showTutorial(); openSheet("tutorial"); }
  else tip("start");
  // dev/test hook (not used by the game)
  window.__game = game;
  PK.haneShell = { game, rec, todays, cutIn };
})();
