// 炎舞ドラゴン v2 — Module 1: rules engine.  PK.createEngine(opts) -> engine
// Pure rules: never touches the DOM; timing comes from the shell. Spec: dev/CONTRACT.md "Module 1".
//
// Units: the engine counts balls (玉). `chips` is the ball balance (the shell shows it as 總玉數
// and as coins x100). Start 10000, each ball fired costs 1, each attacker entry pays 15.
//
// How a hold works (先読み, like a real machine): when a ball enters the heso or the 電チュー the
// engine latches its random numbers and decides the hold colour from the result. The hit itself is
// judged with the probability that applies when the hold is spun:
//  - 電チュー (rush) holds are always spun first and in order, so their spin-time state is known at
//    entry. Their result is final at entry (a hold that enters during the last ST spins is judged
//    at the normal chance if the ST will have run out by then).
//  - heso holds are judged at the normal chance at entry. If one is spun during RUSH (only when no
//    rush hold is waiting) it gets the RUSH chance from the same latched number, so a hit at entry
//    always stays a hit and a rainbow hold can never miss.
// Any hit spun in RUSH, and any 電チュー hit, uses the RUSH split (10R/6R/3R, back to RUSH).
// A heso hit in normal or 時短 is 3R and then RUSH (50%) or 時短 20 (50%).
//
// SpinScript extras (beyond the contract): src 'heso'|'denchu' (which hold was spun) and
// jitanAfter (時短 spins left, null outside 時短). `pseudo` counts 擬似連 continuations:
// 0 none, 1 = x2, 2 = x3, 3 = x4.
(function () {
  "use strict";
  const PK = (window.PK = window.PK || {});

  // ---------------------------------------------------------------------------------------------
  // Tunable data. Reliability (信頼度) = P(hit | the effect is shown).
  // For each effect you give the share of HITS that show it (`hit`, per reach tier) and its target
  // reliability (`rel`). The engine derives how often MISSES show it, spread over the miss tiers in
  // proportion to `shape`. So you can change a reliability by editing one number and the table
  // stays consistent. eng.derived holds the resulting probabilities; eng.warnings lists anything
  // that did not fit (a miss row summing over 1, a negative remainder).
  // Tables are read once by createEngine. A machine changes them with overrides in the same shape
  // (merged per section, see mergeTables): PK.MACHINES[id].engine via opts.machine, and/or
  // opts.tables. dev/engine_test.html prints every reliability.
  //
  // createEngine options: seed, startChips, restore (a serialize() string), exact (keep a restored
  // state as saved instead of settling it, see settle()), machine, tables, demoBoost.
  // Tiers: 'none' = no reach, then the reach types.
  // ---------------------------------------------------------------------------------------------
  const TABLES = {
    units: {
      startChips: 10000, ballCost: 1, payPerBall: 15,
      hesoRate: 1 / 10, denchuRate: 1 / 2.5, attackerRate: 0.9,
      roundEntries: 10, maxHolds: 4,
    },
    spec: {
      normalChance: 1 / 99.9, // normal and 時短
      rushChance: 1 / 7.3,    // 炎舞RUSH, ST 11 -> about 80% continuation
      st: 11,
      jitanSpins: 20,
      hesoKinds: { "3R": 1 },
      hesoRushShare: 0.5,     // heso hit -> RUSH, otherwise 時短 20
      denchuKinds: { "10R": 0.6, "6R": 0.25, "3R": 0.15 },
      rounds: { "3R": 3, "6R": 6, "10R": 10 },
    },
    digits: {
      sevenRush: { "10R": 0.45, "6R": 0.15, "3R": 0.05 }, // share of 7 on RUSH-bound hits (odd digits)
      sevenHeso: 0.25,  // share of 7 on a heso 3R that goes to RUSH
      nearMiss: 0.55,   // reach miss: centre digit one off the reach digit
    },

    normal: {
      tiers: ["none", "normal", "sp", "battle", "spsp"],
      holdColor: {
        hit: { green: 0.18, red: 0.17, gold: 0.1, rainbow: 0.05 }, // rest blue
        rel: { green: 0.15, red: 0.4, gold: 0.8, rainbow: 1 },
        change: { green: 0.35, red: 0.45, gold: 0.5, rainbow: 0.5 }, // share shown lower, then 保留変化 at spin start
      },
      tier: {
        hit: { normal: 0.29, sp: 0.2, battle: 0.24, spsp: 0.27 },
        rel: { normal: 0.03, sp: 0.12, battle: 0.35, spsp: 0.65 },
        // Misses from hot holds lean to strong reaches. The blue row is derived so the totals hold.
        missByColor: {
          green: { normal: 0.35, sp: 0.2, battle: 0.04, spsp: 0.01 },
          red: { normal: 0.3, sp: 0.35, battle: 0.17, spsp: 0.08 },
          gold: { normal: 0.05, sp: 0.3, battle: 0.35, spsp: 0.3 },
        },
      },
      kokuchi: 0.03, // share of hits announced (告知) before the reach; never on a miss
      revive: { sp: 0.06, battle: 0.12, spsp: 0.08 }, // share of hits shown as a 復活 fake-out
      push: { battle: 1, spsp: 0.4 },                  // PUSH chance-button finish
      reachColor: {
        def: "blue", reachOnly: true,
        hit: {
          normal: { red: 0.17, gold: 0.03 },
          sp: { red: 0.33, gold: 0.1, rainbow: 0.02 },
          battle: { red: 0.35, gold: 0.15, rainbow: 0.05 },
          spsp: { red: 0.4, gold: 0.28, rainbow: 0.12 },
        },
        rel: { red: 0.3, gold: 0.7, rainbow: 1 },
        shape: { red: { normal: 0.3, sp: 1, battle: 1.5, spsp: 2 }, gold: { sp: 1, battle: 2, spsp: 4 } },
      },
      stepup: {
        def: "0",
        hit: {
          normal: { 1: 0.2, 2: 0.15, 3: 0.08, 4: 0.02 },
          sp: { 1: 0.15, 2: 0.25, 3: 0.2, 4: 0.1, 5: 0.05 },
          battle: { 1: 0.1, 2: 0.2, 3: 0.25, 4: 0.18, 5: 0.12 },
          spsp: { 1: 0.05, 2: 0.12, 3: 0.2, 4: 0.25, 5: 0.3 },
        },
        rel: { 1: 0.03, 2: 0.06, 3: 0.15, 4: 0.35, 5: 0.75 },
        shape: {
          1: { none: 1, normal: 2, sp: 3, battle: 3, spsp: 3 },
          2: { none: 0.5, normal: 2, sp: 4, battle: 4, spsp: 4 },
          3: { none: 0.1, normal: 1, sp: 5, battle: 6, spsp: 6 },
          4: { normal: 0.2, sp: 3, battle: 6, spsp: 8 },
          5: { sp: 1, battle: 4, spsp: 8 },
        },
      },
      pseudo: {
        def: "0",
        hit: {
          normal: { 1: 0.15, 2: 0.05 },
          sp: { 1: 0.25, 2: 0.15, 3: 0.05 },
          battle: { 1: 0.25, 2: 0.2, 3: 0.1 },
          spsp: { 1: 0.25, 2: 0.25, 3: 0.2 },
        },
        rel: { 1: 0.12, 2: 0.35, 3: 0.8 },
        shape: {
          1: { none: 0.2, normal: 1, sp: 2, battle: 2, spsp: 2 },
          2: { normal: 0.3, sp: 2, battle: 3, spsp: 3 },
          3: { sp: 1, battle: 2, spsp: 4 },
        },
      },
      gun: { // 群予告 (dragon swarm)
        def: "no",
        hit: { normal: { yes: 0.05 }, sp: { yes: 0.15 }, battle: { yes: 0.2 }, spsp: { yes: 0.3 } },
        rel: { yes: 0.5 },
        shape: { yes: { normal: 0.2, sp: 1, battle: 2, spsp: 3 } },
      },
      cutin: {
        def: "none",
        hit: {
          normal: { blue: 0.15, red: 0.08, gold: 0.02 },
          sp: { blue: 0.2, red: 0.18, gold: 0.07 },
          battle: { blue: 0.2, red: 0.25, gold: 0.1 },
          spsp: { blue: 0.2, red: 0.3, gold: 0.2 },
        },
        rel: { blue: 0.1, red: 0.35, gold: 0.75 },
        shape: {
          blue: { none: 0.3, normal: 1, sp: 2, battle: 2, spsp: 2 },
          red: { normal: 0.3, sp: 1.5, battle: 2, spsp: 3 },
          gold: { sp: 1, battle: 2, spsp: 4 },
        },
      },
    },

    // 時短: RUSH-like quick spins at the normal chance. Hits that skip the reach are 一発告知.
    jitan: {
      tiers: ["none", "normal", "battle"],
      direct: true,
      holdColor: {
        hit: { green: 0.15, red: 0.13, gold: 0.08, rainbow: 0.04 },
        rel: { green: 0.15, red: 0.4, gold: 0.8, rainbow: 1 },
        change: { red: 0.3, gold: 0.4, rainbow: 0.5 },
      },
      tier: { hit: { normal: 0.3, battle: 0.35 }, rel: { normal: 0.05, battle: 0.4 } }, // rest: 一発告知
      revive: { battle: 0.12 },
      push: { battle: 1 },
      reachColor: {
        def: "blue", reachOnly: true,
        hit: { normal: { red: 0.25, gold: 0.05 }, battle: { red: 0.35, gold: 0.18, rainbow: 0.07 } },
        rel: { red: 0.3, gold: 0.7, rainbow: 1 },
        shape: { red: { normal: 0.5, battle: 2 }, gold: { normal: 0.2, battle: 2 } },
      },
    },

    // 炎舞RUSH: mostly fast spins, occasional short reaches, 一発告知 for direct hits.
    rush: {
      tiers: ["none", "normal", "battle"],
      direct: true,
      holdColor: {
        hit: { red: 0.1, gold: 0.06, rainbow: 0.02 },
        rel: { red: 0.45, gold: 0.85, rainbow: 1 },
        change: { red: 0.3, gold: 0.4, rainbow: 0.5 },
      },
      tier: { hit: { normal: 0.3, battle: 0.25 }, rel: { normal: 0.3, battle: 0.6 } }, // rest: 一発告知
      revive: { battle: 0.15 },
      push: { battle: 1 },
      reachColor: {
        def: "blue", reachOnly: true,
        hit: { normal: { red: 0.3, gold: 0.1 }, battle: { red: 0.35, gold: 0.22, rainbow: 0.08 } },
        rel: { red: 0.4, gold: 0.7, rainbow: 1 },
        shape: { red: { normal: 1, battle: 2 }, gold: { normal: 0.5, battle: 2 } },
      },
    },
  };

  const EFFECTS = ["reachColor", "stepup", "pseudo", "gun", "cutin"];
  const SPIN_MODES = ["normal", "jitan", "rush"];
  const COLOR_RANK = { blue: 0, green: 1, red: 2, gold: 3, rainbow: 4 };
  const COLOR_BY_RANK = ["blue", "green", "red", "gold", "rainbow"];
  const SLUMP_MAX = 600;
  const HISTORY_MAX = 100;
  const INFLIGHT_MAX = 256;
  // An attacker-bound ball still in flight reserves one of the round's 10 entries for this many
  // balls fired after it (generous for a 1.4-2.2 s flight at ~3 balls/s). The limit means a ball
  // that never arrives (e.g. lost in a page reload) cannot block the round for long.
  const RESERVE_SPAN = 16;

  // ---- table derivation (pure) ------------------------------------------------------------------
  // Miss mass that gives reliability R when a share h of hits shows the effect.
  function massFromRel(p, h, R, warn, what) {
    if (!h) return 0;
    if (!(R > 0)) { warn.push(what + ": reliability must be > 0"); return 0; }
    if (R >= 1) return 0;
    return (p * h * (1 - R)) / (R * (1 - p));
  }
  // Put the remainder of a distribution on its default key.
  function fillDef(row, def, warn, what) {
    let s = 0;
    for (const k in row) if (k !== def) s += row[k];
    if (s > 1 + 1e-9) {
      warn.push(what + " sums to " + s.toFixed(4) + " (> 1), scaled down");
      for (const k in row) if (k !== def) row[k] /= s;
      s = 1;
    }
    row[def] = Math.max(0, 1 - s);
    return row;
  }
  function deriveEffect(E, p, tierHit, tierMiss, tiers, warn, what) {
    const hit = {}, miss = {};
    for (const t of tiers) hit[t] = fillDef(Object.assign({}, (E.hit && E.hit[t]) || {}), E.def, warn, what + ".hit." + t);
    for (const t of tiers) miss[t] = {};
    for (const v in E.rel) {
      let H = 0;
      for (const t of tiers) H += tierHit[t] * (hit[t][v] || 0);
      const Mv = massFromRel(p, H, E.rel[v], warn, what + "." + v);
      if (!(Mv > 0)) continue;
      const sh = (E.shape && E.shape[v]) || {};
      let den = 0;
      for (const t of tiers) den += tierMiss[t] * (sh[t] || 0);
      if (!(den > 0)) { warn.push(what + "." + v + ": no miss shape"); continue; }
      for (const t of tiers) if (sh[t]) miss[t][v] = (Mv * sh[t]) / den;
    }
    for (const t of tiers) fillDef(miss[t], E.def, warn, what + ".miss." + t);
    return { def: E.def, reachOnly: !!E.reachOnly, hit, miss };
  }
  function deriveMode(M, p, warn, name) {
    const tiers = M.tiers;
    const reach = tiers.filter((t) => t !== "none");
    const D = { p, tiers };
    D.holdHit = fillDef(Object.assign({}, M.holdColor.hit), "blue", warn, name + ".holdColor.hit");
    const hm = {};
    for (const c in M.holdColor.rel) hm[c] = massFromRel(p, D.holdHit[c] || 0, M.holdColor.rel[c], warn, name + ".holdColor." + c);
    D.holdMiss = fillDef(hm, "blue", warn, name + ".holdColor.miss");
    D.holdChange = Object.assign({}, M.holdColor.change || {});
    const th = {};
    for (const t of reach) th[t] = M.tier.hit[t] || 0;
    D.tierHit = fillDef(th, "none", warn, name + ".tier.hit");
    if (!M.direct && D.tierHit.none > 1e-9) warn.push(name + ".tier.hit leaves " + D.tierHit.none.toFixed(4) + " of hits without a reach");
    const tm = {};
    for (const t of reach) tm[t] = massFromRel(p, D.tierHit[t], M.tier.rel[t], warn, name + ".tier." + t);
    D.tierMiss = fillDef(tm, "none", warn, name + ".tier.miss");
    if (M.tier.missByColor) {
      const by = {}, blue = {};
      for (const t of reach) {
        let rest = D.tierMiss[t];
        for (const c in M.tier.missByColor) rest -= (D.holdMiss[c] || 0) * (M.tier.missByColor[c][t] || 0);
        if (rest < -1e-12) warn.push(name + ".tier.missByColor leaves a negative blue share for " + t);
        blue[t] = Math.max(0, rest) / D.holdMiss.blue;
      }
      by.blue = fillDef(blue, "none", warn, name + ".tier.miss.blue");
      for (const c in M.tier.missByColor) by[c] = fillDef(Object.assign({}, M.tier.missByColor[c]), "none", warn, name + ".tier.miss." + c);
      D.tierMissByColor = by;
    }
    D.eff = {};
    for (const e of EFFECTS) {
      if (M[e]) D.eff[e] = deriveEffect(M[e], p, D.tierHit, D.tierMiss, M[e].reachOnly ? reach : tiers, warn, name + "." + e);
    }
    D.direct = !!M.direct;
    D.kokuchi = M.kokuchi || 0;
    D.revive = Object.assign({}, M.revive || {});
    D.push = Object.assign({}, M.push || {});
    return D;
  }
  function deriveTables(T, warn) {
    const out = {};
    for (const m of SPIN_MODES) out[m] = deriveMode(T[m], m === "rush" ? T.spec.rushChance : T.spec.normalChance, warn, m);
    return out;
  }

  // Cumulative form for fast sampling.
  function toCum(dist) {
    const k = [], c = [];
    let s = 0;
    for (const key in dist) {
      if (!(dist[key] > 0)) continue;
      s += dist[key];
      k.push(key);
      c.push(s);
    }
    return { k, c, s };
  }
  function pick(cum, r) {
    const x = r * cum.s;
    const c = cum.c;
    for (let i = 0; i < c.length; i++) if (x < c[i]) return cum.k[i];
    return cum.k[cum.k.length - 1];
  }
  function cumMap(obj) {
    const o = {};
    for (const k in obj) o[k] = toCum(obj[k]);
    return o;
  }
  function buildCum(D) {
    const C = {};
    for (const m of SPIN_MODES) {
      const d = D[m];
      const c = {
        holdHit: toCum(d.holdHit), holdMiss: toCum(d.holdMiss),
        tierHit: toCum(d.tierHit), tierMiss: toCum(d.tierMiss),
        tierMissByColor: d.tierMissByColor ? cumMap(d.tierMissByColor) : null,
        eff: {},
      };
      for (const e in d.eff) c.eff[e] = { hit: cumMap(d.eff[e].hit), miss: cumMap(d.eff[e].miss) };
      C[m] = c;
    }
    return C;
  }

  // ---- seedable RNG (mulberry32) ----------------------------------------------------------------
  function hashSeed(s) {
    if (typeof s === "number" && isFinite(s)) return s >>> 0;
    const str = String(s);
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function makeRng(seed) {
    const st = { s: seed >>> 0 };
    const next = function () {
      st.s = (st.s + 0x6d2b79f5) | 0;
      let t = Math.imul(st.s ^ (st.s >>> 15), 1 | st.s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.state = st;
    return next;
  }

  // ---- machine overrides and saves ---------------------------------------------------------------
  // Overrides merge per section: { spec: { normalChance: 1/39.9 } } keeps every other spec key.
  // Inside a section a key is replaced whole (e.g. spec.denchuKinds, normal.holdColor), so a
  // distribution is never half-merged.
  function mergeTables(base, over) {
    if (!over || typeof over !== "object") return base;
    const out = Object.assign({}, base);
    for (const k in over) {
      const v = over[k];
      out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" ? Object.assign({}, base[k], v) : v;
    }
    return out;
  }
  const SAVE_MODES = ["normal", "jitan", "rush", "bonusPending", "bonus"];
  function isHold(h) {
    return !!h && (h.src === "heso" || h.src === "denchu") && typeof h.r === "number" && typeof h.hit === "boolean" && typeof h.color === "string";
  }
  // A save that parses but has the wrong shape must not crash the shell at boot.
  function checkSave(o) {
    const s = o && o.S;
    const ok = !!s && o.v === 1 && typeof o.rng === "number" && typeof s === "object" &&
      SAVE_MODES.indexOf(s.mode) >= 0 && typeof s.chips === "number" && isFinite(s.chips) && s.chips >= 0 &&
      Array.isArray(s.holds) && Array.isArray(s.rushHolds) && s.holds.every(isHold) && s.rushHolds.every(isHold) &&
      !!s.stats && Array.isArray(s.stats.history) && Array.isArray(s.stats.slump) &&
      (!s.spinning || (Array.isArray(s.spinning.final) && typeof s.spinning.hit === "boolean"));
    if (!ok) throw new Error("not a valid engine save (v1)");
  }

  // ---- engine -----------------------------------------------------------------------------------
  function createEngine(opts) {
    opts = opts || {};
    const warnings = [];
    let save = null, restoreError = null;
    if (opts.restore) {
      try {
        save = typeof opts.restore === "string" ? JSON.parse(opts.restore) : JSON.parse(JSON.stringify(opts.restore));
        checkSave(save);
      } catch (e) {
        save = null;
        restoreError = String((e && e.message) || e);
      }
    }
    // Machine spec (contract: engine numbers come from the machine config). opts.machine is an id
    // in PK.MACHINES or a config object; its `engine` field overrides PK.engineTables, and
    // opts.tables overrides on top. A restore without opts.machine uses the machine in the save.
    const machine = opts.machine != null ? opts.machine : save && save.machine != null ? save.machine : null;
    let mcfg = machine;
    if (typeof machine === "string") {
      mcfg = PK.MACHINES && PK.MACHINES[machine];
      if (!mcfg) warnings.push("machine '" + machine + "' not in PK.MACHINES: default spec used");
    }
    const machineId = typeof machine === "string" ? machine : mcfg && typeof mcfg.id === "string" ? mcfg.id : null;
    const T = mergeTables(mergeTables(TABLES, mcfg && mcfg.engine), opts.tables);
    const U = T.units, SP = T.spec;
    const D = deriveTables(T, warnings);
    const C = buildCum(D);
    const C_KINDS = { heso: toCum(SP.hesoKinds), denchu: toCum(SP.denchuKinds) };
    const listeners = {};
    let boost = 1;
    let rng = makeRng(0);
    let S = null;
    let inflight = new Map();
    let diag = { projMismatch: 0, projCross: 0 };

    function freshState(startChips) {
      return {
        mode: "normal", chips: startChips,
        holds: [], rushHolds: [],
        st: 0, jitan: 0,
        spinning: null,
        bonusKind: null, bonusNext: null,
        round: 0, rounds: 0, roundCount: 0, roundGained: 0, bonusGained: 0, attackerOpen: false, roundToken: 0,
        chain: false, rushStreak: 0, rushGained: 0,
        ballSeq: 0, spinSeq: 0, slumpEvery: 1,
        tot: { start: startChips, fired: 0, paid: 0, refill: 0, lost: 0 },
        stats: { totalSpins: 0, spinsSinceHit: 0, hits: 0, rushHits: 0, maxChips: startChips, history: [], slump: [startChips] },
      };
    }

    if (save) {
      // Missing fields (an older save) take their fresh defaults.
      S = Object.assign(freshState(save.S.chips), save.S);
      S.stats = Object.assign(freshState(save.S.chips).stats, save.S.stats);
      rng = makeRng(save.rng);
      boost = opts.demoBoost != null ? +opts.demoBoost : +save.boost || 1;
      inflight = new Map(Array.isArray(save.inflight) ? save.inflight : []);
      diag = save.diag || diag;
    } else {
      const seed = opts.seed != null ? hashSeed(opts.seed) : (Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0;
      rng = makeRng(seed);
      boost = opts.demoBoost != null ? +opts.demoBoost : 1;
      const sc0 = opts.startChips != null ? Math.floor(+opts.startChips) : NaN;
      S = freshState(isFinite(sc0) ? Math.max(0, sc0) : U.startChips);
    }
    if (!(boost > 0)) boost = 1;

    // -- events
    // A listener that throws never stops the rest: ballArrived must still emit roundEnd/bonusEnd,
    // or the bonus would stall. The error is still reported: console.error with the real stack,
    // and rethrown asynchronously so window.onerror sees it (as "Script error." on file:// pages).
    function emit(name, payload) {
      const l = listeners[name];
      if (!l || !l.length) return;
      const arr = l.slice();
      for (let i = 0; i < arr.length; i++) {
        try { arr[i](payload); } catch (err) { reportListenerError(name, err); }
      }
    }
    function reportListenerError(name, err) {
      if (typeof console !== "undefined" && console.error) console.error("PK engine: '" + name + "' listener threw", err);
      setTimeout(function () { throw err; }, 0);
    }
    function on(name, fn) { if (typeof fn === "function") (listeners[name] = listeners[name] || []).push(fn); return eng; }
    function off(name, fn) {
      const l = listeners[name];
      if (!l) return eng;
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
      return eng;
    }
    function holdsPayload() {
      return { holds: S.holds.map((h) => ({ color: h.color })), rushHolds: S.rushHolds.map((h) => ({ color: h.color })) };
    }
    function setMode(to) {
      const from = S.mode;
      if (from === to) return;
      S.mode = to;
      emit("mode", { from, to });
    }

    // -- probabilities
    function chance(mode) {
      if (mode === "rush") return SP.rushChance;
      return Math.min(SP.normalChance * boost, SP.rushChance);
    }
    function missEnds(mode, st, jt) { return (mode === "rush" && st <= 0) || (mode === "jitan" && jt <= 0); }
    function afterBonus(next) {
      if (next === "rush") return ["rush", SP.st, 0];
      if (next === "jitan") return ["jitan", 0, SP.jitanSpins];
      return ["normal", 0, 0];
    }
    // Spin-time state for a 電チュー hold that enters now (it is spun after every rush hold already
    // queued, all of which have final results).
    function projectDenchu() {
      let x;
      if (S.mode === "bonusPending" || S.mode === "bonus") x = afterBonus(S.bonusNext);
      else if (S.spinning) x = S.spinning.hit ? afterBonus(S.spinning.next) : [missEnds(S.mode, S.st, S.jitan) ? "normal" : S.mode, S.st, S.jitan];
      else x = [S.mode, S.st, S.jitan];
      let mode = x[0], st = x[1], jt = x[2];
      for (const h of S.rushHolds) {
        if (mode === "rush") st--;
        else if (mode === "jitan") jt--;
        if (h.hit) { const y = afterBonus("rush"); mode = y[0]; st = y[1]; jt = y[2]; }
        else if (missEnds(mode, st, jt)) mode = "normal";
      }
      return mode;
    }
    function lowerColor(c) {
      const r = COLOR_RANK[c] || 0;
      if (r <= 1 || rng() < 0.7) return "blue";
      return COLOR_BY_RANK[r - 1];
    }
    function makeHold(src) {
      const r = rng(), r2 = rng(), r3 = rng();
      const pm = src === "denchu" ? projectDenchu() : "normal";
      if (src === "denchu" && pm !== S.mode) diag.projCross++;
      const hit = r < chance(pm);
      const eff = pick(hit ? C[pm].holdHit : C[pm].holdMiss, rng());
      let color = eff, change = null;
      const pc = D[pm].holdChange[eff] || 0;
      if (pc > 0 && rng() < pc) { color = lowerColor(eff); change = eff; }
      return { src, pm, r, r2, r3, hit, eff, color, change };
    }

    // -- balls
    function aim() { return S.mode === "normal" ? "left" : "right"; }
    function attackerInFlight() {
      let n = 0;
      inflight.forEach((b, id) => {
        if (b.target === "attacker" && b.rt === S.roundToken && S.ballSeq - id < RESERVE_SPAN) n++;
      });
      return n;
    }
    function fireBall() {
      if (S.chips < U.ballCost) return null;
      S.chips -= U.ballCost;
      S.tot.fired++;
      const side = aim();
      const m = S.mode, r = rng();
      let target = "out";
      if (m === "normal") { if (r < U.hesoRate) target = "heso"; }
      else if (m === "rush" || m === "jitan") { if (r < U.denchuRate) target = "denchu"; }
      else if (m === "bonus" && S.attackerOpen) {
        // A ball that would land after the round's 10th entry hits the closed door: it goes out,
        // so the cabinet never animates a ball into the attacker that pays nothing.
        if (r < U.attackerRate && S.roundCount + attackerInFlight() < U.roundEntries) target = "attacker";
      }
      const id = ++S.ballSeq;
      inflight.set(id, target === "attacker" ? { target, side, rt: S.roundToken } : { target, side });
      if (inflight.size > INFLIGHT_MAX) inflight.delete(inflight.keys().next().value);
      emit("chips", { chips: S.chips, delta: -U.ballCost });
      return { id, target, side };
    }
    // Returns { target, result:'hold'|'lost'|'pay'|'closed'|'out' } or null for an unknown id.
    // A ball counts with the target chosen when it was fired (the cabinet already animated it
    // into that pocket). 'closed' (an attacker ball landing after the door shut, no pay) only
    // happens if a reservation expired, e.g. after a restore with balls in flight.
    function ballArrived(id) {
      const b = inflight.get(id);
      if (!b) return null;
      inflight.delete(id);
      if (b.target === "heso" || b.target === "denchu") {
        const q = b.target === "heso" ? S.holds : S.rushHolds;
        if (q.length >= U.maxHolds) {
          S.tot.lost++;
          emit("lost", { target: b.target });
          return { target: b.target, result: "lost" };
        }
        q.push(makeHold(b.target));
        emit("holds", holdsPayload());
        return { target: b.target, result: "hold" };
      }
      if (b.target === "attacker") {
        if (S.mode !== "bonus" || !S.attackerOpen) return { target: "attacker", result: "closed" };
        const pay = U.payPerBall;
        S.chips += pay;
        S.tot.paid++;
        S.roundCount++;
        S.roundGained += pay;
        S.bonusGained += pay;
        if (S.chain) S.rushGained += pay;
        if (S.chips > S.stats.maxChips) S.stats.maxChips = S.chips;
        let re = null, be = null;
        if (S.roundCount >= U.roundEntries) {
          S.attackerOpen = false;
          const last = S.round >= S.rounds;
          re = { round: S.round, rounds: S.rounds, gained: S.roundGained, last };
          if (last) be = { gained: S.bonusGained, next: S.bonusNext };
        }
        emit("chips", { chips: S.chips, delta: pay });
        if (re) {
          emit("attacker", false);
          emit("roundEnd", re);
          if (be) emit("bonusEnd", be);
        }
        return { target: "attacker", result: "pay" };
      }
      return { target: b.target, result: "out" };
    }

    // -- spins
    function canSpin() {
      if (S.spinning) return false;
      if (S.mode !== "normal" && S.mode !== "jitan" && S.mode !== "rush") return false;
      return S.holds.length > 0 || S.rushHolds.length > 0;
    }
    function wrapDigit(x) { return ((x - 1 + 90) % 9) + 1; }
    function otherDigit(d) { let c = 1 + Math.floor(rng() * 8); if (c >= d) c++; return c; }
    // Hit digits: odd = RUSH-bound (確変-looking, 7 is the premium), even = 時短/normal-bound.
    function hitDigit(kind, next, fromHeso) {
      const G = T.digits;
      if (next === "rush") {
        const s7 = fromHeso ? G.sevenHeso : G.sevenRush[kind] || 0;
        return rng() < s7 ? 7 : [1, 3, 5, 9][Math.floor(rng() * 4)];
      }
      return [2, 4, 6, 8][Math.floor(rng() * 4)];
    }
    function startSpin() {
      if (!canSpin()) return null;
      const fromRush = S.rushHolds.length > 0;
      const q = fromRush ? S.rushHolds : S.holds;
      const before = q.length;
      const h = q.shift();
      const mode = S.mode;
      if (mode === "rush") S.st = Math.max(0, S.st - 1);
      else if (mode === "jitan") S.jitan = Math.max(0, S.jitan - 1);
      if (h.src === "denchu" && h.pm !== mode) diag.projMismatch++;
      const hit = h.hit || h.r < chance(mode);
      let kind = null, next = null;
      if (hit) {
        if (mode === "rush" || h.src === "denchu") { kind = pick(C_KINDS.denchu, h.r2); next = "rush"; }
        else {
          kind = pick(C_KINDS.heso, h.r2);
          next = h.r3 < SP.hesoRushShare ? "rush" : "jitan";
        }
      }
      const sc = buildScript(h, mode, hit, kind, next, before);
      S.spinning = sc;
      const st = S.stats;
      st.totalSpins++;
      st.spinsSinceHit++;
      if (st.totalSpins % S.slumpEvery === 0) {
        st.slump.push(S.chips);
        if (st.slump.length > SLUMP_MAX) {
          st.slump = st.slump.filter((_, i) => i % 2 === 0);
          S.slumpEvery *= 2;
        }
      }
      emit("holds", holdsPayload());
      if (mode === "rush") emit("st", { st: S.st });
      else if (mode === "jitan") emit("jitan", { jitan: S.jitan });
      return copyScript(sc); // the caller may decorate its copy; the saved one stays clean
    }
    function copyScript(sc) {
      return Object.assign({}, sc, { final: sc.final.slice(), reach: sc.reach ? Object.assign({}, sc.reach) : null });
    }
    function buildScript(h, mode, hit, kind, next, before) {
      const d = D[mode], c = C[mode];
      const oc = hit ? "hit" : "miss";
      let tier;
      if (hit) tier = pick(c.tierHit, rng());
      else if (c.tierMissByColor) tier = pick(c.tierMissByColor[h.eff] || c.tierMissByColor.blue, rng());
      else tier = pick(c.tierMiss, rng());
      function eff(name) {
        const e = c.eff[name];
        if (!e) return null;
        const row = e[oc][tier];
        return row ? pick(row, rng()) : null;
      }
      let reach = null;
      if (tier !== "none") {
        const color = eff("reachColor") || "blue";
        const push = rng() < (d.push[tier] || 0);
        const revive = hit && rng() < (d.revive[tier] || 0);
        reach = { type: tier, color, push, revive };
      }
      const su = eff("stepup"), ps = eff("pseudo"), gn = eff("gun"), ci = eff("cutin");
      const stepup = su ? +su : 0;
      const pseudo = ps ? +ps : 0;
      const gun = gn === "yes";
      const cutin = ci && ci !== "none" ? ci : null;
      let kokuchi = false;
      if (hit) kokuchi = tier === "none" ? d.direct : rng() < d.kokuchi;
      let final;
      if (hit) {
        const x = hitDigit(kind, next, mode !== "rush" && h.src === "heso");
        final = [x, x, x];
      } else if (reach) {
        const x = 1 + Math.floor(rng() * 9);
        const mid = rng() < T.digits.nearMiss ? wrapDigit(x + (rng() < 0.5 ? -1 : 1)) : otherDigit(x);
        final = [x, mid, x];
      } else {
        const l = 1 + Math.floor(rng() * 9);
        final = [l, 1 + Math.floor(rng() * 9), otherDigit(l)];
      }
      const quiet = !reach && !stepup && !pseudo && !gun && !cutin && !kokuchi && !h.change;
      const fast = mode === "normal" ? quiet && before >= 3 : !reach;
      return {
        id: ++S.spinSeq, mode, src: h.src, hit, kind, next, final,
        holdColor: h.color, holdChangeTo: h.change,
        pseudo, stepup, gun, cutin, kokuchi, reach, fast,
        stAfter: mode === "rush" ? S.st : null,
        jitanAfter: mode === "jitan" ? S.jitan : null,
      };
    }
    function endSpin() {
      const sc = S.spinning;
      if (!sc) return null;
      S.spinning = null;
      const from = S.mode;
      const st = S.stats;
      if (sc.hit) {
        st.hits++;
        st.history.push({ type: sc.kind, spins: st.spinsSinceHit, mode: from });
        if (st.history.length > HISTORY_MAX) st.history.shift();
        st.spinsSinceHit = 0;
        if (from === "normal") { S.chain = true; S.rushStreak = 1; S.rushGained = 0; }
        else { S.rushStreak++; if (from === "rush") st.rushHits++; }
        S.bonusKind = sc.kind;
        S.bonusNext = sc.next;
        S.st = 0;
        S.jitan = 0;
        setMode("bonusPending");
        if (from === "rush" || from === "jitan") emit("denchu", false);
      } else if (missEnds(from, S.st, S.jitan)) {
        // Commit the mode before any event: a rushEnd listener that starts the next spin at once
        // must get a normal-mode spin, not a 12th ST spin. Event order: rushEnd, mode, denchu.
        S.chain = false;
        S.mode = "normal";
        if (from === "rush") emit("rushEnd", { streak: S.rushStreak, gained: S.rushGained });
        emit("mode", { from, to: "normal" });
        emit("denchu", false);
      }
      return { hit: sc.hit, kind: sc.kind, next: sc.next, mode: S.mode };
    }

    // -- bonus
    function beginBonus() {
      if (S.mode !== "bonusPending") return false;
      S.rounds = SP.rounds[S.bonusKind] || 3;
      S.round = 1;
      S.roundCount = 0;
      S.roundGained = 0;
      S.bonusGained = 0;
      S.attackerOpen = true;
      S.roundToken++;
      setMode("bonus");
      emit("roundStart", { round: S.round, rounds: S.rounds });
      emit("attacker", true);
      return true;
    }
    function nextRound() {
      if (S.mode !== "bonus" || S.attackerOpen || S.round >= S.rounds || S.roundCount < U.roundEntries) return false;
      S.round++;
      S.roundCount = 0;
      S.roundGained = 0;
      S.attackerOpen = true;
      S.roundToken++;
      emit("roundStart", { round: S.round, rounds: S.rounds });
      emit("attacker", true);
      return true;
    }
    function finishBonus() {
      if (S.mode !== "bonus" || S.attackerOpen || S.round < S.rounds || S.roundCount < U.roundEntries) return false;
      const next = S.bonusNext || "normal";
      const x = afterBonus(next);
      S.st = x[1];
      S.jitan = x[2];
      S.round = 0;
      S.rounds = 0;
      S.roundCount = 0;
      S.roundGained = 0;
      if (next === "normal") S.chain = false;
      setMode(x[0]);
      if (next === "rush") { emit("st", { st: S.st }); emit("denchu", true); }
      else if (next === "jitan") { emit("jitan", { jitan: S.jitan }); emit("denchu", true); }
      return true;
    }

    function refill(amount) {
      let a = Math.max(0, Math.floor(amount == null ? U.startChips : +amount || 0));
      if (!isFinite(a)) a = 0; // Infinity would serialize as null and void the save
      S.chips += a;
      S.tot.refill += a;
      if (S.chips > S.stats.maxChips) S.stats.maxChips = S.chips;
      emit("chips", { chips: S.chips, delta: a });
      return S.chips;
    }

    function serialize() {
      // rng state as unsigned so a restored engine saves byte-identical text
      return JSON.stringify({ v: 1, machine: machineId, rng: rng.state.s >>> 0, boost, S, inflight: Array.from(inflight.entries()), diag });
    }

    // A restore lands in a state the plain contract flow can continue from, because a reloaded
    // shell has no 演出 in progress and no balls in the air:
    //  - balls in flight are gone (they were paid for and never arrive);
    //  - a spin in progress takes its already-decided result (its 演出 is skipped);
    //  - a pending jackpot opens round 1, a round break opens the next round, and a finished bonus
    //    enters RUSH / 時短 / normal.
    // After it, mode is normal/jitan/rush (idle) or bonus with the attacker open.
    // opts.exact keeps the saved state as it was (tests; or a shell that replays currentSpin()).
    function settle() {
      inflight.clear();
      if (S.spinning) endSpin();
      if (S.mode === "bonusPending") beginBonus();
      if (S.mode === "bonus" && !S.attackerOpen && !nextRound()) finishBonus();
    }
    if (save && !opts.exact) settle();

    function snapshot() {
      const st = S.stats;
      return {
        mode: S.mode, chips: S.chips,
        holds: S.holds.map((h) => ({ color: h.color })),
        rushHolds: S.rushHolds.map((h) => ({ color: h.color })),
        st: S.st, jitan: S.jitan,
        round: S.round, rounds: S.rounds, roundCount: S.roundCount,
        bonusGained: S.bonusGained, bonusKind: S.bonusKind, bonusNext: S.bonusNext,
        rushStreak: S.rushStreak, rushGained: S.rushGained,
        attacker: S.attackerOpen, denchu: S.mode === "rush" || S.mode === "jitan",
        spinning: !!S.spinning,
        stats: {
          totalSpins: st.totalSpins, spinsSinceHit: st.spinsSinceHit, hits: st.hits, rushHits: st.rushHits,
          maxChips: st.maxChips,
          history: st.history.map((x) => ({ type: x.type, spins: x.spins, mode: x.mode })),
          slump: st.slump.slice(), slumpEvery: S.slumpEvery,
        },
      };
    }

    const eng = {
      aim, fireBall, ballArrived, canSpin, startSpin, endSpin,
      beginBonus, nextRound, finishBonus, refill, on, off, serialize,
      tables: T,
      derived: D,
      warnings,
      restoreError,
      machine: machineId,
      demoBoost: boost,
      // Exact accounting: chips === start + refill - fired*ballCost + paid*payPerBall.
      totals: function () { return Object.assign({}, S.tot); },
      // projMismatch must stay 0: a 電チュー hold was spun in a different state than projected.
      diagnostics: function () { return Object.assign({ inflight: inflight.size }, diag); },
      // The script of the spin in progress (only after { restore, exact: true } can a fresh engine
      // have one: replay it, or call endSpin()).
      currentSpin: function () { return S.spinning ? copyScript(S.spinning) : null; },
    };
    Object.defineProperty(eng, "state", { get: snapshot, enumerable: true });
    return eng;
  }

  PK.engineTables = TABLES;
  PK.createEngine = createEngine;
})();
