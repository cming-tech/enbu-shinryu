// Machine configs: everything machine-specific, keyed by id. 炎舞神龍 is machine #1.
// A new machine = new images + a new entry here. The shell picks one (a lobby comes later).
//  - text:   PK.TEXT overrides for this machine (merged by the shell at startup)
//  - engine: spec overrides in the shape of PK.engineTables (empty = the engine's defaults)
// Not configurable yet: cabinet and LCD palettes, which are still drawn by src/cabinet.js and
// src/lcd.js for this machine only.
(function () {
  "use strict";
  const PK = (window.PK = window.PK || {});
  PK.MACHINES = PK.MACHINES || {};

  PK.MACHINES.enbu = {
    id: "enbu",
    name: "炎舞神龍",
    crest: "龍",
    serial: "0888",          // 台號 shown on the data counter
    assetsBase: "assets/",   // optional image slots (see dev/CONTRACT.md "Image slots")
    refill: 10000,           // free refill amount, in balls
    // The RUSH continuation shown to the player: the shell fills {p} (percent) and {n} (out of 10)
    // from the odds in use, which the player can change in 設定 → 機率調整.
    text: {
      "lcd.rushRate": "連莊率 約{p}%",
      "cab.subDefault": "連莊率\n約{p}%",
      "gl.rate": "連莊率|在 RUSH 裡再中一次的機會。約 {p}% 就是 10 次有 {n} 次會繼續；沒中的話 RUSH 就結束。可以在「設定 → 機率調整」改。",
    },
    // The user tried 1/49.9 with a 61% RUSH and found "a jackpot all the time" less fun, so hits are
    // back to 1/99.9 and the RUSH continues about 40% of the time (1/16 x ST 8). In a 67-hour
    // simulation of the engine-test driver: a first hit every ~6.7 min of normal play, a reach every
    // ~35 s, ~10.5 jackpots an hour, about 0.7 more hits per RUSH, and a payout ratio of ~120%,
    // so balls still rarely run out. hesoRate 1/7 keeps the spins coming. These are the defaults;
    // each player can pick other presets in 設定 → 機率調整 (src/shell.js, ODDS).
    engine: { spec: { normalChance: 1 / 99.9, rushChance: 1 / 16, st: 8 }, units: { hesoRate: 1 / 7 } },
  };
})();
