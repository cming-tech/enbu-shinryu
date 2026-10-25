// Shared geometry for the machine stage. Every module draws in these design units;
// the shell scales the whole 588 x 860 stage uniformly to fit the phone.
// Angles: SVG convention, degrees, 0 = +x (right), 90 = +y (down), 180 = left, 270 = up.
(function () {
  "use strict";
  const PK = (window.PK = window.PK || {});

  const L = {
    stage: { w: 588, h: 860 },

    // Glass window of the playfield (balls and gold pins are visible inside it).
    win: { cx: 294, cy: 380, rx: 264, ry: 272 },           // x 30..558, y 108..652
    // Plastic frame ring drawn around the window (front layer).
    ring: { rx: 288, ry: 296 },

    // Top ornament area and the two speaker grilles.
    head: { x: 120, y: 0, w: 348, h: 118 },
    speakers: [ { x: 26, y: 58, w: 86, h: 66 }, { x: 476, y: 58, w: 86, h: 66 } ],

    // Liquid-crystal screen (rounded rect). The logo sits in its top band.
    lcd: { x: 104, y: 150, w: 392, h: 320, r: 44 },
    logoBand: { x: 104, y: 150, w: 392, h: 70 },

    // Small right-side sub display (continuation rate etc.), overlaps the LCD's right edge.
    sub: { x: 470, y: 330, w: 80, h: 52 },

    // Playfield targets (ball destinations), centre points.
    heso: { x: 294, y: 548, w: 30, h: 16 },                // start pocket (left-shot target)
    denchu: { x: 528, y: 468, w: 26, h: 18 },              // electric tulip (RUSH start pocket, right shot)
    attacker: { x: 432, y: 612, w: 104, h: 18 },           // big prize door (bonus rounds, right shot)
    outs: [ { x: 294, y: 640 }, { x: 118, y: 612 }, { x: 520, y: 628 } ],  // out holes: centre, left, right

    // Lanes the balls fall through (x ranges at mid height).
    laneL: { x0: 36, x1: 102, y0: 230, y1: 500 },
    laneR: { x0: 500, x1: 552, y0: 250, y1: 600 },
    stageBottom: { y0: 490, y1: 650 },                     // pins + heso area under the LCD

    // Launch rail: an ellipse just inside the window rim. Balls start at railStart and
    // travel with increasing angle (up the left side, over the top).
    rail: { rx: 252, ry: 260, start: 125, releaseLeft: 215, releaseRight: 330 },

    // Bottom decorative gimmick (big kanji blocks), front layer, inside the window bottom.
    gimmick: [ { ch: "炎", x: 150, y: 520, w: 110, h: 110 }, { ch: "舞", x: 338, y: 528, w: 110, h: 110 } ],

    // Control zone (DOM controls placed by the shell over the cabinet's lower body).
    // Console: 總玉數 panel left, PUSH centre, the round PLAY/STOP button ("handle") right.
    handle: { cx: 490, cy: 770, r: 66 },
    push: { x: 226, y: 690, w: 136, h: 130 },
    panel: { x: 12, y: 700, w: 192, h: 140 },
    serial: { x: 20, y: 836 },

    // Overlay buttons on the cabinet.
    rankBtn: { x: 14, y: 14, w: 82, h: 86 },
    zoomBtn: { x: 16, y: 600, w: 74, h: 74 },
    infoBtn: { x: 528, y: 646, w: 46, h: 46 },
  };

  // Point on the rail ellipse at angle deg.
  L.railPoint = function (deg) {
    const a = (deg * Math.PI) / 180;
    return { x: L.win.cx + L.rail.rx * Math.cos(a), y: L.win.cy + L.rail.ry * Math.sin(a) };
  };
  // Half-width of the window at height y (0 outside).
  L.winHalfWidth = function (y) {
    const t = (y - L.win.cy) / L.win.ry;
    return Math.abs(t) >= 1 ? 0 : L.win.rx * Math.sqrt(1 - t * t);
  };

  PK.L = L;
})();
