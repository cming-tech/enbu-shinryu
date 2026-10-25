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
    text: {},
    // Livelier than the engine's 1/99.9 default (the user felt hits were too rare): in a 33-hour
    // simulation a first hit comes every ~4 min of normal play instead of ~9, a reach every ~20 s
    // instead of ~50 s. RUSH (1/7.3 x ST 11, about 80% continuation) is unchanged.
    engine: { spec: { normalChance: 1 / 49.9 }, units: { hesoRate: 1 / 7 } },
  };
})();
