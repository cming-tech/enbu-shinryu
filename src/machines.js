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
  PK.VERSION = 69;

  PK.MACHINES.enbu = {
    id: "enbu",
    name: "炎舞神龍",
    crest: "龍",
    serial: "0888",          // 台號 shown on the data counter
    assetsBase: "assets/",   // optional image slots (see dev/CONTRACT.md "Image slots")
    refill: 10000,           // free refill amount, in balls
    card: "jackpot_art.jpg", // the lobby card picture (in assetsBase)
    preview: "preview.jpg",   // the cabinet itself on the card (dev/make_previews.js)
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
    preview: "preview.jpg",
    tutPrefix: "angel_",   // img/tutorial/angel_tut1..4.jpg (dev/make_tutorial_art.js --machine=angel)
    tagline: "機器人少女駭進霓虹城市：ダイブリーチ、ファイアウォール突破、OVERDRIVE RUSH",
    odds: E.odds,
    engine: E.engine,
    cabinet: {
      pins: "angel",   // its own board (src/cabinet.js pinsAngel)
      frame: "wings",   // its own cabinet: pearl body, feather wings, a halo (src/cabinet.js buildWingFrame)
      art: {
        board: { file: "board.jpg" },
        // AI wing (assets/_raw/angel_frame_wing.png, cut out): root (ox,oy) at the gem, turned rot, scaled s
        wing: { file: "frame_wing.png", ox: 70, oy: 650, dx: 24, ry: 112, rot: 38, s: 0.56, low: { dx: 290, ry: 690, rot: -58, s: 0.3 } },
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
      "ex.battleLose": "ファイアウォール突破・失敗|她被保全 AI 擋下", "ex.gun": "機群|一大群保全機器人帶著霓虹光飛過畫面", "ex.zone": "ハックゾーン|邊框越來越亮，最後勝負!!",
      "ex.premium": "天使降臨|很少見，出現就確定大當", "ex.pushLong": "長押し HACK|按住 HACK 把量表集滿",
      "cap.premium": "天使降臨：光之鳳凰飛過整個畫面＝確定大當！很少見", "cap.pushLong": "長押し：按住 HACK 不放，把下面的量表集滿",
      "cap.zone": "ハックゾーン（先讀預告）：後面排隊的保留裡可能藏著大當，最後一轉出現「勝負!!」",
      "cap.battle": "ファイアウォール突破（對決）：連打 HACK 幫她，打贏就是大當", "cap.push": "HACK：按中間大按鈕揭曉",
      "cap.gun": "機群預告：大約一半機會", "lcd.gun": "機群", "cap.rush": "OVERDRIVE RUSH：很容易連續中獎",
      "cap.minion": "大當中：連打 HACK 打倒保全機器人，打倒多拿 100 顆",
      "cap.awaken": "最後決戰：連打 HACK 讓天使覺醒，成功就進 RUSH！", "cap.awakenNg": "這次天使沒醒，接下來是時短 20 轉",
      "tut.p5": "珠子會 **大量增加**。\n看到 **HACK** 就按中間的大按鈕。",
      "gl.credits": "配音：VOICEVOX:冥鳴ひまり",
      "gl.flow": "打珠|珠子進入賞口|數字轉|リーチ（聽牌）|大当り（大當）|右打ち拿珠|OVERDRIVE RUSH 或 時短",
      "gl.push": "HACK（中間）|粉紅大按鈕。畫面出現 HACK 時按它揭曉結果；對決時要一直連打。",
      "gl.auto": "自動HACK（左下）|打開後會顯示「自動HACK 開」，出現 HACK 時會自動幫你按。",
      "gl.boss": "保全機器人|大當前幾回合出現的保全 AI 手下，每次大當換一台。連打 HACK 把它的血條打光，就多拿 100 顆。",
      "gl.zone": "ハックゾーン（先讀預告）|畫面邊緣連續好幾轉亮起霓虹，越來越亮。表示後面排隊的保留裡可能有大當（大約四成），輪到那一轉時出現「勝負!!」。",
      "gl.premium": "天使降臨|很少見的演出：光之鳳凰飛過整個畫面，出現就確定大當。",
      "gl.awaken": "天使覚醒チャレンジ（天使覺醒挑戰）|大當最後一回合的決定戰。連打 HACK 讓天使覺醒：成功就進 OVERDRIVE RUSH，沒醒就是時短 20 轉。結果在中大當時就決定了。",
      "gl.rush": "OVERDRIVE RUSH|大當之後的特別模式。中獎機率很高，很容易一直連續中。連中會升級：OVERDRIVE → HYPER（連 2）→ ANGEL（連 3），畫面和顏色跟著變。",
      "gl.gun": "機群預告|一大群保全機器人帶著霓虹光飛過畫面，混著金色鳳凰；大約一半機會。",
      "gl.battle": "ファイアウォール突破（對決）|リーチ後她和保全 AI 對戰。連打 HACK 幫她，打贏就是大當。",
      "gl.kokuchi": "HACK!!（確定告知）|金色鳳凰帶著光衝出來，一出現就確定中了大當。",
    }),
  };

  // Machine 3, 轉生史萊姆與魔劍 (design: dev/MACHINE3.md): an original slime reborn in another world that
  // swallowed the sealed 暴食の魔剣. A giant sword pierces the cabinet (frame: "sword"); the left half of
  // the board feeds the 暴食の渦 whirlpool, the right half is machine 1's RUSH/bonus side (pins: "sword").
  // Steel and emerald (theme: "steel"). Its files are assets/sword_* (AI art made 2026-11-05/06); the drawn
  // fallbacks show for anything missing. Out of 試作中 since v64 (its own music, voices and clips).
  PK.MACHINES.sword = {
    id: "sword",
    name: "轉生史萊姆與魔劍",
    crest: "劍",
    serial: "0666",
    assetsBase: "assets/sword_",
    theme: "steel",
    refill: 10000,
    card: "jackpot_art.jpg",
    preview: "preview.jpg",
    tutPrefix: "sword_",
    tagline: "吞下魔劍的史萊姆：暴食漩渦、覺醒、四大幹部、連戰 RUSH",
    odds: E.odds,
    // 保留 up to 10 (the user: the 暴食 slime swallows more); the per-spin odds are machine 1's
    engine: { spec: E.engine.spec, units: Object.assign({}, E.engine.units, { maxHolds: 10 }) },
    // 吞珠覺醒: every ball the 暴食の渦 swallows fills the blade; `need` of them -> 覚醒, the next `spins`
    // normal/時短 spins at `mul` times the hit chance. 四大幹部: each first hit (normal or 時短) recruits
    // the next commander (a gem lights on the crossguard); all four -> 魔王降臨, the next RUSH one step up
    // the odds presets. Both are kept per machine (shell.js, pk.sword.m3).
    devour: { need: 200, mul: 2, spins: 50 },
    commanders: ["劍鬼", "狼王", "龍姬", "影"],
    cabinet: { pins: "sword", frame: "sword", art: { board: { file: "board.jpg" } } },
    text: Object.assign({}, E.text, {
      // the LCD (Japanese, like a real machine): the slime that swallowed the 暴食の魔剣
      "lcd.logoL": "転生スライムと", "lcd.logoR": "魔剣", "lcd.crest": "剣",
      "lcd.gun": "魔群", "lcd.kokuchi": "魔剣解放!!", "lcd.zone": "暴食ゾーン", "lcd.premium": "魔剣降臨!!",
      "lcd.serif.white": "……何か、いる？", "lcd.serif.blue": "腹が、減ったな。", "lcd.serif.green": "喰らい尽くしてやる！",
      "lcd.serif.red": "この剣で、斬る！", "lcd.serif.gold": "全部、喰らってやる！",
      "lcd.rushName0": "連戦", "lcd.rushName1": "猛攻", "lcd.rushName2": "魔王",
      "lcd.spReach": "暴食リーチ", "lcd.spspReach": "魔剣リーチ",
      "lcd.hero": "スライム", "lcd.rival": "魔将", "lcd.battle": "魔将決戦", "lcd.lose": "喰われた…", "lcd.battleHint": "喰らえ!!",
      "lcd.roundLines": "喰らえ！|まだ足りない！|剣が唸る！|もっと喰わせろ！|勝利は目前！|暴食、止まらず！|まだまだ！|魔剣の力！|一気に喰らえ！|追撃せよ！",
      "lcd.minions": "ゴブリン兵|骸骨剣士|大蜘蛛|オーク戦士|闇狼|石像兵",
      "lcd.awakenTitle": "暴食覚醒チャレンジ", "lcd.awakenHint": "PUSH連打で魂を喰らえ！",
      "cap.awaken": "最後決戰：連打 PUSH 讓史萊姆吞下更多靈魂，吃飽就覺醒進 RUSH！", "cap.awakenNg": "這次沒吃飽、沒覺醒，接下來是時短 20 轉",
      "ach.awaken": "暴食覺醒|在決定戰讓史萊姆覺醒",
      "gl.awaken": "暴食覚醒チャレンジ（暴食覺醒挑戰）|大當最後一回合的決定戰。四周的綠色靈魂會飛進史萊姆嘴裡，連打 PUSH 丟更多進去；史萊姆越吃越大、身體從下往上亮起來。吃飽覺醒就進連戦RUSH，沒醒就是時短 20 轉。結果在中大當時就決定了。", "lcd.awakenOk": "覚醒!!",
      "lcd.rushOver": "連戦RUSH 終了",
      "lcd.streakLbl": "連戦", "lcd.streakN": "第{n}戦",
      "lcd.awake": "覚醒!!", "lcd.awakeSub": "人の姿へ…", "lcd.recruit": "{name}が仲間になった!", "lcd.maou": "魔王降臨!!",
      "cab.subAwake": "覚醒中\n残り{n}",
      "ex.sp": "暴食リーチ|魔劍飛過整個畫面的聽牌", "ex.battleWin": "魔将決戦・勝利|史萊姆打倒魔將", "ex.battleLose": "魔将決戦・敗北|史萊姆被魔將打敗",
      "ex.gun": "魔群|一大群魔物飛過畫面", "ex.zone": "暴食ゾーン|邊框越來越亮，最後勝負!!", "ex.premium": "魔剣降臨|很少見，出現就確定大當",
      "ms.note": "每天換 3 個新任務，完成就送珠子和經驗。中大當、打倒魔物也有經驗。等級和稱號按「重新開始」也不會清除。",
      "ms.boss": "打倒 {n} 隻魔物", "ms.sp": "看到 {n} 次大演出（暴食リーチ、魔将決戦、激アツ）",
      "lv.titles": "初生史萊姆|暴食史萊姆|魔劍使|魔將殺手|魔王",
      "rec.boss": "擊倒魔物", "ach.rush": "突入 RUSH|第一次進入連戦RUSH", "ach.boss": "擊倒魔物|大當中連打 PUSH 擊倒魔物",
      "ach.boss10": "魔物剋星|擊倒 10 隻魔物", "ach.premium": "魔劍降臨|看到很少見的魔劍降臨",
      "cap.premium": "魔剣降臨：魔劍飛過整個畫面＝確定大當！很少見", "cap.zone": "暴食ゾーン（先讀預告）：後面排隊的保留裡可能藏著大當，最後一轉出現「勝負!!」",
      "cap.battle": "魔将決戦（對決）：連打 PUSH 幫史萊姆，打贏就是大當", "cap.gun": "魔群預告：大約一半機會",
      "cap.rush": "連戦RUSH：很容易連續中獎", "cap.minion": "大當中：連打 PUSH 打倒魔物，打倒多拿 100 顆",
      "gl.flow": "打珠|珠子進入賞口|數字轉|リーチ（聽牌）|大当り（大當）|右打ち拿珠|連戦RUSH 或 時短",
      "gl.boss": "魔物|大當前幾回合出現的魔將手下，每次大當換一隻。連打 PUSH 把牠的血條打光，就多拿 100 顆。開了「自動 PUSH」會自動幫你打。",
      "gl.gun": "魔群預告|一大群魔物飛過畫面，大約一半機會。",
      "gl.battle": "魔将決戦（對決）|リーチ後史萊姆和魔將對戰。連打 PUSH 幫史萊姆，打贏就是大當。",
      "gl.kokuchi": "魔剣解放!!（確定告知）|魔劍帶著光衝出來，一出現就確定中了大當。",
      "gl.zone": "暴食ゾーン（先讀預告）|畫面邊緣連續好幾轉亮起綠光，越來越亮。表示後面排隊的保留裡可能有大當（大約四成），輪到那一轉時出現「勝負!!」。",
      "gl.premium": "魔剣降臨|很少見的演出：魔劍飛過整個畫面，出現就確定大當。",
      "lcd.cmdLabel": "四大幹部 {n}/4", "lcd.recruitSub": "が仲間になった!", "lcd.chomp": "喰ッ!",
      "gl.credits": "配音：VOICEVOX:麒ヶ島宗麟、VOICEVOX:剣崎雌雄",
      // the shell (Chinese)
      "cap.lost": "保留滿 10 個時，再進去的珠子不算",
      "cap.awake": "覺醒！接下來 {n} 轉，中大當的機會加倍",
      "cap.recruit": "{name} 成為夥伴（四大幹部 {k}/4）",
      "cap.maou": "四大幹部到齊：魔王降臨！下一次 RUSH 連莊率提高",
      "gl.hold": "保留|數字還在轉時進的珠子，會排隊等著轉。這台的史萊姆特別能吃：最多 10 個（別台是 4 個）。",
      "glg.own": "這台的特別玩法",
      "gl.vortex": "暴食漩渦（入賞口）|左下會轉的綠色漩渦。平常往左打，珠子被吸進中心就是進入賞口，數字開始轉；被甩出來的就沒進。",
      "gl.awake": "吞珠覺醒|漩渦每吃一顆珠子，中間的劍身就亮一格。吃滿 200 顆會「覚醒」：接下來 50 轉，中大當的機會加倍（小螢幕會顯示還剩幾轉）。",
      "gl.commanders": "四大幹部|從平常（或時短）中大當，就會收一位幹部當夥伴：劍鬼、狼王、龍姬、影。每收一位，機台上方護手的寶石就亮一顆。",
      "gl.maou": "魔王降臨|四大幹部到齊時，下一次 RUSH 的連莊率提高一級。那次 RUSH 開始時寶石會清空，重新收集。",
      "gl.renzen": "連戰 RUSH|這台的 RUSH 是一場接一場的戰鬥：每連中一次就打下一戰（第 1 戰、第 2 戰⋯），越往後敵人越強。",
      "gl.rush": "連戦RUSH|大當之後的特別模式，中獎機率很高，很容易一直連續中。連中會升級：連戦 → 猛攻（連 2）→ 魔王（連 3），畫面和顏色跟著變。",
    }),
  };

  // Machine 4, 蒸氣巨神 (design: dev/MACHINE4.md): the clockwork colossus of a lost civilisation under a
  // steam city. Brass, copper, iron and furnace amber (theme: "brass"); rivets, pressure gauges, steam
  // pipes and a half gear over the window (frame: "titan"), where its 3D head will rest; machine 3's board
  // with the whirlpool as a turning furnace gear (pins: "titan"). In the hall as 試作中.
  PK.MACHINES.titan = {
    id: "titan",
    name: "蒸氣巨神",
    crest: "巨",
    serial: "0404",
    assetsBase: "assets/titan_",
    theme: "brass",
    refill: 10000,
    card: "jackpot_art.jpg",
    preview: "preview.jpg",
    tutPrefix: "titan_",
    tagline: "【試作中】古代機械巨神：3D 大型機關、ラッキートリガー、神域RUSH",
    odds: E.odds,
    engine: E.engine,
    cabinet: { pins: "titan", frame: "titan", art: {} },
    // the 3D head (src/titan3d.js): its canvas over the stage (design units), resting in front of the half
    // gear over the window and dropping in front of the LCD's top (three.js world units, scale)
    // ラッキートリガー: a RUSH hit pulls it with `chance`; the rest of the streak (神域RUSH) runs one odds
    // preset up and every hit is a 10R (engine luckyTrigger; the shell picks the preset)
    lt: { chance: 1 / 8 },
    head3d: { base: "assets/titan_", box: [94, 0, 400, 420], rest: { y: 1.86, s: 0.38 }, down: { y: -0.65, s: 0.88 } },
    text: Object.assign({}, E.text, {
      "lcd.logoL": "蒸気", "lcd.logoR": "巨神", "lcd.crest": "巨",
      "lcd.lt": "ラッキートリガー!!", "lcd.ltSub": "神域RUSH突入",
      // the LCD (Japanese): the colossus, its old engineer, the iron beasts
      "lcd.gun": "鉄獣群", "lcd.kokuchi": "巨神起動!!", "lcd.zone": "臨界ゾーン", "lcd.premium": "黄金飛来!!",
      "lcd.serif.white": "む……何か来るか？", "lcd.serif.blue": "圧力が、上がっておる。", "lcd.serif.green": "いい調子じゃ！",
      "lcd.serif.red": "いけるぞ、いける！", "lcd.serif.gold": "全ての蒸気を、この一撃に！",
      "lcd.spReach": "巨神リーチ", "lcd.spspReach": "炉心リーチ",
      "lcd.hero": "蒸気巨神", "lcd.rival": "鉄獣王", "lcd.battle": "巨神決戦", "lcd.lose": "機能停止…", "lcd.battleHint": "炉心全開!!",
      "lcd.roundLines": "叩き潰せ！|蒸気全開！|まだまだ！|圧力上昇！|歯車よ回れ！|巨神の拳！|一気に行け！|炉心が燃える！|押し切れ！|勝利は目前！",
      "lcd.minions": "鉄狼|発条蠍|甲虫戦車|鉄牛|機械大蛇|鉄翼鬼",
      "lcd.awakenTitle": "巨神覚醒チャレンジ", "lcd.awakenHint": "PUSH連打で炉心に火を入れろ！", "lcd.awakenOk": "巨神覚醒!!",
      "lcd.rushName0": "巨神", "lcd.rushName1": "烈風", "lcd.rushName2": "黄金", "lcd.rushOver": "巨神RUSH 終了",
      // the shell (Chinese)
      "ex.sp": "巨神リーチ|巨神在蒸汽城市裡起身的聽牌", "ex.battleWin": "巨神決戦・勝利|巨神打倒鐵獸王", "ex.battleLose": "巨神決戦・敗北|巨神被鐵獸王打倒",
      "ex.gun": "鉄獣群|一大群鋼鐵巨獸衝過畫面", "ex.zone": "臨界ゾーン|邊框越來越燙，最後勝負!!", "ex.premium": "黄金飛来|很少見，黃金飛船飛過＝確定大當",
      "ms.note": "每天換 3 個新任務，完成就送珠子和經驗。中大當、打倒鋼鐵巨獸也有經驗。等級和稱號按「重新開始」也不會清除。",
      "ms.boss": "打倒 {n} 隻鋼鐵巨獸", "ms.sp": "看到 {n} 次大演出（巨神リーチ、巨神決戦、激アツ）",
      "lv.titles": "見習技師|蒸汽技師|巨神駕駛|鋼鐵英雄|巨神之主",
      "rec.boss": "擊倒鋼鐵巨獸", "ach.rush": "突入 RUSH|第一次進入巨神RUSH", "ach.boss": "擊倒巨獸|大當中連打 PUSH 擊倒鋼鐵巨獸",
      "ach.boss10": "巨獸剋星|擊倒 10 隻鋼鐵巨獸", "ach.awaken": "巨神覺醒|在決定戰讓巨神覺醒", "ach.premium": "黃金飛來|看到很少見的黃金飛船",
      "cap.premium": "黄金飛来：黃金飛船飛過整個畫面＝確定大當！很少見", "cap.zone": "臨界ゾーン（先讀預告）：後面排隊的保留裡可能藏著大當，最後一轉出現「勝負!!」",
      "cap.battle": "巨神決戦（對決）：連打 PUSH 幫巨神，打贏就是大當", "cap.gun": "鉄獣群預告：大約一半機會",
      "cap.rush": "巨神RUSH：很容易連續中獎", "cap.minion": "大當中：連打 PUSH 打倒鋼鐵巨獸，打倒多拿 100 顆",
      "cap.awaken": "最後決戰：連打 PUSH 替巨神的爐心點火，成功就進 RUSH！", "cap.awakenNg": "這次爐心沒點著，接下來是時短 20 轉",
      "gl.credits": "配音：VOICEVOX:No.7、VOICEVOX:ちび式じい",
      "gl.flow": "打珠|珠子進入賞口|數字轉|リーチ（聽牌）|大当り（大當）|右打ち拿珠|巨神RUSH 或 時短",
      "gl.boss": "鋼鐵巨獸|大當前幾回合出現的鐵獸王手下，每次大當換一隻。連打 PUSH 把牠的血條打光，就多拿 100 顆。開了「自動 PUSH」會自動幫你打。",
      "gl.awaken": "巨神覚醒チャレンジ（巨神覺醒挑戰）|大當最後一回合的決定戰。連打 PUSH 替巨神的爐心點火：成功就進巨神RUSH，沒醒就是時短 20 轉。結果在中大當時就決定了。",
      "gl.rush": "巨神RUSH|大當之後的特別模式。中獎機率很高，很容易一直連續中。連中會升級：巨神RUSH → 烈風RUSH（連 2）→ 黃金RUSH（連 3）。另外有ラッキートリガー觸發的神域RUSH。",
      "gl.gun": "鉄獣群預告|一大群鋼鐵巨獸衝過畫面，大約一半機會。",
      "gl.battle": "巨神決戦（對決）|リーチ後巨神和鐵獸王對戰。連打 PUSH 幫巨神，打贏就是大當。",
      "gl.kokuchi": "巨神起動!!（確定告知）|巨神的頭落下、眼睛發金光，一出現就確定中了大當。",
      "gl.zone": "臨界ゾーン（先讀預告）|畫面邊緣連續好幾轉越來越燙。表示後面排隊的保留裡可能有大當（大約四成），輪到那一轉時出現「勝負!!」。",
      "gl.premium": "黄金飛来|很少見的演出：黃金飛船飛過整個畫面，出現就確定大當。",
      "cab.subUpper": "神域RUSH\n約{p}%",
      "cap.lt": "ラッキートリガー：升級成神域RUSH！連莊率提高，之後每次大當都是 10 回合",
      "gl.lt": "ラッキートリガー（幸運扳機）|RUSH 中中大當時，大約 8 次有 1 次會觸發。巨神張開臉、全身發金光，升級成「神域RUSH」：連莊率提高一級，而且之後每次大當都是 10 回合，一直到這一輪 RUSH 結束。",
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
