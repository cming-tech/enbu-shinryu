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
  // The version the player sees (menu, and a toast after an update): the Artifact version this is
  // published as. Bump it on every publish; both machines' pages and the public site read it here.
  PK.VERSION = 56;

  PK.MACHINES.enbu = {
    id: "enbu",
    name: "炎舞神龍",
    crest: "龍",
    serial: "0888",          // 台號 shown on the data counter
    assetsBase: "assets/",   // optional image slots (see dev/CONTRACT.md "Image slots")
    refill: 10000,           // free refill amount, in balls
    card: "jackpot_art.jpg", // the lobby card picture (in assetsBase)
    tagline: "劍士與神龍的冒險：聽牌、炎舞對決、炎舞RUSH",
    // The RUSH continuation shown to the player: the shell fills {p} (percent) and {n} (out of 10)
    // from the odds in use, which the player can change in 設定 → 機率調整.
    text: {
      "lcd.rushRate": "継続率 約{p}%",
      "cab.subDefault": "継続率\n約{p}%",
      "gl.rate": "継続率（連莊率）|在 RUSH 裡再中一次的機會。約 {p}% 就是 10 次有 {n} 次會繼續；沒中的話 RUSH 就結束。可以在「設定 → 機率調整」改。",
    },
    // The user tried 1/49.9 with a 61% RUSH and found "a jackpot all the time" less fun, so hits are
    // back to 1/99.9 and the RUSH continues about 40% of the time (1/16 x ST 8). In a 67-hour
    // simulation of the engine-test driver: a first hit every ~6.7 min of normal play, a reach every
    // ~35 s, ~10.5 jackpots an hour, about 0.7 more hits per RUSH, and a payout ratio of ~120%,
    // so balls still rarely run out. hesoRate 1/7 keeps the spins coming. These are the defaults;
    // each player can pick other presets in 設定 → 機率調整 (src/shell.js, ODDS).
    // The cabinet: its pin layout (a layout function in src/cabinet.js) and the AI art on the frame,
    // as boxes in stage units. dragon: the statue on the top-right corner (fitted against the box's
    // right and top edges, only the part outside the window shows); crest: the top medallion;
    // board: the painting behind the pins.
    cabinet: {
      pins: "enbu",
      art: {
        dragon: { file: "cab_dragon.png", x: 380, y: -8, w: 216, h: 380 },
        crest: { file: "cab_crest.png", x: 222, y: -10, w: 144, h: 120 },
        board: { file: "board.jpg" },
      },
    },
    // ラウンド昇格 (2026-11-01): a heso hit is 10R one time in ten (one in five made the payout ~135%, from ~113%); the shell shows it as 3R that
    // grows at round 2, so the first jackpot is no longer always the small one.
    // 設定 → 機率調整: the presets offered for this machine, 1/n per spin.
    odds: {
      hit: [49.9, 69.9, 99.9, 149.9, 199.9],                        // per normal spin
      hitMinutes: { 49.9: 4, 69.9: 5, 99.9: 7, 149.9: 11, 199.9: 13 }, // mean minutes to a jackpot (simulated)
      rush: [20, 16, 12, 9, 5.5],                                    // per RUSH spin (ST 8)
    },
    engine: { spec: { normalChance: 1 / 99.9, rushChance: 1 / 16, st: 8, hesoKinds: { "3R": 0.9, "10R": 0.1 } }, units: { hesoRate: 1 / 7 } },
  };

  // Machine 2, 霓虹天使 (NEON ANGEL), a reel machine like 炎舞神龍 (the players asked for reels):
  // the same engine, shell and rules, its own look. Its files are assets/angel_* (assetsBase is a
  // prefix: images angel_bg_normal.jpg, music angel_bgm_normal.mp3, voices angel_vo_reach.wav,
  // clips angel_vid_sp.mp4). `theme: "neon"` switches lcd.js and cabinet.js to their neon palette
  // and ornaments. The texts below replace machine 1's (PK.TEXT keys).
  const E = PK.MACHINES.enbu;
  PK.MACHINES.angel = {
    id: "angel",
    name: "霓虹天使",
    crest: "天",
    serial: "2077",
    assetsBase: "assets/angel_",
    theme: "neon",
    softMusic: true,   // the user picked 「柔和」 for these songs (src/sound.js useFiles)
    refill: 10000,
    card: "jackpot_art.jpg",
    tagline: "機器人少女駭進霓虹城市：ダイブリーチ、ファイアウォール突破、OVERDRIVE RUSH",
    odds: E.odds,
    engine: E.engine,
    cabinet: {
      pins: "angel",   // its own board (src/cabinet.js pinsAngel)
      frame: "wings",   // its own cabinet: pearl body, feather wings, a halo (src/cabinet.js buildWingFrame)
      art: {
        board: { file: "board.jpg" },
      },
    },
    text: Object.assign({}, E.text, {
      // the LCD (Japanese, like a real machine)
      "lcd.logoL": "NEON", "lcd.logoR": "ANGEL", "lcd.crest": "天", "lcd.push": "HACK", "lcd.pushCall": "HACK!!",
      "lcd.kokuchi": "HACK!!", "lcd.zone": "ハックゾーン", "lcd.premium": "天使降臨!!",
      "lcd.serif.white": "……何か、来る？", "lcd.serif.blue": "アクセス、開始。", "lcd.serif.green": "このデータ……熱い！",
      "lcd.serif.red": "いける、突破できる！", "lcd.serif.gold": "全部、あなたにあげる！",
      "lcd.rushName0": "OVERDRIVE", "lcd.rushName1": "HYPER", "lcd.rushName2": "ANGEL",
      "lcd.spReach": "ダイブリーチ", "lcd.spspReach": "OVERRIDEリーチ",
      "lcd.hero": "天使", "lcd.rival": "ガーディアンAI", "lcd.battle": "ファイアウォール突破",
      "lcd.lose": "ブロック…", "lcd.win": "突破!!", "lcd.battleHint": "突破口!!",
      "lcd.roundLines": "ダウンロード中！|データ確保！|まだまだ！|セキュリティ解除！|ハック継続！|止まらない！|全開でいくよ！|もっと集めて！|一気に行こう！|あと少し！",
      "lcd.minions": "スパイダー|ドローン|ハウンド|タレット|ソルジャー|サーペント",
      "lcd.bossHint": "HACK連打で{name}を倒せ！",
      "lcd.awakenTitle": "天使覚醒チャレンジ", "lcd.awakenHint": "HACK連打で天使を目覚めさせろ！",
      "lcd.awakenOk": "天使覚醒!!", "lcd.awakenNg": "覚醒ならず…", "lcd.rushOver": "OVERDRIVE RUSH 終了",
      // the shell (Traditional Chinese)
      "ui.push": "HACK", "ui.auto": "自動HACK", "ui.autoOn": "自動HACK 開",
      "ui.autoOnHint": "自動 ON：出現 HACK 時會自動幫你按", "ui.autoOffHint": "自動 OFF：出現 HACK 時要自己按中間的大按鈕",
      "set.autoPush": "自動 HACK", "set.autoPushHint": "出現 HACK 時自動幫你按",
      "lv.titles": "見習駭客|霓虹駭客|天使之友|夜城傳說|霓虹天使之主",
      "ms.boss": "打倒 {n} 台保全機器人", "ms.sp": "看到 {n} 次大演出（ダイブリーチ、ファイアウォール突破、激アツ）", "ms.push": "按 HACK 揭曉 {n} 次",
      "ms.note": "每天換 3 個新任務，完成就送珠子和經驗。中大當、打倒保全機器人也有經驗。等級和稱號按「重新開始」也不會清除。",
      "rec.boss": "打倒保全機器人",
      "ach.rush": "突入 RUSH|第一次進入 OVERDRIVE RUSH", "ach.boss": "打倒保全機器人|大當中連打 HACK 打倒保全機器人",
      "ach.boss10": "機器人剋星|打倒 10 台保全機器人", "ach.awaken": "天使覺醒|在決定戰讓天使覺醒", "ach.premium": "天使降臨|看到很少見的天使降臨",
      "ex.sp": "ダイブリーチ|衝進網路世界的聽牌", "ex.battleWin": "ファイアウォール突破・成功|她打倒保全 AI",
      "ex.battleLose": "ファイアウォール突破・失敗|她被保全 AI 擋下", "ex.gun": "群|一大群光飛過畫面", "ex.zone": "ハックゾーン|邊框越來越亮，最後勝負!!",
      "ex.premium": "天使降臨|很少見，出現就確定大當", "ex.pushLong": "長押し HACK|按住 HACK 把量表集滿",
      "cap.premium": "天使降臨：光之鳳凰飛過整個畫面＝確定大當！很少見", "cap.pushLong": "長押し：按住 HACK 不放，把下面的量表集滿",
      "cap.zone": "ハックゾーン（先讀預告）：後面排隊的保留裡可能藏著大當，最後一轉出現「勝負!!」",
      "cap.battle": "ファイアウォール突破（對決）：連打 HACK 幫她，打贏就是大當", "cap.push": "HACK：按中間大按鈕揭曉",
      "cap.gun": "群預告：大約一半機會", "cap.rush": "OVERDRIVE RUSH：很容易連續中獎",
      "cap.minion": "大當中：連打 HACK 打倒保全機器人，打倒多拿 100 顆",
      "cap.awaken": "最後決戰：連打 HACK 讓天使覺醒，成功就進 RUSH！", "cap.awakenNg": "這次天使沒醒，接下來是時短 20 轉",
      "tut.p5": "珠子會 **大量增加**。\n看到 **HACK** 就按中間的大按鈕。",
      "gl.credits": "配音：VOICEVOX:冥鳴ひまり",
      "gl.flow": "打珠|珠子進入賞口|數字轉|リーチ（聽牌）|大当り（大當）|右打ち拿珠|OVERDRIVE RUSH 或 時短",
      "gl.push": "HACK（中間）|粉紅大按鈕。畫面出現 HACK 時按它揭曉結果；對決時要一直連打。",
      "gl.auto": "自動HACK（左下）|打開後會顯示「自動HACK 開」，出現 HACK 時會自動幫你按。",
      "gl.boss": "保全機器人|大當前幾回合出現的保全 AI 手下，每次大當換一台。連打 HACK 把它的血條打光，就多拿 100 顆。",
      "gl.awaken": "天使覚醒チャレンジ（天使覺醒挑戰）|大當最後一回合的決定戰。連打 HACK 讓天使覺醒：成功就進 OVERDRIVE RUSH，沒醒就是時短 20 轉。結果在中大當時就決定了。",
      "gl.rush": "OVERDRIVE RUSH|大當之後的特別模式。中獎機率很高，很容易一直連續中。連中會升級：OVERDRIVE → HYPER（連 2）→ ANGEL（連 3），畫面和顏色跟著變。",
      "gl.gun": "群預告|一大群光飛過畫面，大約一半機會。",
      "gl.battle": "ファイアウォール突破（對決）|リーチ後她和保全 AI 對戰。連打 HACK 幫她，打贏就是大當。",
      "gl.kokuchi": "HACK!!（確定告知）|金色鳳凰帶著光衝出來，一出現就確定中了大當。",
    }),
  };

  // Machine 2, a 羽根物 with real ball physics (src/hane/hane.js) instead of 炎舞神龍's engine and
  // LCD, so it has its own page (`page`) and shell (src/hane/hane_shell.js); the lobby switches
  // pages. Design in dev/MACHINE2.md.
  PK.MACHINES.neon = {
    id: "neon",
    name: "霓虹天使",
    page: "hane.html",
    assetsBase: "assets/",
    refill: 10000,
    card: "hane/topper.jpg",
    tagline: "機器人少女的羽根物：手臂接珠、碰上 V 窗就大當",
    // Out of the lobby (2026-11-02): the players asked for a machine with reels like 炎舞神龍, so
    // 霓虹天使 becomes a reel machine; this 羽根物 is kept (hane.html still works) for later.
    hidden: true,
  };
})();
