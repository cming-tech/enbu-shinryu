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
    // The RUSH continuation shown to the player follows the engine numbers below.
    text: {
      "lcd.rushRate": "連莊率 約61%",
      "cab.subDefault": "連莊率\n約61%",
      "gl.rate": "連莊率|在 RUSH 裡再中一次的機會。約 61% 就是 10 次有 6 次會繼續；沒中的話 RUSH 就結束。",
    },
    // Livelier than the engine's 1/99.9 default (the user felt hits were too rare), with a shorter
    // RUSH (the user found its 80% run of hits odd). In a 33-hour simulation of the engine-test
    // driver: a first hit every ~4 min of normal play (was ~9), a reach every ~19 s (was ~47),
    // RUSH 1/9 x ST 8 = about 61% continuation, about 3 hits per RUSH (was ~6).
    engine: { spec: { normalChance: 1 / 49.9, rushChance: 1 / 9, st: 8 }, units: { hesoRate: 1 / 7 } },
  };
})();
