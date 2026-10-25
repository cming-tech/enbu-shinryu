// src/sound.js — PK.Sound: synthesized sound effects and looping BGM beds (WebAudio only, no files).
//
// Design notes
// - Nothing happens before unlock(): play()/bgm()/setVolume()/setEnabled() only update plain state and
//   never create an AudioContext, schedule nodes or throw. SFX calls made while locked are dropped
//   (no queue). The last bgm() name is remembered as state and starts once the context is unlocked.
// - Every SFX is a short "voice": a handful of nodes feeding one voice gain. All sources get a stop
//   time; when the last one ends the whole voice is disconnected (plus a timer fallback). Voices are
//   capped (MAX_VOICES) and rate-limited per name, so rapid calls (balls, ticks, coins) stay cheap.
// - BGM beds are pre-rendered once into AudioBuffers with an OfflineAudioContext (ring-out folded back
//   onto the loop start, so loops are seamless) and then played as looping buffer sources. Playing a
//   bed costs almost no CPU; switching beds is an equal-power 300 ms crossfade.
// - The context is suspended while the page is hidden or sound is disabled.
(function () {
  "use strict";
  const PK = (window.PK = window.PK || {});
  const AC = window.AudioContext || window.webkitAudioContext;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  const SFX_NAMES = ["fire", "pocket", "lost", "spin", "tick", "stop", "reach", "reachUp", "stepup", "gun",
    "cutin", "pseudo", "holdChange", "push", "pushHit", "slash", "win", "lose", "kokuchi", "jackpot",
    "round", "payout", "rushIn", "rushEnd", "coin", "button"];
  const BGM_NAMES = ["normal", "reach", "battle", "bonus", "rush"];

  const MAX_VOICES = 24;     // hard cap on simultaneous SFX voices (oldest is stolen)
  const FADE = 0.3;          // BGM crossfade, seconds
  const BGM_LEVEL = 0.6;     // BGM bus level under the SFX
  const BED_SR = 32000;      // beds are rendered at this rate (memory vs. fidelity)
  const BED_TAIL = 2.0;      // seconds of ring-out folded back onto the loop start
  const BED_RMS = 0.16;      // beds are normalized to this RMS (peak capped at 0.95)
  const EPS = 0.0001;

  // Per-name rate limits: min gap between starts (s) and max simultaneous voices of that name.
  const RULES = {
    fire: [0.045, 3], tick: [0.03, 3], pocket: [0.04, 3], payout: [0.04, 3], coin: [0.03, 4],
    stop: [0.03, 3], button: [0.04, 2], lost: [0.06, 2], spin: [0.05, 2], stepup: [0.08, 3],
    pseudo: [0.15, 2], push: [0.1, 2],
  };
  const RULE_DEFAULT = [0.06, 2];
  // BGM ducking under big hits: [depth, hold seconds].
  const DUCK = { kokuchi: [0.25, 0.9], jackpot: [0.35, 1.2], rushIn: [0.35, 1.4], pushHit: [0.5, 0.5], win: [0.6, 0.8] };

  const M = Math.max;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const rnd = (a, b) => a + Math.random() * (b - a);

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- per-context shared buffers
  const caches = new WeakMap();
  function cacheOf(ac) {
    let c = caches.get(ac);
    if (!c) { c = {}; caches.set(ac, c); }
    return c;
  }
  function noiseBuffer(ac) {
    const c = cacheOf(ac);
    if (!c.noise) {
      const len = Math.floor(ac.sampleRate);
      const b = ac.createBuffer(1, len, ac.sampleRate);
      const d = b.getChannelData(0);
      const r = mulberry32(1234567);
      for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
      c.noise = b;
    }
    return c.noise;
  }
  function driveCurve(ac) {
    const c = cacheOf(ac);
    if (!c.drive) {
      const n = 1024, curve = new Float32Array(n), k = 2.5, norm = Math.tanh(k);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / norm; }
      c.drive = curve;
    }
    return c.drive;
  }

  // ---------------------------------------------------------------- node kit
  // Creates nodes on any BaseAudioContext. With a voice, every node is recorded for cleanup and every
  // source reports its end to the voice.
  function Kit(ac, voice, rand) { this.ac = ac; this.v = voice || null; this.rand = rand || Math.random; }
  const K = Kit.prototype;
  K.reg = function (n) { if (this.v) this.v.nodes.push(n); return n; };
  K.run = function (s, t0, t1) { s.start(t0); s.stop(t1); if (this.v) this.v.src(s, t1); return s; };
  K.gain = function (val, dest) {
    const g = this.reg(this.ac.createGain());
    g.gain.value = val;
    if (dest) g.connect(dest);
    return g;
  };
  K.filter = function (type, f, q, dest) {
    const b = this.reg(this.ac.createBiquadFilter());
    b.type = type; b.frequency.value = f;
    if (q != null) b.Q.value = q;
    if (dest) b.connect(dest);
    return b;
  };
  K.osc = function (type, f, t0, t1, dest) {
    const o = this.reg(this.ac.createOscillator());
    o.type = type; o.frequency.value = Math.min(f, 16000); // the browser clamps there anyway (and warns)
    if (dest) o.connect(dest);
    return this.run(o, t0, t1);
  };
  K.noise = function (t0, t1, dest) {
    const s = this.reg(this.ac.createBufferSource());
    s.buffer = noiseBuffer(this.ac); s.loop = true;
    if (dest) s.connect(dest);
    s.start(t0, this.rand() * 0.9); s.stop(t1);
    if (this.v) this.v.src(s, t1);
    return s;
  };
  // Returns the node to connect into (dest itself when StereoPanner is unavailable).
  K.pan = function (p, dest) {
    if (!this.ac.createStereoPanner) return dest;
    const n = this.reg(this.ac.createStereoPanner());
    n.pan.value = p; n.connect(dest);
    return n;
  };
  K.shaper = function (dest) {
    const w = this.reg(this.ac.createWaveShaper());
    w.curve = driveCurve(this.ac); w.connect(dest);
    return w;
  };

  // ---------------------------------------------------------------- envelopes
  function perc(p, t, peak, a, d) {
    p.setValueAtTime(EPS, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.exponentialRampToValueAtTime(EPS, t + a + d);
  }
  // Attack to peak, decay to sustain s*peak, hold until t1, release (sources stop at t1 + r + ~0.05).
  function adsr(p, t, peak, a, d, s, t1, r) {
    p.setValueAtTime(EPS, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.setTargetAtTime(peak * s, t + a, d / 3);
    p.setTargetAtTime(0, M(t1, t + a), r / 5);
  }
  function glide(p, t, f0, f1, dur) {
    p.setValueAtTime(f0, t);
    p.exponentialRampToValueAtTime(f1, t + dur);
  }

  // ---------------------------------------------------------------- building blocks (return end time)
  function blip(k, dest, type, f0, f1, t, a, d, peak) {
    const end = t + a + d + 0.02;
    const g = k.gain(0, dest);
    const o = k.osc(type, f0, t, end, g);
    if (f1 && f1 !== f0) glide(o.frequency, t, f0, f1, a + d);
    perc(g.gain, t, peak, a, d);
    return end;
  }
  function hiss(k, dest, type, f0, f1, q, t, a, d, peak) {
    const end = t + a + d + 0.02;
    const g = k.gain(0, dest);
    const fl = k.filter(type, f0, q, g);
    k.noise(t, end, fl);
    if (f1 && f1 !== f0) glide(fl.frequency, t, f0, f1, a + d);
    perc(g.gain, t, peak, a, d);
    return end;
  }
  // Two-operator FM bell. ratio ~3.5 = metallic, ~2 = celesta/koto-like.
  function bell(k, dest, f, t, dur, peak, ratio, index) {
    ratio = ratio || 3.5; index = index == null ? 2 : index;
    const end = t + dur + 0.05;
    const g = k.gain(0, dest);
    const car = k.osc("sine", f, t, end, g);
    const mg = k.gain(0, car.frequency);
    k.osc("sine", f * ratio, t, end, mg);
    mg.gain.setValueAtTime(f * index, t);
    mg.gain.exponentialRampToValueAtTime(f * index * 0.04 + 1, t + dur);
    perc(g.gain, t, peak, 0.002, dur);
    return end;
  }
  // Synth-brass chord: detuned saws that fall into pitch, one lowpass with a "blat" filter envelope.
  function brass(k, dest, ms, t, dur, peak, bright) {
    const n = ms.length * 2, end = t + dur + 0.3, top = bright || 3800;
    const g = k.gain(0, dest);
    const lp = k.filter("lowpass", 350, 1.8, g);
    for (let i = 0; i < ms.length; i++) {
      for (const det of [-8, 9]) {
        const s = k.osc("sawtooth", mtof(ms[i]), t, end, lp);
        s.detune.setValueAtTime(det - 40, t);
        s.detune.linearRampToValueAtTime(det, t + 0.05);
      }
    }
    const settle = t + M(0.05, Math.min(0.25, dur));
    lp.frequency.setValueAtTime(350, t);
    lp.frequency.exponentialRampToValueAtTime(top, t + 0.035);
    lp.frequency.exponentialRampToValueAtTime(top * 0.45, settle);
    lp.frequency.setTargetAtTime(400, M(settle, t + dur) + 0.001, 0.08);
    adsr(g.gain, t, peak / Math.sqrt(n), 0.012, 0.25, 0.65, t + dur, 0.22);
    return end;
  }
  function kick(k, dest, t, peak) {
    const g = k.gain(0, dest);
    const o = k.osc("sine", 160, t, t + 0.4, g);
    glide(o.frequency, t, 160, 48, 0.11);
    perc(g.gain, t, peak, 0.002, 0.32);
    hiss(k, dest, "highpass", 3000, 0, 0.7, t, 0.001, 0.012, peak * 0.25);
    return t + 0.4;
  }
  function taiko(k, dest, t, peak, f) {
    f = f || 90;
    const g = k.gain(0, dest);
    const o = k.osc("sine", f * 1.6, t, t + 0.7, g);
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    o.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.6);
    perc(g.gain, t, peak, 0.003, 0.6);
    hiss(k, dest, "lowpass", 1400, 300, 0.7, t, 0.002, 0.12, peak * 0.5);
    blip(k, dest, "sine", f * 2.6, f * 2.2, t, 0.002, 0.15, peak * 0.35);   // drum-head mode, audible on phones
    return t + 0.7;
  }
  // Mid-range "boom" under an impact: square harmonics land at 300-900 Hz, where phone speakers still
  // play, so hits keep their weight when the sub-bass is lost.
  function punch(k, dest, t, f0, peak, dur) {
    const lp = k.filter("lowpass", 1100, 0.8, dest);
    return blip(k, lp, "square", f0, f0 * 0.45, t, 0.002, dur, peak);
  }
  function crash(k, dest, t, dur, peak) {
    const e = hiss(k, dest, "highpass", 5200, 0, 0.6, t, 0.002, dur, peak);
    hiss(k, dest, "bandpass", 8500, 6000, 1.2, t, 0.001, dur * 0.5, peak * 0.6);
    return e;
  }
  function sub(k, dest, t, f0, f1, dur, peak) {
    const g = k.gain(0, dest);
    const s = k.osc("sine", f0, t, t + dur + 0.05, g);
    glide(s.frequency, t, f0, f1, dur);
    perc(g.gain, t, peak, 0.003, dur);
    return t + dur + 0.05;
  }
  // A gain that feeds dest and (optionally) the shared echo send.
  function bus(k, dest, r, send) {
    const g = k.gain(1, dest);
    if (send) g.connect(k.gain(send, r.fx));
    return g;
  }
  // Successive calls within `win` seconds count up 1..max (step-up levels, pseudo ×2/×3).
  function counter(r, key, t, win, max) {
    const c = r.count[key] || (r.count[key] = [0, -99]);
    c[0] = t - c[1] < win ? Math.min(max, c[0] + 1) : 1;
    c[1] = t;
    return c[0];
  }

  // ---------------------------------------------------------------- sound effects
  // Each: (kit, voiceOut, rig, startTime) -> end time.
  const SFX = {
    // Ball launch: the hammer flicks a steel ball up the rail — a bright metallic "chik" and a
    // short rattle, no low thump (the old 240->90 Hz thump sounded like a drum, not a ball).
    // Repeats 100 times a minute, so it stays small.
    fire(k, o, r, t) {
      const f = rnd(0.95, 1.05);
      hiss(k, o, "highpass", 3800 * f, 0, 0.7, t, 0.0004, 0.008, 0.13);
      let e = blip(k, o, "sine", 3150 * f, 0, t, 0.0004, 0.03, 0.05);
      e = M(e, blip(k, o, "sine", 5230 * f, 0, t, 0.0004, 0.02, 0.035));
      hiss(k, o, "bandpass", 5200 * f, 4200 * f, 1.6, t + 0.012, 0.012, 0.09, 0.025);
      return M(e, t + 0.13);
    },
    // Start-pocket entry: bright two-note glass chime.
    pocket(k, o, r, t) {
      const g = bus(k, o, r, 0.25);
      let e = bell(k, g, 1318.5, t, 0.28, 0.2, 3.01, 1.2);
      e = M(e, bell(k, g, 1975.5, t + 0.055, 0.45, 0.22, 3.01, 1.2));
      blip(k, g, "sine", 5274, 0, t + 0.055, 0.001, 0.06, 0.04);
      hiss(k, o, "highpass", 6000, 0, 0.7, t, 0.001, 0.012, 0.14);
      return e;
    },
    // Overflow entry (hold full): two dull falling blips.
    lost(k, o, r, t) {
      const lp = k.filter("lowpass", 1100, 1, o);
      blip(k, lp, "square", 330, 196, t, 0.004, 0.11, 0.16);
      return blip(k, lp, "square", 220, 131, t + 0.1, 0.004, 0.16, 0.16);
    },
    // Reels start: rising "shuun".
    spin(k, o, r, t) {
      const e = hiss(k, o, "bandpass", 500, 4500, 2.2, t, 0.05, 0.2, 0.5);
      const lp = k.filter("lowpass", 2400, 0.7, o);
      blip(k, lp, "square", 320, 1280, t, 0.01, 0.14, 0.1);
      return M(e, t + 0.3);
    },
    // A ball bouncing off a brass pin: a tiny, quiet "tik" at a random pitch. Several balls hit
    // pins every second, so together they make the machine's soft metallic rattle.
    tick(k, o, r, t) {
      const f = rnd(0.85, 1.15), a = rnd(0.7, 1);
      let e = blip(k, o, "sine", 4300 * f, 0, t, 0.0005, 0.022, 0.05 * a);
      e = M(e, blip(k, o, "sine", 6850 * f, 0, t, 0.0005, 0.012, 0.028 * a));
      hiss(k, o, "highpass", 6000, 0, 0.7, t, 0.0003, 0.004, 0.045 * a);
      return e;
    },
    // Reel stop: firm "kachi".
    stop(k, o, r, t) {
      const lp = k.filter("lowpass", 1800, 1, o);
      let e = blip(k, lp, "square", 190, 105, t, 0.001, 0.06, 0.3);
      e = M(e, hiss(k, o, "highpass", 2500, 0, 0.7, t, 0.001, 0.025, 0.28));
      return M(e, blip(k, o, "triangle", 1050, 0, t, 0.001, 0.05, 0.08));
    },
    // Reach: rising chime run into a shimmering held chord.
    reach(k, o, r, t) {
      const g = bus(k, o, r, 0.35);
      const run = [74, 77, 81, 84, 86, 89, 93, 98];
      let e = t;
      for (let i = 0; i < run.length; i++) e = M(e, bell(k, g, mtof(run[i]), t + i * 0.045, 0.7 - i * 0.03, 0.14, 2, 1.4));
      hiss(k, o, "bandpass", 800, 6000, 1.5, t, 0.3, 0.25, 0.1);
      const h = t + 0.36, end = h + 1.0;
      const env = k.gain(0, g);
      const trem = k.gain(0.6, env);
      k.osc("sine", 13, h, end, k.gain(0.4, trem.gain));
      for (const m of [86, 93, 98]) k.osc("triangle", mtof(m), h, end, trem);
      perc(env.gain, h, 0.1, 0.02, 0.95);
      kick(k, o, h, 0.5);
      return M(e, end);
    },
    // Reach development: riser into an impact chord.
    reachUp(k, o, r, t) {
      hiss(k, o, "bandpass", 300, 5000, 2, t, 0.5, 0.06, 0.28);
      const lp = k.filter("lowpass", 600, 2, o);
      glide(lp.frequency, t, 600, 5000, 0.55);
      const g = k.gain(0, lp);
      for (const det of [0, 14]) {
        const s = k.osc("sawtooth", 110, t, t + 0.62, g);
        s.detune.value = det;
        glide(s.frequency, t, 110, 440, 0.55);
      }
      g.gain.setValueAtTime(EPS, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.5);
      g.gain.linearRampToValueAtTime(EPS, t + 0.6);
      const h = t + 0.55;
      taiko(k, o, h, 0.8, 70); punch(k, o, h, 130, 0.25, 0.3);
      const b = bus(k, o, r, 0.25);
      crash(k, b, h, 1.0, 0.22);
      return M(brass(k, b, [62, 65, 69, 74], h, 0.45, 0.5), h + 1.1);
    },
    // Step-up notice: punchy stab; calls in quick succession climb in pitch (levels 1..5).
    stepup(k, o, r, t) {
      const lv = counter(r, "stepup", t, 1.8, 5);
      const root = 62 + [0, 0, 3, 5, 7, 12][lv];
      const lp = k.filter("lowpass", 3200 + lv * 500, 1, bus(k, o, r, 0.2));
      let e = t;
      for (const [type, m, pk] of [["square", root + 12, 0.12], ["sawtooth", root + 19, 0.09], ["square", root, 0.1]]) {
        const g = k.gain(0, lp);
        const s = k.osc(type, mtof(m - 2), t, t + 0.3, g);
        glide(s.frequency, t, mtof(m - 2), mtof(m), 0.03);
        perc(g.gain, t, pk, 0.003, 0.24);
        e = M(e, t + 0.3);
      }
      kick(k, o, t, 0.45);
      hiss(k, o, "highpass", 4000, 0, 0.7, t, 0.001, 0.02, 0.2);
      if (lv >= 4) for (let i = 0; i < 4; i++) e = M(e, bell(k, lp, mtof(root + 24 + [0, 4, 7, 12][i]), t + 0.04 + i * 0.04, 0.4, 0.06, 3.5, 1));
      if (lv >= 5) e = M(e, crash(k, o, t, 1.0, 0.2));
      return e;
    },
    // Dragon swarm: fluttering roar that sweeps left to right.
    gun(k, o, r, t) {
      const dur = 1.5, end = t + dur + 0.05;
      const p = k.pan(-0.8, o);
      if (p !== o) { p.pan.setValueAtTime(-0.8, t); p.pan.linearRampToValueAtTime(0.8, t + dur); }
      const trem = k.gain(0.6, p);
      k.osc("sine", 16, t, end, k.gain(0.4, trem.gain));
      const env = k.gain(0, trem);
      const lp = k.filter("lowpass", 300, 1.5, env);
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.exponentialRampToValueAtTime(2200, t + 0.7);
      lp.frequency.exponentialRampToValueAtTime(500, t + dur);
      k.noise(t, end, lp);
      const bp = k.filter("bandpass", 520, 1.2, env);
      const s = k.osc("sawtooth", 60, t, end, bp);
      s.frequency.setValueAtTime(60, t);
      s.frequency.exponentialRampToValueAtTime(95, t + 0.7);
      s.frequency.exponentialRampToValueAtTime(55, t + dur);
      env.gain.setValueAtTime(EPS, t);
      env.gain.linearRampToValueAtTime(0.55, t + 0.6);
      env.gain.linearRampToValueAtTime(0.4, t + 1.0);
      env.gain.exponentialRampToValueAtTime(EPS, t + dur);
      for (let i = 0; i < 5; i++) blip(k, o, "sine", 85, 50, t + 0.15 + i * 0.22, 0.004, 0.12, 0.22);
      return end;
    },
    // Cut-in banner: "shakiin" swish, metal ring, impact.
    cutin(k, o, r, t) {
      hiss(k, o, "highpass", 1500, 9000, 0.8, t, 0.08, 0.06, 0.32);
      const g = bus(k, o, r, 0.4), h = t + 0.1;
      let e = h;
      [1, 1.47, 2.09, 2.76].forEach((m, i) => { e = M(e, blip(k, g, "sine", 1660 * m, 0, h, 0.001, 0.7 - i * 0.12, 0.08)); });
      blip(k, o, "sine", 140, 45, h, 0.002, 0.25, 0.6); punch(k, o, h, 150, 0.2, 0.2);
      hiss(k, o, "lowpass", 3000, 400, 0.7, h, 0.001, 0.15, 0.4);
      return M(e, h + 0.3);
    },
    // Pseudo-continuation: "DON!" taiko + chime that climbs with ×2 / ×3.
    pseudo(k, o, r, t) {
      const n = counter(r, "pseudo", t, 4, 3);
      taiko(k, o, t, 0.5, 82); punch(k, o, t, 320, 0.5, 0.22);
      hiss(k, o, "bandpass", 1300, 0, 0.9, t, 0.001, 0.14, 0.55);
      const g = bus(k, o, r, 0.4), m = [81, 81, 86, 88][n];
      const e = bell(k, g, mtof(m), t + 0.02, 0.9, 0.17, 2, 1.5);
      bell(k, g, mtof(m + 7), t + 0.02, 0.7, 0.09, 2, 1.2);
      return M(e, t + 0.7);
    },
    // Hold colour change: ascending sparkle with a glissando.
    holdChange(k, o, r, t) {
      const g = bus(k, o, r, 0.4);
      const sc = [84, 86, 89, 91, 93, 96, 98, 101, 103, 105];
      let e = t;
      for (let i = 0; i < sc.length; i++) e = M(e, bell(k, g, mtof(sc[i]), t + i * 0.028, 0.35, 0.065, 3.5, 1));
      const gg = k.gain(0, g);
      const s = k.osc("triangle", 700, t, t + 0.42, gg);
      glide(s.frequency, t, 700, 3400, 0.35);
      perc(gg.gain, t, 0.07, 0.05, 0.32);
      return M(e, t + 0.42);
    },
    // PUSH prompt: two-tone alarm.
    push(k, o, r, t) {
      const lp = k.filter("lowpass", 4500, 0.7, o);
      let e = t;
      for (let i = 0; i < 4; i++) e = blip(k, lp, "square", i % 2 ? 990 : 1320, 0, t + i * 0.09, 0.002, 0.07, 0.12);
      return e;
    },
    // PUSH button hit: big impact.
    pushHit(k, o, r, t) {
      sub(k, o, t, 170, 36, 0.55, 0.85); punch(k, o, t, 150, 0.3, 0.3);
      hiss(k, o, "lowpass", 4000, 500, 0.7, t, 0.001, 0.22, 0.5);
      const b = bus(k, o, r, 0.22);
      crash(k, b, t, 1.0, 0.2);
      return M(brass(k, b, [62, 66, 69, 74], t + 0.01, 0.22, 0.45), t + 1.0);
    },
    // Sword slash: swish + blade ring.
    slash(k, o, r, t) {
      hiss(k, o, "bandpass", 7500, 900, 3, t, 0.02, 0.14, 0.6);
      hiss(k, o, "highpass", 5000, 0, 0.7, t + 0.01, 0.001, 0.05, 0.2);
      const g = bus(k, o, r, 0.3);
      const e = blip(k, g, "sine", 3150, 0, t + 0.05, 0.001, 0.4, 0.08);
      blip(k, g, "sine", 4730, 0, t + 0.05, 0.001, 0.25, 0.05);
      blip(k, o, "sine", 160, 60, t + 0.04, 0.002, 0.12, 0.3);
      return e;
    },
    // Battle won: brass pickups into a major chord.
    win(k, o, r, t) {
      const g = bus(k, o, r, 0.3);
      [67, 72, 76].forEach((m, i) => brass(k, g, [m, m + 12], t + i * 0.09, 0.07, 0.3));
      const h = t + 0.27;
      let e = brass(k, g, [60, 64, 67, 72, 76], h, 0.85, 0.55, 4500);
      taiko(k, o, h, 0.8, 75); punch(k, o, h, 130, 0.22, 0.25);
      e = M(e, crash(k, g, h, 1.4, 0.22));
      [84, 88, 91, 96].forEach((m, i) => { e = M(e, bell(k, g, mtof(m), h + 0.05 + i * 0.05, 0.6, 0.07, 3.5, 1)); });
      return e;
    },
    // Battle lost: falling minor line and a low gong.
    lose(k, o, r, t) {
      const g = bus(k, o, r, 0.25);
      const lp = k.filter("lowpass", 2200, 1, g);
      glide(lp.frequency, t, 2200, 300, 1.2);
      [69, 65, 62].forEach((m, i) => blip(k, lp, "sawtooth", mtof(m), mtof(m) * 0.97, t + i * 0.16, 0.01, 0.55, 0.14));
      const e = bell(k, g, 98, t + 0.32, 1.3, 0.3, 1.4, 3);
      blip(k, o, "sine", 90, 40, t + 0.32, 0.005, 0.5, 0.4);
      return e;
    },
    // Kokuchi "ZUDON!": click, driven sub drop, blast, crash and a low gong.
    kokuchi(k, o, r, t) {
      hiss(k, o, "highpass", 2000, 0, 0.7, t, 0.0005, 0.02, 0.5);
      const sg = k.gain(0, k.shaper(k.gain(0.22, o)));
      const s = k.osc("sine", 130, t, t + 1.0, sg);
      glide(s.frequency, t, 130, 28, 0.9);
      perc(sg.gain, t, 1.6, 0.003, 0.9); punch(k, o, t, 300, 0.65, 0.4);
      hiss(k, o, "bandpass", 900, 400, 1.0, t, 0.002, 0.35, 0.5);   // mid rumble so the hit reads on phones
      hiss(k, o, "lowpass", 6000, 300, 0.6, t, 0.001, 0.5, 0.6);
      const b = bus(k, o, r, 0.3);
      crash(k, b, t + 0.01, 1.8, 0.34);
      return bell(k, b, 73.4, t + 0.02, 2.0, 0.35, 1.41, 4);
    },
    // Jackpot: big brass chord stab, taiko + crash, sparkle run, octave-up second hit.
    jackpot(k, o, r, t) {
      const g = bus(k, o, r, 0.3);
      let e = brass(k, g, [50, 57, 62, 66, 69, 74], t, 1.0, 0.75, 5000);
      taiko(k, o, t, 1.0, 65); punch(k, o, t, 120, 0.28, 0.35);
      kick(k, o, t, 0.7);
      e = M(e, crash(k, g, t, 2.0, 0.3));
      [86, 90, 93, 98, 102, 105, 110].forEach((m, i) => { e = M(e, bell(k, g, mtof(m), t + 0.12 + i * 0.05, 0.9, 0.08, 3.5, 1.2)); });
      e = M(e, brass(k, g, [62, 69, 74, 78, 81], t + 0.55, 1.2, 0.5, 5000));
      taiko(k, o, t + 0.55, 0.7, 80); punch(k, o, t + 0.55, 130, 0.22, 0.3);
      return e;
    },
    // Round start: two chimes and a brass stab.
    round(k, o, r, t) {
      const g = bus(k, o, r, 0.35);
      bell(k, g, mtof(86), t, 0.5, 0.17, 3, 1.2);
      bell(k, g, mtof(93), t + 0.1, 0.6, 0.17, 3, 1.2);
      kick(k, o, t + 0.2, 0.5);
      return brass(k, g, [62, 69, 74, 78], t + 0.2, 0.3, 0.4);
    },
    // Payout: short rattle of balls.
    payout(k, o, r, t) {
      let e = t;
      for (let i = 0; i < 6; i++) e = M(e, blip(k, o, "sine", rnd(3200, 6200), 0, t + i * 0.028 + rnd(0, 0.012), 0.0008, 0.035, rnd(0.07, 0.12)));
      return M(e, hiss(k, o, "bandpass", 3000, 0, 1.2, t, 0.005, 0.16, 0.1));
    },
    // RUSH entry: swoosh, impact chord, fanfare pickups, held chord.
    rushIn(k, o, r, t) {
      hiss(k, o, "bandpass", 600, 7000, 1.5, t, 0.16, 0.02, 0.28);
      const h = t + 0.16, g = bus(k, o, r, 0.26);
      sub(k, o, h, 150, 40, 0.5, 0.8); punch(k, o, h, 140, 0.3, 0.35);
      taiko(k, o, h, 0.9, 70);
      crash(k, g, h, 2.0, 0.28);
      brass(k, g, [57, 64, 69, 73, 76], h, 0.5, 0.6, 5000);
      [69, 73, 76].forEach((m, i) => brass(k, g, [m, m + 12], h + 0.62 + i * 0.1, 0.07, 0.32));
      const h2 = h + 0.92;
      taiko(k, o, h2, 0.8, 80); punch(k, o, h2, 130, 0.22, 0.3);
      let e = brass(k, g, [69, 73, 76, 81, 85], h2, 1.0, 0.55, 5200);
      [93, 97, 100, 105].forEach((m, i) => { e = M(e, bell(k, g, mtof(m), h2 + 0.05 + i * 0.06, 0.7, 0.07, 3.5, 1)); });
      return e;
    },
    // RUSH end: minor chord sagging down with the filter closing.
    rushEnd(k, o, r, t) {
      const g = bus(k, o, r, 0.3);
      const lp = k.filter("lowpass", 3000, 1, g);
      glide(lp.frequency, t, 3000, 250, 1.6);
      const eg = k.gain(0, lp);
      for (const m of [57, 60, 64, 69]) {
        for (const d of [-8, 8]) {
          const s = k.osc("sawtooth", mtof(m), t, t + 1.75, eg);
          s.detune.setValueAtTime(d, t);
          s.detune.linearRampToValueAtTime(d - 100, t + 1.5);
        }
      }
      adsr(eg.gain, t, 0.45 / Math.sqrt(8), 0.02, 0.3, 0.7, t + 1.0, 0.6);
      [93, 88, 84, 81].forEach((m, i) => bell(k, g, mtof(m), t + i * 0.14, 0.6, 0.09, 2, 1));
      return M(bell(k, g, 55, t, 2.0, 0.28, 1.41, 3), t + 1.75);
    },
    // Coin count-up: short two-note metal "ching".
    coin(k, o, r, t) {
      const g = bus(k, o, r, 0.2);
      bell(k, g, 1480, t, 0.12, 0.12, 2, 0.8);
      return bell(k, g, 2217, t + 0.055, 0.3, 0.13, 2, 0.8);
    },
    // UI button click.
    button(k, o, r, t) {
      hiss(k, o, "highpass", 3500, 0, 0.7, t, 0.0005, 0.008, 0.18);
      return blip(k, o, "sine", 1500, 900, t, 0.001, 0.045, 0.2);
    },
  };

  // ---------------------------------------------------------------- rig: buses + voice manager
  // Cheap stereo ping-pong echo used as a shared "room" send.
  function makeEcho(ac, dest) {
    const input = ac.createGain();
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3800;
    const dA = ac.createDelay(0.5), dB = ac.createDelay(0.5);
    dA.delayTime.value = 0.137; dB.delayTime.value = 0.211;
    const fA = ac.createGain(), fB = ac.createGain();
    fA.gain.value = 0.42; fB.gain.value = 0.42;
    const merge = ac.createChannelMerger(2);
    const wet = ac.createGain(); wet.gain.value = 0.5;
    input.connect(lp); lp.connect(dA);
    dA.connect(fA); fA.connect(dB); dB.connect(fB); fB.connect(dA);
    dA.connect(merge, 0, 0); dB.connect(merge, 0, 1);
    merge.connect(wet); wet.connect(dest);
    return input;
  }

  function makeRig(ac, live) {
    const master = ac.createGain();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 5;
    comp.attack.value = 0.003; comp.release.value = 0.25;
    master.connect(comp); comp.connect(ac.destination);
    const sfx = ac.createGain(); sfx.gain.value = 0.9; sfx.connect(master);
    const bgm = ac.createGain(); bgm.gain.value = BGM_LEVEL; bgm.connect(master);
    const rig = { ac, live: !!live, master, comp, sfx, bgm, fx: makeEcho(ac, sfx), voices: [], last: {}, count: {}, lastEnd: 0, made: 0, finished: 0 };
    rig.play = (name, t) => playOn(rig, name, t);
    return rig;
  }

  function finishVoice(rig, v) {
    if (v.done) return;
    v.done = true;
    clearTimeout(v.timer);
    for (const n of v.nodes) {
      if (n.onended !== undefined) n.onended = null;
      try { n.disconnect(); } catch (e) { /* already disconnected */ }
    }
    v.nodes.length = 0;
    const i = rig.voices.indexOf(v);
    if (i >= 0) rig.voices.splice(i, 1);
    rig.finished++;
  }

  // Fade a voice out fast and drop it from the active list (it is disconnected once its sources end).
  function stealVoice(rig, v) {
    const i = rig.voices.indexOf(v);
    if (i >= 0) rig.voices.splice(i, 1);
    if (v.done) return;
    const now = rig.ac.currentTime, p = v.out.gain;
    try {
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.linearRampToValueAtTime(0, now + 0.02);
    } catch (e) { /* ignore */ }
    for (const s of v.srcs) { try { s.stop(now + 0.03); } catch (e) { /* already stopped */ } }
    if (rig.live) { clearTimeout(v.timer); v.timer = setTimeout(() => finishVoice(rig, v), 120); }
  }

  function playOn(rig, name, t) {
    const fn = SFX[name];
    if (!fn) return false;
    const rule = RULES[name] || RULE_DEFAULT;
    const last = rig.last[name];
    if (last != null && t - last < rule[0] && t >= last) return false;
    let same = 0, oldest = null;
    for (const v of rig.voices) if (v.name === name) { same++; if (!oldest) oldest = v; }
    if (same >= rule[1]) stealVoice(rig, oldest);
    while (rig.voices.length >= MAX_VOICES) stealVoice(rig, rig.voices[0]);
    rig.last[name] = t;

    const ac = rig.ac;
    const out = ac.createGain();
    out.connect(rig.sfx);
    const v = { name, out, nodes: [out], srcs: [], ended: 0, done: false, timer: 0, end: t, lastStop: t };
    v.src = (s, t1) => {
      v.srcs.push(s);
      if (t1 > v.lastStop) v.lastStop = t1;
      s.onended = () => { v.ended++; if (v.ended >= v.srcs.length) finishVoice(rig, v); };
    };
    rig.voices.push(v);
    rig.made++;
    let end;
    try { end = fn(new Kit(ac, v), out, rig, t); } catch (e) { finishVoice(rig, v); return false; }
    v.end = rig.lastEnd = M(end, v.lastStop);   // fallback timer uses the real last stop time
    if (!v.srcs.length) { finishVoice(rig, v); return true; }
    if (rig.live) v.timer = setTimeout(() => finishVoice(rig, v), M(0, v.end - ac.currentTime + 0.6) * 1000);
    if (DUCK[name]) duck(rig, t, DUCK[name][0], DUCK[name][1]);
    return true;
  }

  function duck(rig, t, depth, hold) {
    const p = rig.bgm.gain, base = BGM_LEVEL;
    try {
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(base * depth, t + 0.03);
      p.setValueAtTime(base * depth, t + hold);
      p.linearRampToValueAtTime(base, t + hold + 0.6);
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- BGM beds (offline-rendered loops)
  function bBass(k, o, t, m, dur, peak, bright) {
    const end = t + dur + 0.08;
    const g = k.gain(0, o);
    const lp = k.filter("lowpass", 200, 4, g);
    k.osc("sawtooth", mtof(m), t, end, lp);
    k.osc("sine", mtof(m), t, end, k.gain(0.6, g));
    lp.frequency.setValueAtTime(bright * 2, t);
    lp.frequency.exponentialRampToValueAtTime(M(220, bright * 0.4), t + M(0.06, dur));
    adsr(g.gain, t, peak, 0.005, 0.12, 0.7, t + dur, 0.05);
  }
  function bPluck(k, o, t, m, peak) {
    const g = k.gain(0, o);
    const lp = k.filter("lowpass", 6000, 3, g);
    const s = k.osc("sawtooth", mtof(m), t, t + 0.5, lp);
    s.detune.setValueAtTime(30, t);
    s.detune.linearRampToValueAtTime(0, t + 0.03);
    glide(lp.frequency, t, 6000, 600, 0.2);
    perc(g.gain, t, peak, 0.002, 0.45);
  }
  function bPad(k, o, t, ms, dur, peak) {
    const end = t + dur + 0.45;
    const g = k.gain(0, o);
    const lp = k.filter("lowpass", 1400, 0.5, g);
    for (const m of ms) for (const d of [-10, 10]) { const s = k.osc("sawtooth", mtof(m), t, end, lp); s.detune.value = d; }
    adsr(g.gain, t, peak / Math.sqrt(ms.length * 2), 0.25, 0.4, 0.8, t + dur, 0.35);
  }
  // Vibrato LFO on the detune of every given oscillator, fading in from `from` to `to` seconds.
  function vibrato(k, oscs, t, end, rate, cents, from, to) {
    const vib = k.gain(0, oscs[0].detune);
    for (let i = 1; i < oscs.length; i++) vib.connect(oscs[i].detune);
    k.osc("sine", rate, t, end, vib);
    vib.gain.setValueAtTime(0, t);
    vib.gain.setValueAtTime(0, t + from);
    vib.gain.linearRampToValueAtTime(cents, t + Math.max(from + 0.01, to));
  }
  // Erhu-like bowed string: two detuned saws through a nasal body, a slow bow attack, an optional
  // slide up into the note (slide = semitones below) and vibrato that grows after the attack.
  function bErhu(k, o, t, m, dur, peak, slide, atk) {
    const end = t + dur + 0.3, f = mtof(m);
    const g = k.gain(0, o);
    const lp = k.filter("lowpass", 3600, 0.7, g);
    const body = k.filter("peaking", 1500, 1.3, lp);
    body.gain.value = 8;
    const s1 = k.osc("sawtooth", f, t, end, body), s2 = k.osc("sawtooth", f, t, end, body);
    s2.detune.value = 7;
    if (slide) for (const s of [s1, s2]) { s.detune.setValueAtTime(-100 * slide + (s === s2 ? 7 : 0), t); s.detune.linearRampToValueAtTime(s === s2 ? 7 : 0, t + 0.09); }
    vibrato(k, [s1, s2], t, end, 5.6, 24, Math.min(0.14, dur * 0.4), Math.min(dur, 0.55));
    adsr(g.gain, t, peak, atk || 0.07, 0.2, 0.85, t + dur, 0.18);
  }
  // Dizi-like bamboo flute: triangle tone, a buzzing membrane partial, breath at the attack,
  // vibrato, and an optional grace note from a tone above.
  function bDizi(k, o, t, m, dur, peak, grace) {
    const end = t + dur + 0.2, f = mtof(m);
    const g = k.gain(0, o);
    const tone = k.osc("triangle", f, t, end, g);
    const buzz = k.osc("sawtooth", f, t, end, k.filter("bandpass", f * 3, 5, k.gain(0.3, g)));
    if (grace) for (const s of [tone, buzz]) { s.detune.setValueAtTime(200, t); s.detune.setValueAtTime(0, t + 0.06); }
    vibrato(k, [tone, buzz], t, end, 6.2, 16, Math.min(0.18, dur * 0.5), Math.min(dur, 0.5));
    const air = k.gain(0, g);
    k.noise(t, t + 0.25, k.filter("bandpass", f * 2, 2.5, air));
    air.gain.setValueAtTime(peak * 0.6, t);
    air.gain.exponentialRampToValueAtTime(peak * 0.05, t + 0.2);
    adsr(g.gain, t, peak, 0.025, 0.12, 0.8, t + dur, 0.08);
  }
  // Guzheng-like pluck: bright string that darkens as it rings, with a slight pitch settle.
  function bZheng(k, o, t, m, peak) {
    const end = t + 1.25, f = mtof(m);
    const g = k.gain(0, o);
    const lp = k.filter("lowpass", 6500, 2, g);
    const s = k.osc("sawtooth", f, t, end, lp);
    s.detune.setValueAtTime(22, t);
    s.detune.linearRampToValueAtTime(0, t + 0.04);
    k.osc("sine", f, t, end, k.gain(0.7, lp));
    glide(lp.frequency, t, 6500, 700, 0.5);
    perc(g.gain, t, peak, 0.002, 1.1);
  }
  // Guzheng glissando: one pluck per note, `step` seconds apart, swelling.
  function zhengGliss(k, o, t, ms, step, peak) {
    ms.forEach((m, i) => bZheng(k, o, t + i * step, m, peak * (0.55 + 0.45 * i / Math.max(1, ms.length - 1))));
  }
  // Chau gong: inharmonic FM shimmer over a low fundamental, with a noise wash.
  function gong(k, o, t, peak, f) {
    f = f || 96;
    const d = 2.3, end = t + d + 0.1;
    const g = k.gain(0, o);
    const car = k.osc("sine", f, t, end, g);
    const mg = k.gain(0, car.frequency);
    k.osc("sine", f * 1.41, t, end, mg);
    mg.gain.setValueAtTime(f * 3, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.3, t + d);
    k.osc("sine", f * 2.76, t, end, k.gain(0.3, g));
    perc(g.gain, t, peak, 0.01, d);
    hiss(k, o, "bandpass", 2400, 900, 0.8, t, 0.01, d * 0.7, peak * 0.3);
    return end;
  }
  // Woodblock tick.
  function wood(k, o, t, peak) { blip(k, o, "triangle", 1150, 950, t, 0.001, 0.05, peak); }
  function bTrem(k, o, t, m, dur, peak, rate) {
    const end = t + dur + 0.2;
    const env = k.gain(0, o);
    const trem = k.gain(0.5, env);
    k.osc("sine", rate, t, end, k.gain(0.5, trem.gain));
    const lp = k.filter("lowpass", 3000, 0.7, trem);
    for (const d of [-6, 6]) { const s = k.osc("sawtooth", mtof(m), t, end, lp); s.detune.value = d; }
    env.gain.setValueAtTime(EPS, t);
    env.gain.linearRampToValueAtTime(peak, t + dur * 0.8);
    env.gain.setTargetAtTime(0, t + dur, 0.03);
  }
  // Drum kit with shared filters (one filter per bed instead of one per hit).
  function drums(k, o) {
    const hatHP = k.filter("highpass", 7200, 0.7, o);
    const snBP = k.filter("bandpass", 1900, 0.8, o);
    const nz = (dest, t, d, v) => { const g = k.gain(0, dest); k.noise(t, t + d + 0.03, g); perc(g.gain, t, v, 0.001, d); };
    return {
      kick: (t, v) => kick(k, o, t, v),
      snare: (t, v) => { blip(k, o, "triangle", 220, 165, t, 0.001, 0.09, v * 0.6); nz(snBP, t, 0.15, v); },
      hat: (t, v, open) => nz(hatHP, t, open ? 0.2 : 0.04, v),
      taiko: (t, v, f) => taiko(k, o, t, v, f),
      crash: (t, v, d) => crash(k, o, t, d || 1.6, v),
    };
  }

  // Each bed: tempo, bars (16 steps per bar), setup() for shared buses, and bar() that schedules one
  // bar's notes. Bars are written just before they play (see renderBed), so the offline graph stays small.
  // at(bar, step) -> seconds; sd = one 16th in seconds; R = seeded random.
  const BEDS = {
    // Calm D-minor pentatonic: erhu melody over strings, guzheng, taiko and woodblock; a gong opens the loop.
    normal: {
      bpm: 116, bars: 8,
      ch: [[50, 57, 62, 65], [48, 55, 60, 64], [46, 53, 58, 62], [48, 55, 60, 67], [50, 57, 62, 65], [53, 57, 60, 65], [55, 58, 62, 67], [45, 52, 57, 62]],
      roots: [38, 36, 34, 36, 38, 41, 43, 33],
      mel: [[0, 0, 74, 6, 2], [0, 6, 77, 2], [0, 8, 79, 8], [1, 0, 77, 4], [1, 4, 74, 4], [1, 8, 72, 8, 2],
        [2, 0, 69, 6], [2, 6, 72, 2], [2, 8, 74, 8], [3, 0, 72, 12, 2], [3, 12, 67, 4],
        [4, 0, 74, 6, 2], [4, 6, 77, 2], [4, 8, 81, 8], [5, 0, 79, 4], [5, 4, 81, 2], [5, 6, 79, 2], [5, 8, 77, 8],
        [6, 0, 74, 6], [6, 6, 72, 2], [6, 8, 67, 8, 2], [7, 0, 69, 12], [7, 12, 72, 4]],
      gliss: [62, 65, 67, 69, 72, 74],
      setup: (k, o, fx) => ({ o, D: drums(k, k.gain(0.9, o)), mus: bus(k, o, { fx }, 0.24) }),
      bar(k, e, b, at, sd, R) {
        const { o, D, mus } = e, c = this.ch[b], r = this.roots[b];
        if (b === 0) gong(k, o, at(0, 0), 0.12, 92);
        bPad(k, mus, at(b, 0), c, 16 * sd, 0.08);
        D.taiko(at(b, 0), 0.5, 78);
        D.taiko(at(b, 10), 0.26, 96);
        if (b % 2) D.taiko(at(b, 12), 0.2, 112);
        for (const st of [4, 12]) wood(k, o, at(b, st), 0.06);
        wood(k, o, at(b, 14), 0.035);
        for (let st = 0; st < 16; st += 2) D.hat(at(b, st), 0.025 * (0.9 + 0.2 * R()));
        bBass(k, o, at(b, 0), r + 12, 6 * sd, 0.2, 600);
        bBass(k, o, at(b, 8), r + 12, 6 * sd, 0.16, 600);
        const up = [c[0], c[1], c[2], c[3], c[2], c[1], c[3], c[2]].map((m) => m + 12);
        if (b < 4) for (let i = 0; i < 4; i++) bZheng(k, mus, at(b, i * 4), up[i * 2], 0.05);
        else up.forEach((m, i) => bZheng(k, mus, at(b, i * 2), m, i % 2 ? 0.035 : 0.05));
        if (b === 3 || b === 7) zhengGliss(k, mus, at(b, 12), this.gliss, sd / 2, 0.05);
        for (const [bb, st, m, len, sl] of this.mel) if (bb === b) bErhu(k, mus, at(b, st), m, len * sd * 0.95, 0.11, sl);
      },
    },
    // Tension: Japanese in-scale clusters, tremolo strings rising, crying erhu, taiko accelerating into the loop.
    reach: {
      bpm: 138, bars: 4,
      pads: [[52, 59, 64, 65], [53, 60, 65, 69], [52, 59, 64, 65], [53, 59, 65, 71]],
      trem: [76, 77, 76, 83],
      cry: [[0, 0, 76, 8, 1], [0, 8, 77, 8], [1, 0, 81, 12, 2], [1, 12, 77, 4], [2, 0, 76, 8, 1], [2, 8, 83, 8, 2], [3, 0, 84, 16, 1]],
      setup: (k, o, fx) => ({ o, D: drums(k, k.gain(0.9, o)), mus: bus(k, o, { fx }, 0.2) }),
      bar(k, e, b, at, sd) {
        const { o, D, mus } = e;
        if (b === 0) gong(k, o, at(0, 0), 0.14, 88);
        bPad(k, mus, at(b, 0), this.pads[b], 16 * sd, 0.12);
        bTrem(k, mus, at(b, 0), this.trem[b], 16 * sd, 0.03 + 0.015 * b, 1 / sd);
        for (let st = 0; st < 16; st++) bBass(k, o, at(b, st), 52, 0.6 * sd, st % 4 ? 0.16 : 0.22, 500 + 400 * b);
        if (b < 2) for (const st of [0, 6, 8, 14]) D.taiko(at(b, st), st % 8 ? 0.32 : 0.5, 74);
        else if (b === 2) for (let st = 0; st < 16; st += 2) D.taiko(at(b, st), st % 4 ? 0.28 : 0.45, 80);
        else for (let st = 0; st < 16; st++) D.taiko(at(b, st), 0.12 + 0.34 * (st / 15), 86);
        for (let st = 0; st < 16; st += 2) wood(k, o, at(b, st), 0.03);
        for (const [bb, st, m, len, sl] of this.cry) if (bb === b) bErhu(k, mus, at(b, st), m, len * sd * 0.95, 0.1, sl);
      },
    },
    // Battle: driven E-phrygian bass riff, rock drums with taiko, brass stabs, koto plucks and an erhu hook.
    battle: {
      bpm: 164, bars: 4,
      riffA: [40, 0, 40, 40, 41, 0, 40, 0, 43, 0, 41, 40, 38, 0, 40, 0],
      riffB: [40, 0, 40, 40, 41, 0, 40, 0, 45, 43, 41, 40, 43, 41, 40, 38],
      stabs: [
        [[0, [64, 67, 71], 3], [6, [65, 69, 72], 2], [12, [64, 67, 71], 2]],
        [[0, [64, 67, 71], 3], [10, [62, 66, 69], 4]],
        [[0, [64, 67, 71], 3], [6, [65, 69, 72], 2], [12, [64, 67, 71], 2]],
        [[0, [65, 69, 72], 3], [4, [67, 71, 74], 3], [8, [65, 69, 72], 3], [12, [64, 67, 71, 76], 4]],
      ],
      pl: [76, 71, 76, 77, 76, 71, 74, 71],
      hook: [[0, 0, 76, 2], [0, 2, 79, 2], [0, 4, 81, 4], [0, 8, 83, 6, 2], [0, 14, 81, 2], [1, 0, 79, 4], [1, 4, 77, 4], [1, 8, 76, 8, 1],
        [2, 0, 79, 2], [2, 2, 81, 2], [2, 4, 83, 4], [2, 8, 86, 6, 2], [2, 14, 83, 2], [3, 0, 88, 8, 2], [3, 8, 86, 4], [3, 12, 83, 4]],
      setup: (k, o, fx) => ({ o, D: drums(k, k.gain(0.95, o)), mus: bus(k, o, { fx }, 0.15), dist: k.gain(0.7, k.shaper(k.gain(0.45, o))) }),
      bar(k, e, b, at, sd) {
        const { D, mus, dist } = e;
        (b === 3 ? this.riffB : this.riffA).forEach((m, st) => { if (m) bBass(k, dist, at(b, st), m + 12, 0.85 * sd, 0.55, 1800); });
        for (const st of [0, 3, 8, 10]) D.kick(at(b, st), 0.5);
        D.snare(at(b, 4), 0.28); D.snare(at(b, 12), 0.3);
        for (let st = 0; st < 16; st += 2) D.hat(at(b, st), st === 14 ? 0.11 : 0.07, st === 14);
        D.taiko(at(b, 0), 0.5, 60); D.taiko(at(b, 8), 0.35, 70);
        for (const [st, c, len] of this.stabs[b]) brass(k, mus, c, at(b, st), len * sd * 0.9, 0.16, 4200);
        if (b < 3) this.pl.forEach((m, i) => bPluck(k, mus, at(b, i * 2 + 1), m, 0.035));
        for (const [bb, st, m, len, sl] of this.hook) if (bb === b) bErhu(k, mus, at(b, st), m, len * sd * 0.92, 0.1, sl, 0.02);
      },
    },
    // Bonus: festive D-major pentatonic: dizi melody, taiko and small drums, brass fanfare, guzheng sweeps.
    bonus: {
      bpm: 140, bars: 8,
      ch: [[62, 66, 69], [62, 67, 71], [61, 64, 69], [62, 66, 69], [62, 66, 71], [59, 62, 67], [59, 64, 67], [61, 64, 67, 69]],
      roots: [38, 43, 45, 38, 35, 43, 40, 45],
      mel: [[0, 0, 74, 2, 1], [0, 2, 76, 2], [0, 4, 78, 4], [0, 8, 81, 6], [0, 14, 83, 2], [1, 0, 81, 4, 1], [1, 4, 78, 4], [1, 8, 76, 4], [1, 12, 74, 4],
        [2, 0, 76, 2, 1], [2, 2, 78, 2], [2, 4, 81, 4], [2, 8, 83, 4], [2, 12, 86, 4], [3, 0, 88, 8, 1], [3, 8, 86, 8],
        [4, 0, 83, 4, 1], [4, 4, 86, 4], [4, 8, 83, 4], [4, 12, 81, 4], [5, 0, 78, 6, 1], [5, 6, 81, 2], [5, 8, 76, 8],
        [6, 0, 74, 2], [6, 2, 76, 2], [6, 4, 78, 2], [6, 6, 81, 2], [6, 8, 83, 4], [6, 12, 86, 4], [7, 0, 86, 12, 1], [7, 12, 81, 4]],
      gliss: [74, 76, 78, 81, 83, 86],
      setup: (k, o, fx) => ({ o, D: drums(k, k.gain(0.9, o)), mus: bus(k, o, { fx }, 0.2) }),
      bar(k, e, b, at, sd) {
        const { o, D, mus } = e, c = this.ch[b], r = this.roots[b];
        for (const st of [0, 4, 8, 12]) D.kick(at(b, st), 0.42);
        D.snare(at(b, 4), 0.2); D.snare(at(b, 12), 0.22);
        D.taiko(at(b, 0), 0.4, 84); D.taiko(at(b, 8), 0.32, 84);
        D.taiko(at(b, 6), 0.18, 124); D.taiko(at(b, 14), 0.18, 124);
        for (const st of [2, 10]) wood(k, o, at(b, st), 0.05);
        for (let st = 0; st < 16; st++) D.hat(at(b, st), st % 4 === 2 ? 0.07 : 0.025, st % 4 === 2);
        if (b % 4 === 0) D.crash(at(b, 0), 0.13, 1.6);
        for (let st = 0; st < 16; st += 2) bBass(k, o, at(b, st), r + (st % 4 === 2 ? 24 : 12), 1.7 * sd, 0.22, 1100);
        if (b % 2 === 0) brass(k, mus, c, at(b, 0), 4 * sd * 0.9, 0.15, 4200);
        for (let st = 0; st < 16; st += 4) bell(k, mus, mtof(c[(st / 4) % c.length] + 24), at(b, st), 0.35, 0.025, 2, 1);
        if (b === 3 || b === 7) zhengGliss(k, mus, at(b, 12), this.gliss, sd / 2, 0.05);
        for (const [bb, st, m, len, gr] of this.mel) if (bb === b) bDizi(k, mus, at(b, st), m, len * sd * 0.92, 0.1, gr);
      },
    },
    // RUSH: fast A-minor pentatonic drive: 16th plucks, taiko accents, brass hits and a heroic erhu hook.
    rush: {
      bpm: 172, bars: 8,
      ch: [[57, 60, 64], [57, 60, 65], [59, 62, 67], [59, 64, 67], [57, 60, 64], [57, 60, 65], [59, 62, 67], [57, 59, 64]],
      roots: [45, 41, 43, 40, 45, 41, 43, 40],
      mel: [[0, 0, 76, 3, 2], [0, 3, 76, 1], [0, 4, 79, 2], [0, 6, 81, 6], [0, 12, 84, 4], [1, 0, 86, 6, 2], [1, 6, 84, 2], [1, 8, 81, 8],
        [2, 0, 79, 3, 2], [2, 3, 79, 1], [2, 4, 81, 2], [2, 6, 84, 6], [2, 12, 86, 4], [3, 0, 88, 6, 2], [3, 6, 86, 2], [3, 8, 84, 8],
        [4, 0, 76, 3, 2], [4, 3, 76, 1], [4, 4, 79, 2], [4, 6, 81, 6], [4, 12, 88, 4], [5, 0, 91, 6, 2], [5, 6, 88, 2], [5, 8, 86, 8],
        [6, 0, 84, 4], [6, 4, 86, 4], [6, 8, 84, 4], [6, 12, 81, 4], [7, 0, 81, 8, 2], [7, 8, 84, 4], [7, 12, 88, 4]],
      setup: (k, o, fx) => ({ o, D: drums(k, k.gain(0.95, o)), mus: bus(k, o, { fx }, 0.2) }),
      bar(k, e, b, at, sd) {
        const { o, D, mus } = e, c = this.ch[b], r = this.roots[b];
        D.kick(at(b, 0), 0.6); D.kick(at(b, 8), 0.5);
        if (b % 2) D.kick(at(b, 10), 0.4);
        D.snare(at(b, 4), 0.28); D.snare(at(b, 12), 0.3);
        if (b % 2 === 0) { D.taiko(at(b, 0), 0.4, 76); D.taiko(at(b, 8), 0.3, 90); }
        for (let st = 0; st < 16; st++) D.hat(at(b, st), st % 2 ? 0.03 : 0.07);
        if (b % 4 === 0) D.crash(at(b, 0), 0.16, 1.4);
        for (let st = 0; st < 16; st += 2) bBass(k, o, at(b, st), r + (st % 4 === 2 ? 12 : 0), 1.7 * sd, 0.26, 1000);
        const arp = [c[0] + 12, c[2], c[1] + 12, c[2], c[0] + 12, c[1] + 12, c[2] + 12, c[1] + 12];
        for (let st = 0; st < 16; st++) bPluck(k, mus, at(b, st), arp[st % 8], st % 2 ? 0.03 : 0.045);
        brass(k, mus, c, at(b, 0), 3 * sd, 0.15, 4200);
        if (b === 3 || b === 7) brass(k, mus, this.ch[(b + 1) % 8], at(b, 14), 2 * sd, 0.14, 4200);
        for (const [bb, st, m, len, sl] of this.mel) if (bb === b) bErhu(k, mus, at(b, st), m, len * sd * 0.9, 0.11, sl, 0.02);
      },
    },
  };
  const SEEDS = { normal: 11, reach: 22, battle: 33, bonus: 44, rush: 55 };

  function bedLoopFrames(name, sr) {
    const d = BEDS[name];
    // Whole 128-frame render quanta: then every pass of the loop renders identically (the tempo moves by
    // < 0.01%). Chrome processes some things per quantum, so a loop that is not quantum-aligned would not.
    return Math.round((d.bars * 16 * 15 / d.bpm) * sr / 128) * 128;
  }

  function startRendering(oc) {
    return new Promise((resolve, reject) => {
      oc.oncomplete = (e) => resolve(e.renderedBuffer);
      try {
        const p = oc.startRendering();
        if (p && typeof p.then === "function") p.then(resolve, reject);
      } catch (e) { reject(e); }
    });
  }

  // Some engines lack OfflineAudioContext.suspend() or expose it and reject it. Probe once with a tiny
  // render; beds use per-bar scheduling only when a suspend point really fires.
  let suspendProbe = null;
  function offlineSuspendWorks() {
    if (!suspendProbe) {
      suspendProbe = new Promise((resolve) => {
        try {
          const oc = new OAC(1, 2048, 22050);
          if (typeof oc.suspend !== "function") { resolve(false); return; }
          let ok = false;
          oc.suspend(512 / 22050).then(() => { ok = true; oc.resume(); }, () => {});
          startRendering(oc).then(() => resolve(ok), () => resolve(false));
        } catch (e) { resolve(false); }
      });
    }
    return suspendProbe;
  }

  // Render a bed loop: L frames + tail, fold the tail onto the start, normalize. factory makes the buffer.
  // opts.upfront forces scheduling every bar before rendering (the path used where suspend() is missing).
  function renderBed(name, factory, opts) {
    if (!OAC || !BEDS[name]) return Promise.reject(new Error("no OfflineAudioContext / unknown bed"));
    const upfront = !!(opts && opts.upfront);
    return (upfront ? Promise.resolve(false) : offlineSuspendWorks()).then((incremental) => {
      const def = BEDS[name], sr = BED_SR;
      const L = bedLoopFrames(name, sr), T = Math.round(BED_TAIL * sr);
      const oc = new OAC(2, L + T, sr);
      const out = oc.createGain();
      out.connect(oc.destination);
      const fx = makeEcho(oc, out);
      const sd = L / (def.bars * 16) / sr;   // one 16th, derived from the quantum-aligned loop
      // Note times sit half-way between samples, never on a frame boundary, so float rounding cannot move
      // a note by one frame (keeps every pass of the loop identical; <= 16 us shift, inaudible).
      const at = (bar, step) => (Math.round((bar * 16 + step) * sd * sr) + 0.5) / sr;
      const kit = new Kit(oc, null, mulberry32(SEEDS[name]));
      const R = mulberry32(SEEDS[name] + 1);
      const env = def.setup(kit, out, fx);
      const writeBar = (b) => def.bar(kit, env, b, at, sd, R);
      // Nodes that exist but have not started yet still cost render time every quantum, so each bar is
      // created at a suspend point just before it plays (2.5x faster). Otherwise schedule everything now.
      writeBar(0);
      for (let b = 1; b < def.bars; b++) {
        if (!incremental) { writeBar(b); continue; }
        oc.suspend(M(0, at(b, 0) - 0.1)).then(() => {
          try { writeBar(b); } finally { oc.resume(); }
        }, () => { /* probe said suspend works; nothing sane to do here */ });
      }
      return startRendering(oc).then((buf) => {
        const dst = (factory || oc).createBuffer(2, L, sr);
        let sum = 0, peak = 0;
        const chans = [];
        for (let ch = 0; ch < 2; ch++) {
          const s = buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1)), d = dst.getChannelData(ch);
          for (let i = 0; i < L; i++) d[i] = s[i];
          for (let i = 0; i < T && L + i < s.length; i++) d[i] += s[L + i];
          for (let i = 0; i < L; i++) { const x = d[i]; sum += x * x; const a = x < 0 ? -x : x; if (a > peak) peak = a; }
          chans.push(d);
        }
        const rms = Math.sqrt(sum / (2 * L));
        const g = rms > 0 ? Math.min(BED_RMS / rms, 0.95 / peak) : 1;
        for (const d of chans) for (let i = 0; i < L; i++) d[i] *= g;
        return dst;
      });
    });
  }

  // Test reference for the loop fold: two consecutive loops (same seeds each pass), raw and un-normalized.
  // Its second loop start is what a seamless loop must sound like once it has wrapped around.
  function renderBedReference(name) {
    const def = BEDS[name], sr = BED_SR, L = bedLoopFrames(name, sr), T = Math.round(BED_TAIL * sr);
    const oc = new OAC(2, 2 * L + T, sr);
    const out = oc.createGain();
    out.connect(oc.destination);
    const fx = makeEcho(oc, out);
    const sd = L / (def.bars * 16) / sr;
    const kit = new Kit(oc, null, null);
    const env = def.setup(kit, out, fx);
    for (let j = 0; j < 2; j++) {
      kit.rand = mulberry32(SEEDS[name]);
      const R = mulberry32(SEEDS[name] + 1);
      for (let b = 0; b < def.bars; b++) def.bar(kit, env, b, (bar, step) => (j * L + Math.round((bar * 16 + step) * sd * sr) + 0.5) / sr, sd, R);
    }
    return startRendering(oc).then((buffer) => ({ buffer, L, T }));
  }

  // ---------------------------------------------------------------- live state (public API)
  let ctx = null, rig = null;
  let unlocked = false, enabled = true, volume = 0.8;
  let hidden = typeof document !== "undefined" && !!document.hidden;
  let resumePending = false, resumeAt = 0, suspendTimer = 0, listening = false;
  let bedWant = null, bedCur = null, prerendering = false;
  const bedBuf = {}, bedJobs = {}, bedsAlive = [];
  // Optional generated tracks (assets/bgm_<name>.mp3, see useFiles): fetched early, decoded on
  // first use, and preferred over the synthesized bed of the same name.
  let fileBase = null;
  const fileRaw = {}, fileBuf = {}, fileJobs = {};
  // The long beds have a second song (bgm_<name>2.mp3): they alternate, and after SONG_SWITCH
  // seconds of one song the bed crossfades to the other (the user found one song too repetitive).
  const ALT = ["normal", "bonus"];
  const SONG_SWITCH = 150, SONG_FADE = 2;
  const altBuf = {}, lastAlt = {};
  // Files are fetched one at a time, the bed in use first, so its first notes do not wait behind
  // the rest of the music.
  const fileFetch = {};
  let fileQueue = [], fileBusy = false;
  function fetchFile(key) {
    if (fileFetch[key]) return Promise.resolve();
    fileFetch[key] = true;
    return fetch(fileBase + "bgm_" + key + ".mp3").then((r) => (r.ok ? r.arrayBuffer() : null)).then((ab) => {
      if (!ab || !ab.byteLength) return;
      fileRaw[key] = ab;
      if (bedWant === key.replace(/2$/, "")) decodeFile(key);
    }, () => { /* no file: synthesized bed */ });
  }
  function pumpFiles() {
    if (fileBusy || !fileQueue.length) return;
    let i = bedWant ? fileQueue.indexOf(bedWant) : -1;
    if (i < 0) i = 0;
    const key = fileQueue.splice(i, 1)[0];
    fileBusy = true;
    fetchFile(key).then(() => { fileBusy = false; setTimeout(pumpFiles, 300); });
  }

  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  function canPlay() {
    if (!rig || !unlocked || !enabled || hidden) return false;
    const s = ctx.state;
    if (s === "running") return true;
    // A resume we just asked for may still be settling: allow a short grace window.
    return s === "suspended" && resumePending && nowMs() - resumeAt < 400;
  }

  function resume() {
    if (!ctx || ctx.state === "running" || ctx.state === "closed") return;
    clearTimeout(suspendTimer);
    resumePending = true;
    resumeAt = nowMs();
    try {
      const p = ctx.resume();
      if (p && p.then) p.then(() => { resumePending = false; }, () => { resumePending = false; });
    } catch (e) { resumePending = false; }
  }

  function suspendSoon(ms) {
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => {
      if (!ctx || ctx.state !== "running") return;
      if (enabled && !hidden) return;          // state changed back meanwhile
      try { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
    }, ms);
  }

  function applyVolume(timeConst) {
    if (!rig) return;
    const target = enabled ? volume * volume : 0;   // perceptual taper
    const p = rig.master.gain, now = ctx.currentTime;
    try { p.cancelScheduledValues(now); p.setTargetAtTime(target, now, timeConst == null ? 0.02 : timeConst); } catch (e) { p.value = target; }
  }

  // Equal-power fade from the current value (sin in / cos out, so a crossfade keeps constant power).
  function fadeParam(p, to, dur) {
    const now = ctx.currentTime, from = p.value;
    try {
      p.cancelScheduledValues(now);
      p.setValueAtTime(from, now);
    } catch (e) { /* fall through to the plain ramp */ }
    const n = 24, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      c[i] = to >= from ? from + (to - from) * Math.sin((x * Math.PI) / 2) : to + (from - to) * Math.cos((x * Math.PI) / 2);
    }
    try { p.setValueCurveAtTime(c, now + 0.002, dur); } catch (e) {
      try { p.linearRampToValueAtTime(to, now + dur); } catch (e2) { p.value = to; }
    }
  }

  function killBed(b) {
    if (b.dead) return;
    b.dead = true;
    clearTimeout(b.timer); clearTimeout(b.switchT);
    b.src.onended = null;
    try { b.src.disconnect(); } catch (e) { /* ignore */ }
    try { b.g.disconnect(); } catch (e) { /* ignore */ }
    const i = bedsAlive.indexOf(b);
    if (i >= 0) bedsAlive.splice(i, 1);
  }

  function fadeOutBed(b, fade) {
    if (b.dead || b.fading) return;
    fade = fade || FADE;
    b.fading = true;
    clearTimeout(b.switchT);
    try {
      fadeParam(b.g.gain, 0, fade);
      b.src.stop(ctx.currentTime + fade + 0.03);
    } catch (e) { killBed(b); return; }
    b.src.onended = () => killBed(b);
    b.timer = setTimeout(() => killBed(b), (fade + 0.5) * 1000);
  }

  function startBed(name, fade) {
    fade = fade || FADE;
    const two = !!(altBuf[name] && fileBuf[name]);
    const alt = two ? (lastAlt[name] = lastAlt[name] === undefined ? false : !lastAlt[name]) : false;
    const src = ctx.createBufferSource();
    src.buffer = alt ? altBuf[name] : bedBuf[name];
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g);
    g.connect(rig.bgm);
    fadeParam(g.gain, 1, fade);
    src.start(ctx.currentTime + 0.005);
    const b = bedCur = { name, src, g, dead: false, fading: false, timer: 0, switchT: 0, alt };
    bedsAlive.push(b);
    if (two) {
      b.switchT = setTimeout(() => {
        if (bedCur === b && !b.dead && !b.fading) { fadeOutBed(b, SONG_FADE); bedCur = null; startBed(name, SONG_FADE); }
      }, Math.max(SONG_SWITCH, 2 * src.buffer.duration) * 1000);
    }
  }

  function ensureBed(name) {
    if (bedBuf[name]) return Promise.resolve(bedBuf[name]);
    if (!bedJobs[name]) {
      bedJobs[name] = renderBed(name, ctx).then((b) => { if (!fileBuf[name]) bedBuf[name] = b; return bedBuf[name]; },
        (e) => { bedJobs[name] = null; throw e; });
    }
    return bedJobs[name];
  }

  // The part of a generated track worth looping, as [start, end) in frames: the longest stretch
  // of sound. AI tracks can open with 10 s of near-silence or stop half-way and stay silent
  // (the first ACE-Step run did both). "Sound" is a 50 ms window within 30 dB of the loudest
  // one; gaps up to 0.8 s (a breath in a calm track) count as part of the stretch, longer ones
  // (a real stop) end it.
  function activeRange(buf) {
    const W = Math.round(0.05 * buf.sampleRate), n = Math.floor(buf.length / W), GAP = 16;
    const chs = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
    const rms = new Float32Array(n);
    let top = 0;
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (const d of chs) for (let i = k * W, e = i + W; i < e; i++) s += d[i] * d[i];
      rms[k] = Math.sqrt(s / (W * chs.length));
      if (rms[k] > top) top = rms[k];
    }
    let b0 = 0, b1 = 0, s = -1, last = -1;
    for (let k = 0; k < n; k++) {
      if (!(rms[k] > top * 0.03)) continue;
      if (s < 0 || k - last > GAP) s = k;
      last = k;
      if (last + 1 - s > b1 - b0) { b0 = s; b1 = last + 1; }
    }
    return [b0 * W, b1 * W];
  }
  // Where to loop a generated track so the seam falls on the beat: { start, len } in frames.
  // An AI track has its own intro and ending; wrapping the whole track played the ending, then
  // jumped back into the intro off the beat (the user heard it). Instead:
  //  1. the beat period and phase from the onset envelope (10 ms hops);
  //  2. per beat: harmony (12-bin chroma from a 2048-point FFT of a 12 kHz copy), loudness, onsets;
  //  3. a long loop of whole 2-bar steps (4-bar phrases preferred) starting in the first half,
  //     whose two ends match over 4 beats either side (same chord, same loudness, same rhythm), so
  //     the music after the loop sounds like its start.
  function findLoop(buf, a, end) {
    const sr = buf.sampleRate, H = Math.round(sr * 0.01), n = Math.floor((end - a) / H);
    if (n < 1600) return null;   // under 16 s: not worth a search
    const chs = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
    // 1. onset strength (rise of the high-passed log energy) per 10 ms hop
    const on = new Float32Array(n);
    let prev = 0;
    for (let k = 0; k < n; k++) {
      let hi = 0;
      for (const d of chs) for (let i = a + k * H, j = i + H; i < j; i++) { const dv = i ? d[i] - d[i - 1] : 0; hi += dv * dv; }
      const lh = Math.log(1e-9 + hi);
      on[k] = k ? Math.max(0, lh - prev) : 0;
      prev = lh;
    }
    let mean = 0;
    for (let k = 0; k < n; k++) mean += on[k];
    mean /= n;
    const ac = (l) => { let s = 0; for (let k = 0; k + l < n; k++) s += (on[k] - mean) * (on[k + l] - mean); return s / (n - l); };
    let lag = 32, top = -Infinity;
    for (let l = 32; l <= 86; l++) { const v = ac(l); if (v > top) { top = v; lag = l; } }   // 70-190 BPM
    const y0 = ac(lag - 1), y2 = ac(lag + 1), den = y0 - 2 * top + y2;
    const beat = lag + (den < 0 ? 0.5 * (y0 - y2) / den : 0);   // hops
    let phase = 0, pbest = -1;
    for (let ph = 0; ph < beat; ph++) {
      let s = 0;
      for (let t = ph; t < n; t += beat) s += on[Math.round(t)] || 0;
      if (s > pbest) { pbest = s; phase = ph; }
    }
    const nb = Math.floor((n - phase) / beat);   // beats in the range
    if (nb < 40) return null;
    const beatAt = (b) => a + Math.round((phase + b * beat) * H);   // frame where beat b starts
    // 2. per-beat features from a 12 kHz mono copy
    const D = Math.max(1, Math.round(sr / 12000)), r12 = sr / D, N = 2048;
    const mono = new Float32Array(Math.floor((end - a) / D));
    for (let i = 0; i < mono.length; i++) {
      let v = 0;
      for (let k = 0; k < D; k++) for (const d of chs) v += d[a + i * D + k];
      mono[i] = v / (D * chs.length);
    }
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    const pcOf = new Int8Array(N / 2);
    for (let k = 1; k < N / 2; k++) {
      const f = (k * r12) / N;
      pcOf[k] = f < 80 || f > 3000 ? -1 : ((Math.round(12 * Math.log2(f / 440)) % 12) + 12) % 12;
    }
    const re = new Float64Array(N), im = new Float64Array(N);
    const chroma = new Float32Array(nb * 12), loud = new Float32Array(nb), hit = new Float32Array(nb);
    for (let b = 0; b < nb; b++) {
      const f0 = beatAt(b) - a, f1 = beatAt(b + 1) - a;
      const c0 = Math.min(mono.length - N, Math.max(0, Math.round((f0 + f1) / 2 / D) - N / 2));
      for (let i = 0; i < N; i++) { re[i] = mono[c0 + i] * win[i]; im[i] = 0; }
      fft(re, im);
      let tot = 0;
      for (let k = 1; k < N / 2; k++) {
        const pc = pcOf[k];
        if (pc < 0) continue;
        const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        chroma[b * 12 + pc] += m; tot += m;
      }
      for (let p = 0; p < 12; p++) chroma[b * 12 + p] /= tot || 1;
      let e = 0, h = 0;
      for (let i = Math.round(f0 / D); i < Math.round(f1 / D); i++) e += mono[i] * mono[i];
      for (let k = Math.round(f0 / H); k < Math.round(f1 / H) && k < n; k++) h += on[k];
      loud[b] = 10 * Math.log10(1e-12 + e / Math.max(1, (f1 - f0) / D));
      hit[b] = h;
    }
    // 3. compare 4 beats either side of a start beat i and an end beat j
    const W = 4;
    const match = (i, j) => {
      let cs = 0, dl = 0, hx = 0, hy = 0, hxy = 0;
      for (let k = -W; k < W; k++) {
        let xy = 0, xx = 0, yy = 0;
        for (let p = 0; p < 12; p++) { const x = chroma[(i + k) * 12 + p], y = chroma[(j + k) * 12 + p]; xy += x * y; xx += x * x; yy += y * y; }
        cs += xy / Math.sqrt(xx * yy + 1e-12);
        dl += Math.abs(loud[i + k] - loud[j + k]);
        hx += hit[i + k] * hit[i + k]; hy += hit[j + k] * hit[j + k]; hxy += hit[i + k] * hit[j + k];
      }
      return { chord: cs / (2 * W), dB: dl / (2 * W), rhythm: hxy / Math.sqrt(hx * hy + 1e-12) };
    };
    // A seam is good with the same chord, loudness within 3 dB and the same rhythm; take the
    // longest good one, else the best-scoring one (and blend it over a whole bar instead of a beat).
    let best = null, good = null;
    const iMax = Math.floor(nb / 2);
    for (let i = W; i < iMax; i++) {
      for (let len = 8; i + len + W <= nb; len += 8) {
        const m = match(i, i + len);
        const sec = (len * beat) / 100;
        // a good seam first (same chord, loudness within ~3 dB, same rhythm), then a long loop
        const score = 2 * m.chord + 0.5 * m.rhythm - 0.15 * m.dB + 0.012 * Math.min(sec, 50) + (len % 16 ? 0 : 0.05);
        if (sec < 12) continue;
        const c = { score, i, len, m, sec };
        if (!best || score > best.score) best = c;
        if (m.chord >= 0.85 && m.dB <= 3 && m.rhythm >= 0.85 && (!good || len > good.len || (len === good.len && score > good.score))) good = c;
      }
    }
    if (good) best = good;
    if (!best) return null;
    const t1 = beatAt(best.i), t2 = beatAt(best.i + best.len), d0 = chs[0], W2 = Math.round(sr * 0.02);
    // line the end up with the start to the sample (best waveform match within ±10 ms)
    let bc = -Infinity, bo = 0;
    for (let off = -H; off <= H; off++) {
      let c = 0;
      for (let i = 0; i < W2; i++) c += d0[t1 + i] * d0[t2 + off + i];
      if (c > bc) { bc = c; bo = off; }
    }
    return { start: t1, len: t2 + bo - t1, blend: Math.round((good ? 1 : 4) * beat * H), bpm: 6000 / beat, bars: best.len / 4, good: !!good, chord: best.m.chord, dB: best.m.dB, rhythm: best.m.rhythm };
  }
  // In-place radix-2 FFT (re, im of a power-of-two length).
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const ang = (-2 * Math.PI) / size, wr = Math.cos(ang), wi = Math.sin(ang), half = size >> 1;
      for (let s = 0; s < n; s += size) {
        let cr = 1, ci = 0;
        for (let k = 0; k < half; k++) {
          const p = s + k, q = p + half;
          const tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
          re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
          const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }
  // A generated track as a seamless loop (findLoop, else its longest stretch of sound), with the
  // audio that follows the loop folded over its start (findLoop's beat or bar, at most 3 s; else
  // FILE_XFADE seconds), normalized like the synthesized beds.
  const FILE_XFADE = 2;
  function loopFromTrack(buf) {
    const [a, end] = activeRange(buf);
    const sr = buf.sampleRate, lp = findLoop(buf, a, end);
    const X = lp ? Math.min(lp.blend, Math.round(3 * sr)) : Math.round(FILE_XFADE * sr);
    const start = lp ? lp.start : a, L = lp ? lp.len : end - a - X;
    if (L < 4 * sr) return null;   // too short to loop
    // Kept at BED_SR like the synthesized beds: the loops run to minutes, and a 128 kbps mp3 holds
    // nothing above 16 kHz, so linear resampling loses nothing audible and saves a third of memory.
    const k = sr / BED_SR, Lo = Math.floor(L / k);
    const out = ctx.createBuffer(2, Lo, BED_SR);
    let sum = 0, peak = 0;
    const tmp = new Float32Array(L);
    for (let ch = 0; ch < 2; ch++) {
      const src = buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1)), d = out.getChannelData(ch);
      for (let i = 0; i < L; i++) tmp[i] = src[start + i];
      for (let i = 0; i < X; i++) { const x = ((i + 0.5) / X) * (Math.PI / 2); tmp[i] = src[start + i] * Math.sin(x) + src[start + L + i] * Math.cos(x); }
      for (let i = 0; i < Lo; i++) {
        const p = i * k, j = Math.floor(p), f = p - j;
        d[i] = tmp[j] + (j + 1 < L ? (tmp[j + 1] - tmp[j]) * f : 0);
      }
      for (let i = 0; i < Lo; i++) { const v = d[i]; sum += v * v; const m = v < 0 ? -v : v; if (m > peak) peak = m; }
    }
    const rms = Math.sqrt(sum / (2 * Lo)), g = rms > 0 ? Math.min(BED_RMS / rms, 0.95 / peak) : 1;
    for (let ch = 0; ch < 2; ch++) { const d = out.getChannelData(ch); for (let i = 0; i < Lo; i++) d[i] *= g; }
    return out;
  }
  // Decode a fetched track once; when it is ready it replaces the synthesized bed (and the
  // playing bed if it is this one).
  // key is a bed name, or a bed name + "2" for its second song.
  function decodeFile(key) {
    if (fileJobs[key] || !fileRaw[key] || !ctx) return;
    const name = key.replace(/2$/, ""), second = key !== name;
    fileJobs[key] = new Promise((res, rej) => {
      const p = ctx.decodeAudioData(fileRaw[key].slice(0), res, rej);
      if (p && p.then) p.then(res, rej);
    }).then((buf) => {
      const loop = loopFromTrack(buf);
      if (!loop) return;
      delete fileRaw[key];
      if (second) { altBuf[name] = loop; return; }   // used from the next start of the bed
      const wasSynth = !fileBuf[name];
      fileBuf[name] = bedBuf[name] = loop;
      if (wasSynth && bedCur && bedCur.name === name && !bedCur.dead) { fadeOutBed(bedCur); bedCur = null; applyBed(); }
    }, () => { delete fileRaw[key]; });   // unreadable file: keep the synthesized bed
  }

  // Bring the playing bed in line with bedWant.
  function applyBed() {
    if (!rig || !unlocked || !enabled) return;
    if (bedCur && bedCur.name === bedWant && !bedCur.dead) return;
    if (bedCur) { fadeOutBed(bedCur); bedCur = null; }
    const name = bedWant;
    if (!name) return;
    decodeFile(name);
    if (ALT.includes(name)) decodeFile(name + "2");
    pumpFiles();
    if (bedBuf[name]) { startBed(name); return; }
    ensureBed(name).then(() => {
      if (bedWant === name && !bedCur && rig && unlocked && enabled) startBed(name);
    }, () => { /* rendering unavailable: stay silent */ });
  }

  // Render all beds in the background, one at a time, wanted one first.
  function prerender() {
    if (prerendering || !OAC) return;
    prerendering = true;
    const order = [bedWant].concat(["normal", "reach", "battle", "rush", "bonus"]).filter((n, i, a) => n && a.indexOf(n) === i);
    const next = (i) => {
      if (i >= order.length) return;
      const go = () => setTimeout(() => next(i + 1), 150);
      ensureBed(order[i]).then(go, go);
    };
    next(0);
  }

  function onGesture() {
    if (ctx && unlocked && enabled && !hidden && ctx.state !== "running") resume();
  }
  function onVisibility() {
    hidden = !!document.hidden;
    if (!ctx) return;
    if (hidden) suspendSoon(0);
    else if (unlocked && enabled) resume();
  }

  // ---------------------------------------------------------------- voice lines
  // Japanese voice lines (assets/vo_<name>.wav, made on the PC with VOICEVOX): fetched one by one
  // after the music and decoded once the audio is unlocked. One line plays at a time, through the
  // SFX bus with the music ducked under it; a missing file is silent.
  const VOICE_LEVEL = 1.0;
  const voiceRaw = {}, voiceBuf = {};
  let voiceQueue = [], voiceBusy = false, voiceOn = true, voiceSrc = null;
  function pumpVoices() {
    if (voiceBusy || !voiceQueue.length || typeof fetch !== "function") return;
    const name = voiceQueue.shift();
    voiceBusy = true;
    fetch((fileBase == null ? "assets/" : fileBase) + "vo_" + name + ".wav").then((r) => (r.ok ? r.arrayBuffer() : null)).then((ab) => {
      if (ab && ab.byteLength) { voiceRaw[name] = ab; decodeVoice(name); }
    }, () => { /* no file: silent */ }).then(() => { voiceBusy = false; setTimeout(pumpVoices, 60); });
  }
  function decodeVoice(name) {
    if (!ctx || !voiceRaw[name] || voiceBuf[name]) return;
    const ab = voiceRaw[name];
    delete voiceRaw[name];
    new Promise((res, rej) => { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); })
      .then((b) => { voiceBuf[name] = b; }, () => { /* unreadable: silent */ });
  }
  function stopVoiceLine() {
    if (!voiceSrc) return;
    try { voiceSrc.stop(); } catch (e) { /* already stopped */ }
    voiceSrc = null;
  }

  function stopAllVoices() {
    if (!rig) return;
    for (const v of rig.voices.slice()) finishVoice(rig, v);
  }

  const Sound = {
    unlock() {
      try {
        if (!AC) return;
        if (!ctx) {
          try { ctx = new AC({ latencyHint: "interactive" }); } catch (e) { ctx = new AC(); }
          rig = makeRig(ctx, true);
          rig.master.gain.value = enabled ? volume * volume : 0;
        }
        if (!listening && typeof document !== "undefined") {
          listening = true;
          for (const ev of ["pointerdown", "touchend", "mousedown", "keydown"]) document.addEventListener(ev, onGesture, { capture: true, passive: true });
          document.addEventListener("visibilitychange", onVisibility);
        }
        unlocked = true;
        if (enabled && !hidden) resume();
        // iOS needs a buffer started inside the gesture to fully unlock output.
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.onended = () => { try { s.disconnect(); } catch (e) { /* ignore */ } };
        s.start(0);
        for (const n in voiceRaw) decodeVoice(n);
        if (enabled) { applyBed(); prerender(); }
      } catch (e) { /* never throw */ }
    },
    setEnabled(on) {
      try {
        enabled = !!on;
        if (!rig) return;
        applyVolume(0.015);
        if (enabled) {
          clearTimeout(suspendTimer);
          if (unlocked && !hidden) resume();
          applyBed();
          if (unlocked) prerender();
        } else {
          if (bedCur) { fadeOutBed(bedCur); bedCur = null; }
          stopVoiceLine();
          setTimeout(() => { if (!enabled) stopAllVoices(); }, 120);
          suspendSoon(400);
        }
      } catch (e) { /* never throw */ }
    },
    setVolume(v) {
      try {
        v = Number(v);
        if (!isFinite(v)) return;
        volume = Math.min(1, Math.max(0, v));
        applyVolume();
      } catch (e) { /* never throw */ }
    },
    play(name) {
      try {
        if (!canPlay()) return;
        rig.play(String(name), ctx.currentTime + 0.006);
      } catch (e) { /* never throw */ }
    },
    bgm(name) {
      try {
        bedWant = BGM_NAMES.indexOf(name) >= 0 ? name : null;
        applyBed();
      } catch (e) { /* never throw */ }
    },
    // Use generated tracks <base>bgm_<name>.mp3 where they exist; missing files are fine.
    useFiles(base) {
      try {
        if (fileBase != null || typeof fetch !== "function") return;
        fileBase = String(base == null ? "assets/" : base);
        fileQueue = BGM_NAMES.concat(ALT.map((n) => n + "2"));
        pumpFiles();
      } catch (e) { /* never throw */ }
    },
    // Voice lines <base>vo_<name>.wav (base as in useFiles), fetched after a short delay.
    useVoices(names) {
      try {
        voiceQueue = voiceQueue.concat((names || []).map(String));
        setTimeout(pumpVoices, 1500);
      } catch (e) { /* never throw */ }
    },
    // Play a voice line now, cutting off the one before; false when off, not loaded or not allowed.
    voice(name) {
      try {
        const b = voiceBuf[name];
        if (!voiceOn || !b || !canPlay()) return false;
        stopVoiceLine();
        const s = ctx.createBufferSource(), g = ctx.createGain(), t = ctx.currentTime + 0.01;
        s.buffer = b; g.gain.value = VOICE_LEVEL;
        s.connect(g); g.connect(rig.sfx);
        s.onended = () => { try { s.disconnect(); g.disconnect(); } catch (e) { /* ignore */ } if (voiceSrc === s) voiceSrc = null; };
        s.start(t);
        voiceSrc = s;
        duck(rig, t, 0.45, b.duration);
        return true;
      } catch (e) { return false; }
    },
    setVoice(on) {
      try { voiceOn = !!on; if (!voiceOn) stopVoiceLine(); } catch (e) { /* never throw */ }
    },
    names: SFX_NAMES.slice(),
    bgmNames: BGM_NAMES.slice(),
  };

  // Introspection and offline-render hooks for dev/sound_demo.html (not part of the game API).
  Sound._debug = () => ({
    hasCtx: !!ctx, state: ctx ? ctx.state : "none", time: ctx ? ctx.currentTime : 0,
    unlocked, enabled, volume, hidden,
    voices: rig ? rig.voices.length : 0, made: rig ? rig.made : 0, finished: rig ? rig.finished : 0,
    bed: bedCur && !bedCur.dead ? bedCur.name : null, bedsAlive: bedsAlive.length, want: bedWant,
    ready: Object.keys(bedBuf),
    files: Object.keys(fileBuf).concat(Object.keys(altBuf).map((n) => n + "2")),
    voiceLines: Object.keys(voiceBuf),
  });
  Sound._test = {
    SFX_NAMES, BGM_NAMES, MAX_VOICES, BED_SR, RULES, RULE_DEFAULT, activeRange, findLoop, loopFromTrack: (buf) => loopFromTrack(buf),
    beds: BGM_NAMES.map((n) => ({ name: n, bpm: BEDS[n].bpm, bars: BEDS[n].bars, frames: bedLoopFrames(n, BED_SR) })),
    makeRig: (ac) => makeRig(ac, false),
    startRendering,
    renderBed: (name, opts) => renderBed(name, null, opts),
    offlineSuspendWorks,
    renderBedReference,
    // Render one SFX through the real master chain on an OfflineAudioContext.
    renderSfx(name, sr, secs) {
      sr = sr || 32000; secs = secs || 4.5;
      const oc = new OAC(2, Math.round(sr * secs), sr);
      const r = makeRig(oc, false);
      const ok = r.play(name, 0.02);
      const end = r.lastEnd;
      return startRendering(oc).then((buffer) => ({ buffer, end, ok, rig: r }));
    },
  };

  PK.Sound = Sound;
})();
