/* ============================================================
   NEON STORM — COMPLETE SINGLE-FILE JAVASCRIPT ENGINE
   Under the supervision of Professor Safwan
   ============================================================ */
(function(global) {
  'use strict';
  const NS = global.NeonStorm = global.NeonStorm || {};

  /* ---------- CONFIG ---------- */
  NS.CFG = {
    MAX_PARTICLES: 300, MAX_PLAYER_BULLETS: 60, MAX_DT: 0.05, FREEZE_DT: 0.5,
    COMBO_DURATION: 2, BOMB_FLASH_ALPHA: 0.4, SHAKE_DECAY: 0.92,
    BOSS_ENTRY_SPEED: 80, ENEMY_BULLET_MAX: 250, POWERUP_GUARANTEE_KILLS: 8,
    MAX_ENEMIES: 28, BOMB_SPAWN_DELAY: 1.2, MAX_FLOATING_TEXTS: 50,
    JOY_DEADZONE: 0.1, COIN_MAGNET_BASE: 80, MAX_COIN_PICKUPS: 60,
    QUALITY: {
      high: { particles: 300, shadows: true, glow: 1.0, fps: 60, maxEnemies: 28 },
      medium: { particles: 150, shadows: false, glow: 0.5, fps: 60, maxEnemies: 22 },
      low: { particles: 60, shadows: false, glow: 0.2, fps: 30, maxEnemies: 16 }
    },
    DIFFICULTY: {
      easy: { hpMult: 0.6, spdMult: 0.7, scMult: 1.2, healChance: 0.25 },
      normal: { hpMult: 1, spdMult: 1, scMult: 1, healChance: 0.1 },
      hard: { hpMult: 1.5, spdMult: 1.3, scMult: 0.8, healChance: 0 }
    },
    FAKE_NAMES: ['نجم_الظلام','صاعقة_نيون','محطم_الفضاء','حارس_المجرة','نسر_الكون','سهم_البرق','فارس_العتمة','ملك_الانفجارات','ذئب_النجوم','ظل_النيون','Phoenix','DarkStar','NeoViper','CosmicAce','StarBlade'],
    WAVE_COLORS: ['#00e5ff','#00ff88','#ff2d95','#ffd700','#aa66ff'],
    TITLES: [
      { min: 1, ar: 'مبتدئ نيون', en: 'Neon Novice' },
      { min: 10, ar: 'صائد الزعماء', en: 'Boss Hunter' },
      { min: 25, ar: 'العاصفة الأبدية', en: 'Eternal Storm' },
      { min: 50, ar: 'أسطورة النيون', en: 'Neon Legend' }
    ]
  };

  /* ---------- MATH ---------- */
  NS.TAU = Math.PI * 2;
  NS.lerp = (a, b, t) => a + (b - a) * t;
  NS.rand = (min, max) => Math.random() * (max - min) + min;
  NS.randInt = (min, max) => Math.floor(NS.rand(min, max + 1));
  NS.dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  NS.clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  NS.angle = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);
  NS.hexToRgb = (hex) => {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `${r},${g},${b}`;
  };

  /* ---------- STORE ---------- */
  NS.Store = {
    get(key, defaultValue) {
      try { const val = localStorage.getItem('ns_' + key); return val !== null ? JSON.parse(val) : defaultValue; }
      catch (e) { return defaultValue; }
    },
    set(key, value) {
      try { localStorage.setItem('ns_' + key, JSON.stringify(value)); }
      catch (e) {
        try {
          const keys = Object.keys(localStorage).filter(k => k.startsWith('ns_'));
          keys.slice(0, Math.floor(keys.length / 2)).forEach(k => localStorage.removeItem(k));
          localStorage.setItem('ns_' + key, JSON.stringify(value));
        } catch (e2) {}
      }
    },
    remove(key) { try { localStorage.removeItem('ns_' + key); } catch (e) {} }
  };

  /* ---------- OBJECT POOL ---------- */
  NS.ObjPool = class {
    constructor(factoryFn, maxSize) { this.factoryFn = factoryFn; this.max = maxSize; this.pool = []; this.active = []; }
    get() { let obj; if (this.pool.length) obj = this.pool.pop(); else obj = this.factoryFn(); this.active.push(obj); return obj; }
    release(obj) { const idx = this.active.indexOf(obj); if (idx >= 0) this.active.splice(idx, 1); if (this.pool.length < this.max) this.pool.push(obj); }
    releaseAll() { while (this.active.length) { if (this.pool.length < this.max) this.pool.push(this.active.pop()); else this.active.pop(); } }
    forEach(fn) { for (let i = this.active.length - 1; i >= 0; i--) fn(this.active[i], i); }
  };

  /* ---------- AUDIO ---------- */
  NS.Audio = {
    ctx: null, comp: null, gain: null,
    sfxOn: NS.Store.get('sfxOn', true), musicOn: NS.Store.get('musicOn', true),
    hapticOn: NS.Store.get('hapticOn', true), masterVol: NS.Store.get('masterVol', 0.5),
    musicNodes: [], musicPlaying: false, musicBeat: 0, musicTimeoutId: null, batteryLow: false,
    init() {
      if (this.ctx) return;
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (!this.ctx.createDynamicsCompressor) return;
        this.comp = this.ctx.createDynamicsCompressor(); this.comp.threshold.value = -24; this.comp.knee.value = 12;
        this.comp.ratio.value = 8; this.comp.attack.value = 0.005; this.comp.release.value = 0.1;
        this.gain = this.ctx.createGain(); this.gain.gain.value = this.masterVol; this.gain.connect(this.comp); this.comp.connect(this.ctx.destination);
        this.checkBattery();
      } catch (e) {}
    },
    async checkBattery() {
      try {
        if (navigator.getBattery) { const b = await navigator.getBattery(); this.batteryLow = b.level < 0.15; b.addEventListener('levelchange', () => { this.batteryLow = b.level < 0.15; if (this.batteryLow) this.hapticOn = false; }); }
      } catch (e) {}
    },
    resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); },
    play(type, pitch = 1) {
      if (!this.ctx || !this.sfxOn) return; const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator(), g = this.ctx.createGain(); osc.connect(g); g.connect(this.gain);
      const S = {
        shoot:{w:'square',f:[800,400],d:.04,v:.05}, hit:{w:'triangle',f:[250,80],d:.06,v:.06},
        expl:{w:'sawtooth',f:[150,25],d:.25,v:.08}, powerup:{w:'sine',f:[523,1047],d:.25,v:.07},
        boss:{w:'sawtooth',f:[80,50],d:.8,v:.10}, bomb:{w:'sawtooth',f:[300,10],d:.8,v:.12},
        nodmg:{w:'sine',f:[200,150],d:.15,v:.04}, ding:{w:'sine',f:[880,1760],d:.2,v:.05},
        die:{w:'sawtooth',f:[200,30],d:.6,v:.10}, freeze:{w:'sine',f:[2000,500],d:.3,v:.06},
        split:{w:'triangle',f:[400,200],d:.2,v:.05}, amb:{w:'sine',f:[55,60],d:2,v:.015},
        achievement:{w:'sine',f:[600,1200],d:.6,v:.08}, heartbeat:{w:'sine',f:[40,50],d:0.3,v:.03},
        steal:{w:'sawtooth',f:[300,100],d:.3,v:.05}
      };
      const s = S[type]; if (!s) return;
      osc.type = s.w; const f0 = s.f[0] * pitch, f1 = Math.max(s.f[1] * pitch, 20);
      if (f0 > 0) osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(f1, now + s.d);
      g.gain.setValueAtTime(s.v * this.masterVol, now); g.gain.exponentialRampToValueAtTime(0.001, now + s.d);
      osc.start(now); osc.stop(now + s.d + 0.01);
      this.musicNodes.push(osc, g); while (this.musicNodes.length > 60) { const n = this.musicNodes.shift(); try { n.stop(); } catch (e) {} }
    },
    vibrate(pattern) { if (this.hapticOn && !this.batteryLow && navigator.vibrate) try { navigator.vibrate(pattern); } catch (e) {} },
    startMusic() {
      if (this.musicPlaying || !this.ctx || !this.musicOn) return;
      this.musicPlaying = true; this.musicBeat = 0; this.tickMusic();
    },
    stopMusic() {
      this.musicPlaying = false; if (this.musicTimeoutId) { clearTimeout(this.musicTimeoutId); this.musicTimeoutId = null; }
      this.musicNodes.forEach(n => { try { n.stop(); } catch (e) {} }); this.musicNodes = [];
    },
    tickMusic() {
      if (!this.musicPlaying || !this.ctx || NS.gameState.state !== 'playing') return;
      const t = this.ctx.currentTime, beatDur = 60 / 120;
      const bass = [55,55,65.41,73.42,55,82.41,73.42,55]; const note = bass[this.musicBeat % bass.length];
      const osc = this.ctx.createOscillator(), g = this.ctx.createGain(); osc.connect(g); g.connect(this.gain);
      osc.type = 'triangle'; osc.frequency.value = note;
      g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.001, t + beatDur * 0.8);
      osc.start(t); osc.stop(t + beatDur); this.musicNodes.push(osc);
      if (this.musicBeat % 4 === 0) {
        const pad = this.ctx.createOscillator(), pg = this.ctx.createGain(); pad.connect(pg); pg.connect(this.gain);
        pad.type = 'sine'; pad.frequency.value = note * 2;
        pg.gain.setValueAtTime(0.02, t); pg.gain.exponentialRampToValueAtTime(0.001, t + beatDur * 3.5);
        pad.start(t); pad.stop(t + beatDur * 4); this.musicNodes.push(pad);
      }
      this.musicBeat++; while (this.musicNodes.length > 40) this.musicNodes.shift();
      this.musicTimeoutId = setTimeout(() => this.tickMusic(), beatDur * 500);
    }
  };

  /* ---------- I18N ---------- */
  NS.LANG_DATA = {
    ar: { start:'ابدأ اللعب', boss:'تحدي الزعماء', survival:'طور البقاء', shop:'المتجر', achievements:'الإنجازات', leaderboard:'لوحة الصدارة', settings:'الإعدادات', howto:'كيف تلعب', resume:'استئناف', quit:'القائمة الرئيسية', wave:'الموجة', bossWarn:'تحذير!', guard:'الحارس', enhanced:'المعزز', rage:'الغضب', destroyer:'المدمر', perfect:'مثالية!', newHi:'رقم قياسي جديد!', gameOver:'انتهت اللعبة', score:'النقاط', kills_lbl:'القتلى', combo_lbl:'أعلى كومبو', coins_lbl:'العملات', hi_lbl:'أعلى نتيجة', rank_lbl:'التصنيف', xp_lbl:'الخبرة', retry:'إعادة المحاولة', share:'مشاركة النتيجة', menu:'القائمة الرئيسية', pause:'إيقاف مؤقت', diff:'اختر الصعوبة', loading:'جاري التحميل...', ready:'جاهز!', newCombo:'كومبو جديد', noBombs:'لا توجد قنابل!', levelUp:'مستوى جديد!', dailyReward:'🎉 مكافأة يومية:', diffRaised:'🔥 تم رفع الصعوبة تلقائياً للصعب!', needLv3:'تحتاج المستوى 3', needLv5:'تحتاج المستوى 5' },
    en: { start:'Start Game', boss:'Boss Challenge', survival:'Survival Mode', shop:'Shop', achievements:'Achievements', leaderboard:'Leaderboard', settings:'Settings', howto:'How to Play', resume:'Resume', quit:'Main Menu', wave:'Wave', bossWarn:'Warning!', guard:'Guardian', enhanced:'Enhanced', rage:'Rage', destroyer:'Destroyer', perfect:'Perfect!', newHi:'New Highscore!', gameOver:'Game Over', score:'Score', kills_lbl:'Kills', combo_lbl:'Max Combo', coins_lbl:'Coins', hi_lbl:'High Score', rank_lbl:'Rank', xp_lbl:'XP', retry:'Retry', share:'Share Result', menu:'Main Menu', pause:'Paused', diff:'Select Difficulty', loading:'Loading...', ready:'Ready!', newCombo:'New Combo', noBombs:'No bombs!', levelUp:'New Level!', dailyReward:'🎉 Daily Reward:', diffRaised:'🔥 Difficulty auto-raised to Hard!', needLv3:'Need level 3', needLv5:'Need level 5' }
  };
  NS.currentLang = NS.Store.get('ns_lang', 'ar');
  NS.t = function(key) { return (NS.LANG_DATA[NS.currentLang] && NS.LANG_DATA[NS.currentLang][key]) || (NS.LANG_DATA['ar'] && NS.LANG_DATA['ar'][key]) || key; };

  /* ---------- META ---------- */
  NS.meta = NS.Store.get('meta', {
    coins:0, xp:0, level:1, playerName:'', upgrades:{dmg:0,hp:0,spd:0,fr:0,bombs:0,magnet:0,drone:0},
    achievements:{}, leaderboard:[], hallOfFame:[],
    stats:{ totalGames:0,totalKills:0,totalScore:0,bestWave:0,bossKills:0,maxCombo:0,bombKillsMax:0,perfectWaves:0,totalCoins:0,shared:false,bestScore:0,totalPlayTime:0,shotsFired:0,accuracy:0,survived1hp:false },
    daily:{}, weekly:{}, settings:{quality:'high'}, lastSave:0, loginStreak:1, lastLoginDay:0
  });
  if (!NS.meta.playerName) NS.meta.playerName = NS.CFG.FAKE_NAMES[NS.randInt(0, NS.CFG.FAKE_NAMES.length - 1)];
  NS.xpForLevel = (l) => Math.floor(100 * l * Math.pow(1.3, l - 1));
  NS.addXP = function(amount) {
    let remaining = amount;
    while (remaining > 0) {
      const needed = NS.xpForLevel(NS.meta.level) - NS.meta.xp;
      if (remaining >= needed) { remaining -= needed; NS.meta.xp = 0; NS.meta.level++; NS.UI.notify(NS.t('levelUp') + ' ' + NS.meta.level, 'gold', 2500); NS.Audio.play('ding'); }
      else { NS.meta.xp += remaining; remaining = 0; }
    }
    NS.Store.set('meta', NS.meta);
  };
  NS.getRank = (sc) => { if (sc >= 100000) return 'S'; if (sc >= 50000) return 'A'; if (sc >= 20000) return 'B'; if (sc >= 10000) return 'C'; if (sc >= 5000) return 'D'; return 'E'; };
  NS.getTitle = function() { const lv = NS.meta.level; let t = NS.CFG.TITLES[0]; for (const tt of NS.CFG.TITLES) if (lv >= tt.min) t = tt; return NS.currentLang === 'ar' ? t.ar : t.en; };

  /* ---------- GAME STATE ---------- */
  NS.gameState = {
    state:'loading', lastTime:0, globalTime:0, gameTime:0, quality:NS.CFG.QUALITY[NS.meta.settings?.quality||'high'],
    difficulty:'normal', gameMode:'normal', nightMode:NS.Store.get('nightMode',false),
    targetFPS:60, frameInterval:1000/60, animationFrameId:null,
    joystickSensitivity:NS.Store.get('joystickSensitivity',100)/100, joystickSize:NS.Store.get('joystickSize','medium'),
    showFPS:NS.Store.get('showFPS',false), isMobileDevice:false
  };

  /* ---------- GLOBALS (will be set during game start) ---------- */
  NS.player = null; NS.score = 0; NS.wave = 0; NS.combo = 0; NS.comboTimer = 0; NS.maxCombo = 0; NS.kills = 0;
  NS.bombs = 3; NS.coins = 0; NS.waveKills = 0; NS.shield = 0; NS.shieldMax = 0;
  NS.powerupActive = null; NS.powerupTimer = 0; NS.hitSoundCooldown = 0; NS.killsSinceLastPU = 0;
  NS.gameOverDelay = 0; NS.gameOverShown = false; NS.goTimer = 0;
  NS.flashAlpha = 0; NS.flowAlpha = 0; NS.hiScoreNotified = false; NS.hiComboNotified = false;
  NS.shotsFiredThisGame = 0; NS.shotsHitThisGame = 0; NS.comboPitch = 1.0;
  NS.perfectWavesThisGame = 0; NS.bombUsedThisWave = false; NS.achQueue = [];
  NS.bossDefeatTimers = []; NS.currentWaveColor = '#00e5ff'; NS.coinPickups = [];
  NS.slowMoActive = false; NS.slowMoTimer = 0; NS.bulletTimeActive = false; NS.bulletTimeTimer = 0;
  NS.shX = 0; NS.shY = 0; NS.shPower = 0; NS.shDuration = 0;
  NS.waveDamageTaken = false; NS.waveDone = false; NS.waveDelay = 0;
  NS.enemies = []; NS.powerups = []; NS.boss = null; NS.waveQueue = []; NS.waveSpawnTimer = 0;
  NS.aimAssist = NS.Store.get('aimAssist', true);

  /* ---------- ENTITIES: PLAYER ---------- */
  NS.PB = { w:28, h:36, baseHp:100, baseSpd:380, baseFr:0.1, baseDmg:12, baseBombs:3 };
  NS.createPlayer = function() {
    const hp = NS.PB.baseHp + (NS.meta.upgrades.hp || 0) * 15, spd = NS.PB.baseSpd + (NS.meta.upgrades.spd || 0) * 20;
    const fr = Math.max(0.04, NS.PB.baseFr - (NS.meta.upgrades.fr || 0) * 0.008);
    const dmg = NS.PB.baseDmg + (NS.meta.upgrades.dmg || 0) * 3, bm = NS.PB.baseBombs + (NS.meta.upgrades.bombs || 0);
    return { x:NS.W/2, y:NS.H-100, w:NS.PB.w, h:NS.PB.h, hp, maxHp:hp, spd, fireRate:fr, dmg, fireTimer:0, invTimer:0, engPh:0, alive:true, lowHPTimer:0, vx:0, vy:0 };
  };
  NS.updatePlayer = function(dt) {
    const player = NS.player; if (!player || !player.alive || NS.gameState.state !== 'playing') return;
    let dx=0, dy=0; if (NS.keys.ArrowLeft||NS.keys.KeyA) dx--; if (NS.keys.ArrowRight||NS.keys.KeyD) dx++; if (NS.keys.ArrowUp||NS.keys.KeyW) dy--; if (NS.keys.ArrowDown||NS.keys.KeyS) dy++;
    if (NS.joyActive) { dx += NS.joyDX; dy += NS.joyDY; }
    const len = Math.hypot(dx, dy); if (len > 1) { dx /= len; dy /= len; }
    const spdM = NS.powerupActive === 'speed' ? 1.5 : 1;
    player.vx = NS.lerp(player.vx, dx * player.spd * spdM, dt * 8); player.vy = NS.lerp(player.vy, dy * player.spd * spdM, dt * 8);
    player.x = NS.clamp(player.x + player.vx * dt, 30, NS.W - 30); player.y = NS.clamp(player.y + player.vy * dt, 30, NS.H - 30);
    player.fireTimer -= dt;
    if (NS.fireHeld && player.fireTimer <= 0) { NS.playerFire(); player.fireTimer = NS.powerupActive === 'rapid' ? player.fireRate * 0.6 : player.fireRate; }
    player.engPh += dt * 10;
    if (Math.random() < 0.7 && NS.particlePool.active.length < NS.gameState.quality.particles) {
      const p = NS.particlePool.get(); p.x = player.x + NS.rand(-4,4); p.y = player.y + player.h/2 + 3; p.vx = NS.rand(-15,15); p.vy = NS.rand(40,120); p.life = NS.rand(0.1,0.25); p.maxLife = 0.25; p.col = Math.random()>0.5?'#00e5ff':'#0088ff'; p.sz = NS.rand(1.5,3);
    }
    if (NS.powerupActive) { NS.powerupTimer -= dt; if (NS.powerupTimer <= 0) NS.powerupActive = null; }
    if (player.invTimer > 0) player.invTimer -= dt;
    if (NS.bombPressed) { NS.bombPressed = false; if (NS.bombs > 0) NS.useBomb(); else { NS.Audio.play('nodmg'); NS.spawnText(player.x, player.y - 40, NS.t('noBombs'), '#ff4444'); } }
    if (NS.shield > 0) { NS.shield -= dt * 2; if (NS.shield < 0) NS.shield = 0; }
    if (player.hp <= 1 && player.alive) { player.lowHPTimer += dt; if (player.lowHPTimer >= 10) { NS.meta.stats.survived1hp = true; NS.checkAchievements(); } }
    const magnetRange = NS.CFG.COIN_MAGNET_BASE + (NS.meta.upgrades.magnet || 0) * 30;
    for (let i = NS.coinPickups.length - 1; i >= 0; i--) {
      const c = NS.coinPickups[i]; const d = NS.dist(c.x, c.y, player.x, player.y);
      if (d < magnetRange && d > 0) { c.x += ((player.x-c.x)/d)*200*dt; c.y += ((player.y-c.y)/d)*200*dt; if (d < 30) { NS.coins += c.val; NS.coinPickups.splice(i,1); NS.Audio.play('powerup'); } }
    }
    if (player.hp / player.maxHp < 0.2 && !NS.bulletTimeActive && player.alive) { NS.bulletTimeActive = true; NS.bulletTimeTimer = 3.0; NS.slowMoActive = true; NS.slowMoTimer = 3.0; }
    if (NS.bulletTimeActive) { NS.bulletTimeTimer -= dt; if (NS.bulletTimeTimer <= 0) { NS.bulletTimeActive = false; NS.slowMoActive = false; } }
  };
  NS.renderPlayer = function() {
    const player = NS.player; if (!player || !player.alive) return; const ctx = NS.ctx;
    if (player.invTimer > 0 && Math.sin(player.invTimer * 20) > 0) return;
    ctx.save(); ctx.translate(player.x, player.y);
    if (NS.shield > 0) { ctx.strokeStyle = '#0066ff'; ctx.globalAlpha = 0.15+0.1*Math.sin(Date.now()/200); if (NS.gameState.quality.shadows) { ctx.shadowColor='#0066ff'; ctx.shadowBlur=20; } ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,0,30,0,NS.TAU); ctx.stroke(); ctx.globalAlpha=1; ctx.shadowBlur=0; }
    if (NS.gameState.quality.shadows) { ctx.shadowColor = NS.combo>=20?'#ff4444':NS.currentWaveColor; ctx.shadowBlur = NS.combo>=20?18:12; }
    ctx.fillStyle = NS.combo>=20?'#2a0505':'#101830'; ctx.strokeStyle = NS.combo>=20?'#ff4444':NS.currentWaveColor; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0,-player.h/2); ctx.lineTo(-player.w/2,player.h/2); ctx.lineTo(-player.w/4,player.h/3); ctx.lineTo(player.w/4,player.h/3); ctx.lineTo(player.w/2,player.h/2); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = NS.combo>=20?'#ff4444':NS.currentWaveColor; ctx.globalAlpha=0.5; ctx.beginPath(); ctx.moveTo(0,-player.h/3); ctx.lineTo(-5,player.h/6); ctx.lineTo(5,player.h/6); ctx.closePath(); ctx.fill(); ctx.globalAlpha=1;
    const eg = 0.4+0.3*Math.sin(player.engPh); const gr = ctx.createRadialGradient(0,player.h/2+5,0,0,player.h/2+5,14); gr.addColorStop(0,`rgba(${NS.combo>=20?'255,68,68':NS.hexToRgb(NS.currentWaveColor)},${eg})`); gr.addColorStop(1,'transparent'); ctx.fillStyle=gr; ctx.fillRect(-12,player.h/2-3,24,22); ctx.shadowBlur=0; ctx.restore();
  };
  NS.playerDie = function() {
    if (!NS.player.alive) return; NS.player.alive = false; NS.pBulletPool.releaseAll(); NS.eBulletPool.releaseAll(); NS.powerups.length = 0;
    NS.comboTimer = 0; NS.combo = 0; ['up','down','left','right'].forEach(d => document.getElementById('arrow-'+d)?.classList.remove('visible'));
    NS.slowMoActive = true; NS.slowMoTimer = 0.8; NS.bulletTimeActive = false;
    NS.spawnExpl(NS.player.x, NS.player.y, '#00e5ff', 4); NS.spawnExpl(NS.player.x, NS.player.y, '#ff2d95', 3);
    NS.Audio.play('die'); NS.Audio.vibrate([100,50,200]); NS.shake(15,0.5); NS.flashAlpha = 0.5; NS.gameOverDelay = 1.5;
  };
  NS.damagePlayer = function(amt) {
    const player = NS.player; if (player.invTimer > 0 || !player.alive) return; NS.waveDamageTaken = true;
    if (NS.shield > 0) { NS.shield -= amt; if (NS.shield < 0) { amt = -NS.shield; NS.shield = 0; } else { amt = 0; player.invTimer = 1.5; NS.shake(4,0.1); NS.spawnParts(player.x, player.y, '#0088ff', 3, 60, 0.2, 2); return; } }
    if (amt > 0) { player.hp -= amt; player.invTimer = 1.5; NS.shake(8,0.2); NS.Audio.play('hit'); NS.Audio.vibrate(50); NS.spawnParts(player.x, player.y, '#ff4444', 5, 100, 0.3, 2); player.lowHPTimer = 0; if (player.hp <= 0) NS.playerDie(); }
  };
  NS.healPlayer = function(amt) { NS.player.hp = Math.min(NS.player.maxHp, NS.player.hp + amt); };

  /* ---------- ENTITIES: ENEMY TYPES ---------- */
  NS.ET = {
    drone:{hp:20,spd:100,sc:100,col:'#ff4444',w:18,fr:0,mv:'sine'}, hunter:{hp:30,spd:170,sc:150,col:'#ff6622',w:22,fr:0,mv:'homing'},
    shooter:{hp:40,spd:40,sc:200,col:'#cc2255',w:24,fr:1.8,mv:'straight'}, tank:{hp:70,spd:40,sc:300,col:'#ff0066',w:28,fr:1.2,mv:'straight'},
    speeder:{hp:15,spd:250,sc:120,col:'#ffff00',w:15,fr:0,mv:'zigzag'}, shielder:{hp:50,spd:60,sc:250,col:'#4488ff',w:26,fr:0,mv:'shield'},
    elite:{hp:100,spd:80,sc:500,col:'#ff00ff',w:30,fr:0.8,mv:'circle'}, splitter:{hp:25,spd:120,sc:150,col:'#88ff00',w:20,fr:0,mv:'sine',split:true},
    cloaker:{hp:30,spd:90,sc:200,col:'#444444',w:22,fr:1.5,mv:'cloaked',cloak:true}, kamikaze:{hp:10,spd:350,sc:180,col:'#ff8800',w:16,fr:0,mv:'kamikaze'},
    thief:{hp:20,spd:280,sc:200,col:'#ffaa00',w:17,fr:0,mv:'thief'}, exploder:{hp:35,spd:110,sc:220,col:'#ff5500',w:22,fr:0,mv:'sine',explode:true}
  };

  /* ---------- ENTITIES: ENEMY SPAWN/UPDATE/RENDER ---------- */
  NS.spawnEnemy = function(type, xp, yp) {
    if (NS.enemies.length >= NS.gameState.quality.maxEnemies) return; const t = NS.ET[type]; if (!t) return;
    const dm = NS.CFG.DIFFICULTY[NS.gameState.difficulty]; let x = xp || NS.rand(50, NS.W-50), y = yp || -30;
    if (NS.player && NS.player.alive && NS.dist(x, y, NS.player.x, NS.player.y) < 200) x = (NS.player.x > NS.W/2) ? NS.rand(30, NS.player.x-200) : NS.rand(NS.player.x+200, NS.W-30);
    NS.enemies.push({ type,x,y, hp:Math.round(t.hp*dm.hpMult), maxHp:Math.round(t.hp*dm.hpMult), spd:t.spd*dm.spdMult, score:Math.round(t.sc*dm.scMult), col:t.col, w:t.w, fr:t.fr, ft:NS.rand(0,t.fr||2), mv:t.mv, ph:NS.rand(0,NS.TAU), done:false, tgtY:NS.rand(60,NS.H*0.35), circPh:NS.rand(0,NS.TAU), split:t.split||false, cloak:t.cloak||false, cloakT:0, thiefTarget:null, explode:t.explode||false });
  };
  NS.updateEnemies = function(dt) {
    if (NS.gameState.state !== 'playing') return;
    for (let i = NS.enemies.length-1; i >= 0; i--) {
      const e = NS.enemies[i]; const frzM = NS.powerupActive === 'freeze' ? 0.3 : 1; const spd = e.spd * frzM;
      switch (e.mv) {
        case 'sine': if (!e.done) { e.y += spd*dt; if (e.y >= e.tgtY) e.done = true; } if (e.done) { e.ph += dt*2; e.x += Math.sin(e.ph)*spd*0.5*dt; e.y += spd*0.1*dt; } break;
        case 'homing': { const a = NS.angle(e.x,e.y,NS.player.x,NS.player.y); e.x += Math.cos(a)*spd*dt; e.y += Math.sin(a)*spd*dt; if (e.y > NS.H*0.5) e.y = NS.H*0.5; } break;
        case 'straight': if (!e.done) { e.y += spd*2*dt; if (e.y >= e.tgtY) e.done = true; } if (e.done) e.y += spd*0.06*dt; break;
        case 'zigzag': if (!e.done) { e.y += spd*dt; e.x += Math.sin(e.ph)*spd*0.8*dt; e.ph += dt*4; if (e.y >= e.tgtY) e.done = true; } if (e.done) { e.ph += dt*3; e.x += Math.cos(e.ph)*spd*0.4*dt; e.y += spd*0.15*dt; } break;
        case 'shield': if (!e.done) { e.y += spd*1.5*dt; if (e.y >= e.tgtY) e.done = true; } if (e.done) { e.y += spd*0.05*dt; e.ph += dt*2; } break;
        case 'circle': e.circPh += dt*1.5; if (!e.done) { e.y += spd*dt; if (e.y >= e.tgtY) e.done = true; } if (e.done) { e.x = NS.W/2 + Math.cos(e.circPh)*NS.W*0.3; e.y = e.tgtY + Math.sin(e.circPh*0.7)*60; } break;
        case 'cloaked': if (!e.done) { e.y += spd*dt; if (e.y >= e.tgtY) e.done = true; } if (e.done) { e.cloakT += dt; e.ph += dt*0.5; e.x += Math.sin(e.ph)*spd*0.3*dt; e.y += spd*0.08*dt; e.cloak = e.cloakT % 4 > 2; } break;
        case 'kamikaze': { const a = NS.angle(e.x,e.y,NS.player.x,NS.player.y); e.x += Math.cos(a)*spd*dt; e.y += Math.sin(a)*spd*dt; } break;
        case 'thief': if (!e.done) { e.y += spd*dt; if (e.y >= e.tgtY) e.done = true; } if (e.done) { if (!e.thiefTarget || !NS.powerups.includes(e.thiefTarget)) { let closest=null,cd=Infinity; NS.powerups.forEach(p=>{const d=NS.dist(e.x,e.y,p.x,p.y); if(d<cd){cd=d;closest=p;}}); if(closest&&cd<400) e.thiefTarget=closest; else e.thiefTarget=null; } if(e.thiefTarget && NS.powerups.includes(e.thiefTarget)) { const a=NS.angle(e.x,e.y,e.thiefTarget.x,e.thiefTarget.y); e.x+=Math.cos(a)*spd*1.3*dt; e.y+=Math.sin(a)*spd*1.3*dt; if(NS.dist(e.x,e.y,e.thiefTarget.x,e.thiefTarget.y)<20) { const idx=NS.powerups.indexOf(e.thiefTarget); if(idx>=0){NS.powerups.splice(idx,1); e.thiefTarget=null; NS.Audio.play('steal');} } } else { const a=NS.angle(e.x,e.y,NS.player.x,NS.player.y); e.x+=Math.cos(a)*spd*0.5*dt; e.y+=Math.sin(a)*spd*0.5*dt; } } break;
      }
      if (e.fr > 0 && e.done) { e.ft -= dt; if (e.ft <= 0) { const a = NS.angle(e.x,e.y,NS.player.x,NS.player.y); NS.eFire(e.x, e.y+e.w*0.5, a, 200*frzM, e.col); if (e.type === 'tank') { NS.eFire(e.x, e.y+e.w*0.5, a-0.3, 180*frzM, '#ff6688'); NS.eFire(e.x, e.y+e.w*0.5, a+0.3, 180*frzM, '#ff6688'); } e.ft = e.fr; } }
      if (e.y > NS.H+60 || e.x < -60 || e.x > NS.W+60) NS.enemies.splice(i,1);
    }
  };
  NS.renderEnemies = function() {
    const ctx = NS.ctx;
    NS.enemies.forEach(e => { ctx.save(); ctx.translate(e.x,e.y); const alpha = e.cloak?0.15:1; ctx.globalAlpha = alpha;
      if (NS.gameState.quality.shadows) { ctx.shadowColor = e.col; ctx.shadowBlur = 12; } ctx.fillStyle = '#1a0808'; ctx.strokeStyle = e.col; ctx.lineWidth = 2; const s = e.w; ctx.beginPath();
      switch(e.type) {
        case 'drone': ctx.moveTo(0,-s); ctx.lineTo(s,0); ctx.lineTo(0,s); ctx.lineTo(-s,0); break;
        case 'hunter': ctx.moveTo(0,-s); ctx.lineTo(s*.7,0); ctx.lineTo(s,s*.5); ctx.lineTo(0,s*.3); ctx.lineTo(-s,s*.5); ctx.lineTo(-s*.7,0); break;
        case 'shooter': ctx.arc(0,0,s,0,NS.TAU); break;
        case 'tank': for(let j=0;j<6;j++){const ang=(j/6)*NS.TAU-Math.PI/2; j===0?ctx.moveTo(Math.cos(ang)*s,Math.sin(ang)*s):ctx.lineTo(Math.cos(ang)*s,Math.sin(ang)*s);} break;
        case 'speeder': ctx.moveTo(0,-s*1.2); ctx.lineTo(s*.6,s*.5); ctx.lineTo(0,s*.2); ctx.lineTo(-s*.6,s*.5); break;
        case 'shielder': ctx.arc(0,0,s,0,NS.TAU); break;
        case 'elite': for(let j=0;j<5;j++){const ang=(j/5)*NS.TAU-Math.PI/2;const ox=Math.cos(ang)*s,oy=Math.sin(ang)*s,ia=ang+.314; j===0?ctx.moveTo(ox,oy):ctx.lineTo(ox,oy); ctx.lineTo(Math.cos(ia)*s*.5,Math.sin(ia)*s*.5);} break;
        case 'splitter': for(let j=0;j<3;j++){const ang=(j/3)*NS.TAU-Math.PI/2; j===0?ctx.moveTo(Math.cos(ang)*s,Math.sin(ang)*s):ctx.lineTo(Math.cos(ang)*s,Math.sin(ang)*s);} break;
        case 'cloaker': ctx.arc(0,0,s,0,NS.TAU); break;
        case 'kamikaze': ctx.moveTo(0,-s); ctx.lineTo(s*.5,s*.5); ctx.lineTo(0,s*.3); ctx.lineTo(-s*.5,s*.5); break;
        case 'thief': ctx.moveTo(0,-s); ctx.lineTo(s*.8,s*.3); ctx.lineTo(s*.3,s*.8); ctx.lineTo(0,s*.3); ctx.lineTo(-s*.3,s*.8); ctx.lineTo(-s*.8,s*.3); break;
        case 'exploder': ctx.arc(0,0,s*1.2,0,NS.TAU); break;
      } ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = e.col; ctx.globalAlpha = alpha*0.6; ctx.beginPath(); ctx.arc(0,0,s*0.25,0,NS.TAU); ctx.fill(); ctx.globalAlpha = alpha;
      if (e.type==='shielder' && e.done) { ctx.strokeStyle='#4488ff'; ctx.globalAlpha=0.3+0.15*Math.sin(e.ph*2); ctx.lineWidth=1; ctx.beginPath(); ctx.arc(0,0,s*2,0,NS.TAU); ctx.stroke(); } ctx.globalAlpha=alpha;
      if (e.hp < e.maxHp) { const bw=s*2,bh=3; ctx.fillStyle='#300'; ctx.fillRect(-bw/2,-s-10,bw,bh); ctx.fillStyle=e.col; ctx.fillRect(-bw/2,-s-10,bw*(e.hp/e.maxHp),bh); }
      ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.restore();
    });
  };

  /* ---------- ENTITIES: BOSS ---------- */
  NS.createBoss = function() { const l=Math.floor(NS.wave/5); return { x:NS.W/2,y:-90,tgtY:100+l*10,w:55+l*10,h:45+l*10,hp:500+l*300,maxHp:500+l*300,ph:0,at:2.5,ap:0,entered:false,score:1000+l*500,level:l,phase:0,col:'#ff0066',minionTimer:3,laserTimer:0,laserOn:false }; };
  NS.updateBoss = function(dt) {
    if (!NS.boss || NS.gameState.state !== 'playing') return;
    if (!NS.boss.entered) { NS.boss.y += NS.CFG.BOSS_ENTRY_SPEED*dt; if (NS.boss.y >= NS.boss.tgtY) NS.boss.entered = true; return; }
    const hpP = NS.boss.hp/NS.boss.maxHp;
    if (hpP <= 0.25 && NS.boss.phase < 2) { NS.boss.phase=2; NS.boss.at=0.5; NS.spawnText(NS.boss.x, NS.boss.y-NS.boss.h-20, NS.t('rage'), '#ff0000'); }
    else if (hpP <= 0.5 && NS.boss.phase < 1) { NS.boss.phase=1; NS.boss.at=1; NS.spawnText(NS.boss.x, NS.boss.y-NS.boss.h-20, NS.t('enhanced'), '#ffd700'); }
    NS.boss.ph += dt; NS.boss.x = NS.W/2 + Math.sin(NS.boss.ph*(NS.boss.phase===2?1.2:0.7))*(NS.W*0.3);
    NS.boss.minionTimer -= dt; if (NS.boss.minionTimer <= 0 && NS.boss.entered) { NS.spawnBossMinion(); NS.boss.minionTimer = NS.boss.phase>=2?2:4; }
    if (NS.boss.phase >= 2) { NS.boss.laserTimer += dt; if (NS.boss.laserTimer > 2.5) { NS.boss.laserOn = !NS.boss.laserOn; NS.boss.laserTimer = 0; if (NS.boss.laserOn) NS.Audio.play('boss'); } }
    NS.boss.at -= dt;
    if (NS.boss.at <= 0) {
      NS.boss.ap = (NS.boss.ap+1)%3; const lvl = NS.boss.level + NS.boss.phase;
      switch(NS.boss.ap) {
        case 0: { const n=12+lvl*3; for(let i=0;i<n;i++){const a=(i/n)*NS.TAU+NS.boss.ph*0.5; NS.eFire(NS.boss.x,NS.boss.y+NS.boss.h/2,a,150+NS.boss.phase*30,'#ffd700');} NS.boss.at=NS.boss.phase>=2?1.2:1.8; } break;
        case 1: for(let i=0;i<3+lvl;i++){ const a=NS.angle(NS.boss.x,NS.boss.y,NS.player.x,NS.player.y)+NS.rand(-0.3,0.3); NS.eFire(NS.boss.x,NS.boss.y+NS.boss.h/2,a,250+NS.boss.phase*40,'#ff2d95'); } NS.boss.at=NS.boss.phase>=2?0.3:0.5; break;
        case 2: { const n=8+NS.boss.phase*4; for(let i=0;i<n;i++){const a=NS.boss.ph*3+(i/n)*NS.TAU; NS.eFire(NS.boss.x,NS.boss.y+NS.boss.h/2,a,120+NS.boss.phase*20,'#ff4488');} NS.boss.at=NS.boss.phase>=2?1:1.8; } break;
      }
    }
  };
  NS.spawnBossMinion = function() { if (NS.enemies.length < NS.gameState.quality.maxEnemies-2) NS.spawnEnemy('kamikaze', NS.boss.x+NS.rand(-50,50), NS.boss.y+NS.rand(-30,30)); };
  NS.renderBoss = function() {
    if (!NS.boss) return; const ctx=NS.ctx; ctx.save(); ctx.translate(NS.boss.x,NS.boss.y);
    if (NS.gameState.quality.shadows) { ctx.shadowColor=NS.boss.col; ctx.shadowBlur=20; }
    const w=NS.boss.w,h=NS.boss.h; ctx.fillStyle='#1a0020'; ctx.strokeStyle=NS.boss.col; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(0,-h); ctx.lineTo(w,-h*.3); ctx.lineTo(w*1.2,h*.5); ctx.lineTo(w*.6,h); ctx.lineTo(0,h*.7); ctx.lineTo(-w*.6,h); ctx.lineTo(-w*1.2,h*.5); ctx.lineTo(-w,-h*.3); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle=NS.boss.col; ctx.globalAlpha=0.3; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,-h*.6); ctx.lineTo(w*.5,-h*.1); ctx.lineTo(0,h*.4); ctx.lineTo(-w*.5,-h*.1); ctx.closePath(); ctx.stroke(); ctx.globalAlpha=1;
    ctx.fillStyle='#ffd700'; if(NS.gameState.quality.shadows)ctx.shadowColor='#ffd700'; ctx.beginPath(); ctx.arc(-w*.3,-h*.15,5,0,NS.TAU); ctx.fill(); ctx.beginPath(); ctx.arc(w*.3,-h*.15,5,0,NS.TAU); ctx.fill();
    ctx.fillStyle=NS.boss.col; ctx.globalAlpha=0.4+0.3*Math.sin(NS.boss.ph*5); ctx.beginPath(); ctx.arc(0,h*.1,7,0,NS.TAU); ctx.fill(); ctx.globalAlpha=1; ctx.shadowBlur=0; ctx.restore();
    if (NS.boss.entered) { ctx.save(); const bw=NS.W*.5,bh=8,bx=(NS.W-bw)/2,by=25; ctx.fillStyle='#1a0010'; ctx.fillRect(bx,by,bw,bh); ctx.strokeStyle=NS.boss.col; ctx.lineWidth=1; ctx.strokeRect(bx,by,bw,bh); const pct=NS.boss.hp/NS.boss.maxHp,hc=pct>.5?NS.boss.col:pct>.25?'#ffd700':'#ff4444'; ctx.fillStyle=hc; if(NS.gameState.quality.shadows){ctx.shadowColor=hc;ctx.shadowBlur=8;} ctx.fillRect(bx,by,bw*pct,bh); ctx.shadowBlur=0; ctx.font='700 12px Orbitron,monospace'; ctx.fillStyle=NS.boss.col; ctx.textAlign='center'; const pn=[NS.t('guard'),NS.t('enhanced'),NS.t('rage')]; ctx.fillText(`${NS.t('destroyer')} MK.${NS.boss.level+1} — ${pn[NS.boss.phase]}`,NS.W/2,by-5); ctx.restore(); }
    if (NS.boss.phase>=2 && NS.boss.laserOn) { ctx.save(); ctx.strokeStyle='#ff0000'; ctx.lineWidth=5; ctx.shadowBlur=15; ctx.shadowColor='#ff0000'; ctx.beginPath(); ctx.moveTo(NS.boss.x,NS.boss.y+NS.boss.h/2); ctx.lineTo(NS.boss.x,NS.H); ctx.stroke(); ctx.restore(); }
  };
  NS.damageBoss = function(amt) { if(NS.boss){NS.boss.hp-=amt; if(NS.boss.hp<=0)NS.defeatBoss();} };
  NS.defeatBoss = function() {
    if(!NS.boss)return; const bx=NS.boss.x,by=NS.boss.y,bc=NS.boss.col,bs=NS.boss.score; NS.bossDefeatTimers.forEach(clearTimeout); NS.bossDefeatTimers=[];
    for(let i=0;i<6;i++){const tid=setTimeout(()=>{if(NS.gameState.state!=='playing')return; NS.spawnExpl(bx+NS.rand(-40,40),by+NS.rand(-30,30),Math.random()>.5?bc:'#ffd700',NS.rand(2,4)); NS.Audio.play('expl'); NS.shake(6,0.15);},i*150); NS.bossDefeatTimers.push(tid);}
    const finalTid=setTimeout(()=>{NS.spawnExpl(bx,by,'#ffd700',5); NS.Audio.play('bomb'); NS.shake(12,0.4); NS.flashAlpha=NS.CFG.BOMB_FLASH_ALPHA;},900); NS.bossDefeatTimers.push(finalTid);
    NS.eBulletPool.releaseAll(); NS.score+=bs; NS.spawnText(bx,by,'+'+bs,'#ffd700'); NS.spawnPowerup(bx-30,by); NS.spawnPowerup(bx+30,by); NS.spawnPowerup(bx,by-20);
    NS.meta.stats.bossKills=(NS.meta.stats.bossKills||0)+1; NS.Store.set('meta',NS.meta); NS.boss=null; NS.checkAchievements(); NS.bossDefeatTimers=[];
  };

  /* ---------- ENTITIES: BULLETS ---------- */
  NS.playerFire = function() {
    if (!NS.player.alive || NS.gameState.state !== 'playing') return;
    const baseDmg = NS.player.dmg + (NS.combo>1?Math.floor(NS.combo*0.5):0) + (NS.combo>=20?10:0); NS.shotsFiredThisGame++;
    const synergy = (NS.powerupActive==='triple' && NS.combo>=15) || (NS.powerupActive==='speed' && NS.powerupActive==='triple');
    let spreads=[0]; if(NS.powerupActive==='triple')spreads=[-0.15,0,0.15]; if(synergy)spreads=[-0.3,-0.2,-0.1,0,0.1,0.2,0.3];
    spreads.forEach(a=>{ if(NS.pBulletPool.active.length<NS.CFG.MAX_PLAYER_BULLETS){ const b=NS.pBulletPool.get(); b.x=NS.player.x; b.y=NS.player.y-NS.player.h/2; b.vx=Math.sin(-Math.PI/2+a)*650; b.vy=-Math.cos(-Math.PI/2+a)*650; b.dmg=baseDmg; b.col=NS.combo>=20?'#ff4444':NS.currentWaveColor; b.sz=3; } });
    if (NS.meta.upgrades.drone>0) { for(let i=0;i<NS.meta.upgrades.drone;i++){ if(NS.pBulletPool.active.length<NS.CFG.MAX_PLAYER_BULLETS){ const b=NS.pBulletPool.get(); b.x=NS.player.x+NS.rand(-15,15); b.y=NS.player.y-NS.player.h/2-10; b.vx=NS.rand(-80,80); b.vy=-600; b.dmg=baseDmg*0.6; b.col='#88aaff'; b.sz=2; } } }
    NS.comboPitch = 1 + Math.min(NS.combo,20)*0.03; NS.Audio.play('shoot', NS.comboPitch);
  };
  NS.eFire = function(x,y,a,sp,col) { if(NS.eBulletPool.active.length<NS.CFG.ENEMY_BULLET_MAX){ const b=NS.eBulletPool.get(); b.x=x;b.y=y;b.vx=Math.cos(a)*sp;b.vy=Math.sin(a)*sp;b.col=col||'#ff2d95';b.sz=4; } };
  NS.updateBullets = function(dt) {
    if(NS.gameState.state!=='playing')return;
    NS.pBulletPool.forEach(b=>{b.x+=b.vx*dt;b.y+=b.vy*dt;if(b.y<-20||b.x<-20||b.x>NS.W+20)NS.pBulletPool.release(b);});
    NS.eBulletPool.forEach(b=>{b.x+=b.vx*dt;b.y+=b.vy*dt;if(b.y>NS.H+20||b.y<-20||b.x<-20||b.x>NS.W+20)NS.eBulletPool.release(b);});
  };
  NS.renderBullets = function() {
    if(!NS.pBulletPool.active.length&&!NS.eBulletPool.active.length)return; const ctx=NS.ctx; ctx.save(); if(NS.gameState.quality.shadows)ctx.shadowBlur=8;
    const pCol=NS.combo>=20?'#ff4444':NS.currentWaveColor; ctx.fillStyle=pCol; if(NS.gameState.quality.shadows)ctx.shadowColor=pCol;
    NS.pBulletPool.forEach(b=>{ctx.beginPath();ctx.arc(b.x,b.y,b.sz,0,NS.TAU);ctx.fill();});
    ctx.fillStyle='#ff2d95'; if(NS.gameState.quality.shadows)ctx.shadowColor='#ff2d95'; NS.eBulletPool.forEach(b=>{ctx.beginPath();ctx.arc(b.x,b.y,b.sz,0,NS.TAU);ctx.fill();});
    ctx.shadowBlur=0;ctx.restore();
  };

  /* ---------- ENTITIES: POWERUPS ---------- */
  NS.PU_TYPES = [
    {type:'triple',col:'#00e5ff',icon:'▲',name_ar:'ثلاثي',name_en:'Triple',dur:8},{type:'shield',col:'#0088ff',icon:'◆',name_ar:'درع',name_en:'Shield',dur:10},
    {type:'speed',col:'#ffd700',icon:'»',name_ar:'سرعة',name_en:'Speed',dur:8},{type:'rapid',col:'#00ff88',icon:'⚡',name_ar:'سريع',name_en:'Rapid',dur:6},
    {type:'heal',col:'#00ff88',icon:'+',name_ar:'شفاء',name_en:'Heal',dur:0},{type:'bomb_add',col:'#ff2d95',icon:'💣',name_ar:'قنبلة',name_en:'Bomb',dur:0},
    {type:'shield_up',col:'#0088ff',icon:'🛡',name_ar:'درع دائم',name_en:'Perm Shield',dur:0},{type:'freeze',col:'#88ccff',icon:'🧊',name_ar:'تجميد',name_en:'Freeze',dur:5},
    {type:'magnet',col:'#ffaa00',icon:'🧲',name_ar:'مغناطيس',name_en:'Magnet',dur:6}
  ];
  NS.spawnPowerup = function(x,y) { const t=NS.PU_TYPES[NS.randInt(0,NS.PU_TYPES.length-1)]; NS.powerups.push({x,y,vy:60,ph:NS.rand(0,NS.TAU),sz:14,...t}); };
  NS.updatePowerups = function(dt) {
    if(NS.gameState.state!=='playing')return;
    for(let i=NS.powerups.length-1;i>=0;i--){ const p=NS.powerups[i]; p.y+=p.vy*dt; p.ph+=dt*3; if(NS.dist(p.x,p.y,NS.player.x,NS.player.y)<p.sz+22){ NS.applyPowerup(p); NS.powerups.splice(i,1); continue; } if(p.y>NS.H+30)NS.powerups.splice(i,1); }
  };
  NS.applyPowerup = function(pu) {
    switch(pu.type) {
      case 'triple': case 'speed': case 'rapid': case 'freeze': NS.powerupActive=pu.type; NS.powerupTimer=(pu.type===NS.powerupActive)?Math.max(NS.powerupTimer,pu.dur):pu.dur; break;
      case 'shield': NS.shield=NS.shieldMax=50; break; case 'heal': NS.healPlayer(30); break; case 'bomb_add': NS.bombs++; break; case 'shield_up': NS.shield=NS.shieldMax=40; break;
      case 'magnet': NS.coinPickups.forEach(c=>{c.vy=-200;}); break;
    }
    NS.Audio.play('powerup'); NS.Audio.vibrate(30); NS.spawnText(pu.x,pu.y,(NS.currentLang==='ar'?pu.name_ar:pu.name_en),pu.col);
  };
  NS.renderPowerups = function() { const ctx=NS.ctx; NS.powerups.forEach(pu=>{ ctx.save();ctx.translate(pu.x,pu.y); if(NS.gameState.quality.shadows){ctx.shadowColor=pu.col;ctx.shadowBlur=16;} ctx.rotate(pu.ph); ctx.strokeStyle=pu.col;ctx.lineWidth=1.5;ctx.globalAlpha=0.4;ctx.strokeRect(-pu.sz,-pu.sz,pu.sz*2,pu.sz*2); ctx.globalAlpha=1;ctx.rotate(-pu.ph); ctx.fillStyle=pu.col;ctx.font='700 16px Orbitron,monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(pu.icon,0,0);ctx.shadowBlur=0;ctx.restore(); }); };

  /* ---------- BOMB ---------- */
  NS.useBomb = function() {
    if(NS.gameState.state!=='playing')return; NS.bombs--; NS.bombUsedThisWave=true; NS.Audio.play('bomb'); NS.Audio.vibrate([100,50,100,50,200]); NS.shake(15,0.5); NS.flashAlpha=NS.CFG.BOMB_FLASH_ALPHA; let bombKills=0;
    for(let i=NS.enemies.length-1;i>=0;i--){ const e=NS.enemies[i],dmg=Math.max(0.3,1-NS.dist(e.x,e.y,NS.player.x,NS.player.y)/(NS.W*0.5)); e.hp-=100*dmg; if(e.hp<=0){ NS.spawnExpl(e.x,e.y,e.col,2); NS.score+=e.score; NS.kills++; bombKills++; NS.spawnText(e.x,e.y,'+'+e.score,'#ff2d95'); NS.enemies.splice(i,1); } }
    NS.eBulletPool.releaseAll(); NS.spawnRing(NS.player.x,NS.player.y,'#ff2d95',Math.max(NS.W,NS.H)); if(bombKills>=5){ NS.meta.stats.bombKillsMax=Math.max(NS.meta.stats.bombKillsMax||0,bombKills); NS.Store.set('meta',NS.meta); } NS.killsSinceLastPU=0; NS.checkAchievements();
  };

  /* ---------- COLLISION ---------- */
  NS.checkCollisions = function(dt) {
    if(NS.gameState.state!=='playing')return; NS.hitSoundCooldown -= dt;
    NS.pBulletPool.forEach(b=>{ let hit=false; for(let j=NS.enemies.length-1;j>=0;j--){ const e=NS.enemies[j]; if(NS.dist(b.x,b.y,e.x,e.y)<e.w+b.sz){ e.hp-=b.dmg; hit=true; NS.shotsHitThisGame++; if(NS.hitSoundCooldown<=0){NS.Audio.play('hit',NS.comboPitch);NS.hitSoundCooldown=0.05;} NS.spawnParts(b.x,b.y,e.col,3,80,0.15,2); if(e.hp<=0)NS.killEnemy(j); break; } }
      if(!hit&&NS.boss&&NS.boss.entered&&NS.dist(b.x,b.y,NS.boss.x,NS.boss.y)<NS.boss.w+10){ NS.damageBoss(b.dmg); hit=true; NS.shotsHitThisGame++; NS.Audio.play('hit'); NS.spawnParts(b.x,b.y,NS.boss.col,3,80,0.15,2); } if(hit)NS.pBulletPool.release(b); });
    if(NS.player.alive&&NS.player.invTimer<=0){ NS.eBulletPool.forEach(b=>{ if(NS.dist(b.x,b.y,NS.player.x,NS.player.y)<18){NS.eBulletPool.release(b);NS.damagePlayer(15);if(!NS.player.alive)return;} });
      for(let j=NS.enemies.length-1;j>=0;j--){ const e=NS.enemies[j]; if(NS.dist(e.x,e.y,NS.player.x,NS.player.y)<e.w+15){NS.damagePlayer(20);e.hp-=50;if(e.hp<=0)NS.killEnemy(j);if(!NS.player.alive)return;} } }
    for(let i=NS.enemies.length-1;i>=0;i--){ const e=NS.enemies[i]; if(e.type==='kamikaze'&&e.done&&NS.dist(e.x,e.y,NS.player.x,NS.player.y)<40){NS.spawnExpl(e.x,e.y,'#ff8800',3);NS.Audio.play('expl');NS.shake(8,0.2);if(NS.player.alive)NS.damagePlayer(30);NS.enemies.splice(i,1);} }
  };
  NS.killEnemy = function(idx) {
    const e=NS.enemies[idx]; NS.spawnExpl(e.x,e.y,e.col,2); NS.Audio.play('expl'); NS.shake(3,0.1); if(e.explode)NS.chainExplosion(e);
    NS.combo++; NS.comboTimer=NS.CFG.COMBO_DURATION; NS.maxCombo=Math.max(NS.maxCombo,NS.combo); NS.meta.stats.maxCombo=Math.max(NS.meta.stats.maxCombo||0,NS.maxCombo);
    const m=Math.min(NS.combo,10); const pts=e.score*m*NS.CFG.DIFFICULTY[NS.gameState.difficulty].scMult; NS.score+=pts; NS.kills++; NS.waveKills++;
    const coinVal=Math.floor(e.score*0.1); if(NS.coinPickups.length<NS.CFG.MAX_COIN_PICKUPS)NS.coinPickups.push({x:e.x,y:e.y,val:coinVal});
    NS.spawnText(e.x,e.y,'+'+pts,m>1?'#ffd700':'#e0e0ff'); if(m>1)NS.spawnText(e.x,e.y-18,'x'+m,'#00e5ff');
    NS.killsSinceLastPU++; if(NS.killsSinceLastPU>=NS.CFG.POWERUP_GUARANTEE_KILLS){NS.spawnPowerup(e.x,e.y);NS.killsSinceLastPU=0;} else if(Math.random()<0.15)NS.spawnPowerup(e.x,e.y);
    if(e.split&&NS.wave>2&&NS.enemies.length<NS.gameState.quality.maxEnemies-2){NS.Audio.play('split');NS.spawnEnemy('drone',e.x-15,e.y);NS.spawnEnemy('drone',e.x+15,e.y);}
    if(e.type==='speeder'){for(let i=0;i<4;i++){const a=(i/4)*NS.TAU;NS.eFire(e.x,e.y,a,120,'#ffff00');}}
    NS.enemies.splice(idx,1); const hi=NS.Store.get('hiScore',0); if(NS.score>hi){NS.Store.set('hiScore',NS.score);NS.meta.stats.bestScore=NS.score;} NS.Store.set('meta',NS.meta); NS.checkAchievements();
  };
  NS.chainExplosion = function(e) { for(let i=NS.enemies.length-1;i>=0;i--){const oe=NS.enemies[i]; if(NS.dist(e.x,e.y,oe.x,oe.y)<e.w*3){oe.hp-=40; if(oe.hp<=0){NS.spawnExpl(oe.x,oe.y,oe.col,1);NS.score+=oe.score;NS.kills++;NS.enemies.splice(i,1);}}} };

  /* ---------- WAVE MANAGEMENT ---------- */
  NS.waveEnemyCount = (w) => Math.floor(4 + w*2 + Math.log2(Math.max(1,w))*3);
  NS.waveTypes = function(w) { const t=['drone']; if(w>=2)t.push('drone','hunter'); if(w>=3)t.push('shooter'); if(w>=4)t.push('tank'); if(w>=5)t.push('speeder'); if(w>=6)t.push('shielder'); if(w>=7)t.push('splitter'); if(w>=8)t.push('elite'); if(w>=9)t.push('cloaker'); if(w>=10)t.push('kamikaze','thief','exploder'); if(NS.gameState.gameMode==='survival'&&w>=15)t.push('elite','elite','kamikaze'); return t; };
  NS.spawnInterval = (w) => NS.gameState.gameMode==='survival'?Math.max(0.1,0.7-w*0.03):Math.max(0.15,0.7-w*0.02);
  NS.startWave = function() { NS.wave++; NS.waveDamageTaken=false; NS.bombUsedThisWave=false; NS.waveDone=false; NS.waveDelay=0; NS.currentWaveColor=NS.CFG.WAVE_COLORS[Math.floor((NS.wave-1)/5)%NS.CFG.WAVE_COLORS.length]; if(NS.gameState.gameMode==='boss'){NS.startBossWave();return;} if(NS.wave%5===0){NS.boss=NS.createBoss();NS.Audio.play('boss');NS.showWA(NS.t('bossWarn'),(NS.currentLang==='ar'?`الزعيم — الموجة ${NS.wave}`:`Boss — Wave ${NS.wave}`),true);return;} NS.showWA(`${NS.t('wave')} ${NS.wave}`,NS.getWaveDesc(),false); const cnt=NS.waveEnemyCount(NS.wave),types=NS.waveTypes(NS.wave); NS.waveQueue=[]; for(let i=0;i<cnt;i++)NS.waveQueue.push(types[NS.randInt(0,types.length-1)]); NS.waveSpawnTimer=0; };
  NS.startBossWave = function() { NS.boss=NS.createBoss(); NS.Audio.play('boss'); NS.showWA(`${NS.t('boss')} ${Math.floor(NS.wave/5)}`,`MK.${Math.floor(NS.wave/5)}`,true); NS.waveQueue=[]; NS.waveSpawnTimer=0; };
  NS.getWaveDesc = function() { const descs_ar=['استعد!','هم قادمون!','اصمد!','الأمر يصعب!','أنت البطل!']; const descs_en=['Get Ready!','They\'re Coming!','Hold On!','It Gets Tough!','You\'re The Hero!']; return NS.currentLang==='ar'?descs_ar[NS.wave%5]:descs_en[NS.wave%5]; };
  NS.showWA = function(txt,s,w) { const el=document.getElementById('wave-announce'); document.getElementById('wa-title').textContent=txt; document.getElementById('wa-sub').textContent=s; el.classList.toggle('warning',w); el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2500); };
  NS.updateWaveSpawning = function(dt) { if(NS.gameState.state!=='playing'||NS.waveQueue.length===0)return; if(NS.enemies.length>=NS.gameState.quality.maxEnemies)return; NS.waveSpawnTimer-=dt; if(NS.waveSpawnTimer<=0){NS.spawnEnemy(NS.waveQueue.shift());NS.waveSpawnTimer=NS.spawnInterval(NS.wave);} };
  NS.checkWaveComplete = function(dt) { if(NS.waveDone){NS.waveDelay-=dt;if(NS.waveDelay<=0)NS.startWave();return;} if(NS.boss||NS.enemies.length>0||NS.waveQueue.length>0)return; if(!NS.waveDamageTaken){NS.perfectWavesThisGame++;NS.meta.stats.perfectWaves=(NS.meta.stats.perfectWaves||0)+1;NS.score+=NS.wave*50;NS.spawnText(NS.W/2,NS.H/2,(NS.currentLang==='ar'?'مثالية! +':'Perfect! +')+NS.wave*50,'#ffd700');} if(!NS.bombUsedThisWave){const dc=NS.getDailyChallenge();if(dc&&dc.type==='nobomb')NS.Store.set('dm_nobomb2',(NS.Store.get('dm_nobomb2',0)||0)+1);} NS.score+=NS.wave*20; NS.waveDone=true; NS.waveDelay=2.5; if(NS.perfectWavesThisGame>=3&&NS.gameState.difficulty!=='hard'){NS.gameState.difficulty='hard';NS.UI.notify(NS.t('diffRaised'),'cyan',2000);} NS.Store.set('meta',NS.meta); };

  /* ---------- EFFECTS ---------- */
  NS.shake = (p,d) => { p=Math.min(p,18); NS.shPower=Math.max(NS.shPower,p); NS.shDuration=Math.max(NS.shDuration,d); };
  NS.updateEffects = function(dt) {
    if(NS.gameState.state!=='playing')return; if(NS.slowMoActive){NS.slowMoTimer-=dt;if(NS.slowMoTimer<=0)NS.slowMoActive=false;}
    if(NS.shDuration>0){NS.shDuration-=dt;NS.shX=(Math.random()*2-1)*NS.shPower;NS.shY=(Math.random()*2-1)*NS.shPower;NS.shPower*=NS.CFG.SHAKE_DECAY;} else{NS.shX=0;NS.shY=0;}
    if(NS.flashAlpha>0)NS.flashAlpha-=dt*2;
    if(NS.player&&NS.player.alive&&NS.player.hp<=NS.player.maxHp*0.25){NS.flowAlpha=Math.max(NS.flowAlpha,Math.sin(NS.gameTime*6)*0.05);if(Math.random()<0.02)NS.Audio.play('heartbeat');} else NS.flowAlpha=Math.max(0,NS.flowAlpha-dt*2);
    const hi=NS.Store.get('hiScore',0); if(NS.score>hi&&!NS.hiScoreNotified){NS.hiScoreNotified=true;NS.UI.notify(NS.t('newHi'),'gold',2000);}
    if(NS.combo>NS.maxCombo&&!NS.hiComboNotified&&NS.combo>=5){NS.hiComboNotified=true;NS.UI.notify((NS.t('newCombo')||'New Combo')+': x'+NS.combo,'cyan',1500);}
  };

  /* ---------- PARTICLES ---------- */
  NS.spawnParts = function(x,y,col,n,spd,life,sz) { for(let i=0;i<n;i++){ if(NS.particlePool.active.length>=NS.gameState.quality.particles)NS.particlePool.release(NS.particlePool.active[0]); const p=NS.particlePool.get(); const a=NS.rand(0,NS.TAU),s=NS.rand(spd*0.3,spd); p.x=x;p.y=y;p.vx=Math.cos(a)*s;p.vy=Math.sin(a)*s;p.life=NS.rand(life*0.5,life);p.maxLife=life;p.col=col;p.sz=NS.rand(sz*0.5,sz); } };
  NS.spawnExpl = function(x,y,col,sz) { NS.spawnParts(x,y,col,sz*8,sz*120,0.4,sz*2); NS.spawnParts(x,y,'#ffffff',sz*3,sz*50,0.2,sz*3); NS.spawnRing(x,y,col,sz*45); };
  NS.spawnRing = function(x,y,col,maxR) { if(NS.ringPool.active.length<40){ const r=NS.ringPool.get(); r.x=x;r.y=y;r.r=5;r.maxR=maxR;r.life=0.4;r.maxLife=0.4;r.col=col; } };
  NS.spawnText = function(x,y,txt,col) { if(NS.floatTextPool.active.length>=NS.CFG.MAX_FLOATING_TEXTS)NS.floatTextPool.release(NS.floatTextPool.active[0]); const t=NS.floatTextPool.get(); t.x=x;t.y=y;t.txt=txt;t.col=col;t.life=0.9;t.maxLife=0.9; };
  NS.updateParticles = function(dt) { NS.particlePool.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=0.97;p.vy*=0.97;p.life-=dt;if(p.life<=0)NS.particlePool.release(p);}); while(NS.particlePool.active.length>NS.gameState.quality.particles)NS.particlePool.release(NS.particlePool.active[0]); NS.ringPool.forEach(r=>{r.life-=dt;r.r=NS.lerp(5,r.maxR,1-r.life/r.maxLife);if(r.life<=0)NS.ringPool.release(r);}); NS.floatTextPool.forEach(t=>{t.y-=50*dt;t.life-=dt;if(t.life<=0)NS.floatTextPool.release(t);}); };
  NS.renderParticles = function() { if(!NS.particlePool.active.length&&!NS.ringPool.active.length&&!NS.floatTextPool.active.length)return; const ctx=NS.ctx; ctx.save();ctx.globalCompositeOperation='lighter'; if(NS.gameState.quality.shadows)ctx.shadowBlur=6; NS.particlePool.forEach(p=>{const al=p.life/p.maxLife;ctx.globalAlpha=al;ctx.fillStyle=p.col;if(NS.gameState.quality.shadows)ctx.shadowColor=p.col;ctx.beginPath();ctx.arc(p.x,p.y,p.sz*al,0,NS.TAU);ctx.fill();}); ctx.globalAlpha=1;ctx.shadowBlur=0;ctx.restore(); ctx.save();ctx.globalCompositeOperation='lighter'; if(NS.gameState.quality.shadows)ctx.shadowBlur=10; NS.ringPool.forEach(r=>{ctx.strokeStyle=r.col;ctx.globalAlpha=(r.life/r.maxLife)*0.5;ctx.lineWidth=2;if(NS.gameState.quality.shadows)ctx.shadowColor=r.col;ctx.beginPath();ctx.arc(r.x,r.y,r.r,0,NS.TAU);ctx.stroke();}); ctx.globalAlpha=1;ctx.shadowBlur=0;ctx.restore(); ctx.save();ctx.textAlign='center';ctx.textBaseline='middle'; NS.floatTextPool.forEach(t=>{const al=t.life/t.maxLife,sc=0.8+(1-al)*0.3;ctx.globalAlpha=al;ctx.fillStyle=t.col;ctx.font=`700 ${Math.round(14*sc)}px Orbitron,monospace`;ctx.fillText(t.txt,t.x,t.y);}); ctx.globalAlpha=1;ctx.restore(); };

  /* ---------- STARFIELD ---------- */
  NS.stars = [[],[],[]]; NS.nebulae = [];
  NS.initStars = function() { const cnt=NS.gameState.quality.shadows?[80,50,30]:[40,25,15]; const spd=[30,60,100],sz=[[0.5,1.5],[1,2.5],[1.5,3.5]]; for(let l=0;l<3;l++){NS.stars[l]=[]; for(let i=0;i<cnt[l];i++)NS.stars[l].push({x:NS.rand(0,NS.W),y:NS.rand(0,NS.H),sz:NS.rand(sz[l][0],sz[l][1]),br:NS.rand(0.3,1),tw:NS.rand(0,NS.TAU),twSpd:NS.rand(1,4),spd:spd[l]});} NS.nebulae.length=0; const nc=['#0a0030','#1a0020','#001a2e','#0a1a00','#1e0500']; for(let i=0;i<(NS.gameState.quality.shadows?4:2);i++)NS.nebulae.push({x:NS.rand(0,NS.W),y:NS.rand(0,NS.H),r:NS.rand(200,450),col:nc[i],spd:NS.rand(5,12),ph:NS.rand(0,NS.TAU)}); };
  NS.updateStars = function(dt) { NS.stars.forEach(l=>l.forEach(s=>{s.y+=s.spd*dt;s.tw+=s.twSpd*dt;if(s.y>NS.H+10){s.y=-10;s.x=NS.rand(0,NS.W);}})); NS.nebulae.forEach(n=>{n.y+=n.spd*dt;n.ph+=dt*0.3;if(n.y>NS.H+n.r){n.y=-n.r;n.x=NS.rand(0,NS.W);}}); };
  NS.renderStars = function() { const ctx=NS.ctx; NS.nebulae.forEach(n=>{const r=n.r+Math.sin(n.ph)*30;const g=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,r);g.addColorStop(0,n.col+(NS.gameState.nightMode?'30':'50'));g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(n.x-r,n.y-r,r*2,r*2);}); if(NS.gameState.quality.shadows)ctx.shadowBlur=3; NS.stars.forEach(l=>l.forEach(s=>{ctx.globalAlpha=s.br*(0.5+0.5*Math.sin(s.tw));ctx.fillStyle='#aabbdd';if(NS.gameState.quality.shadows)ctx.shadowColor='#aabbdd';ctx.beginPath();ctx.arc(s.x,s.y,s.sz,0,NS.TAU);ctx.fill();})); ctx.globalAlpha=1;ctx.shadowBlur=0; ctx.globalAlpha=0.02;ctx.fillStyle='#000';for(let y=0;y<NS.H;y+=3)ctx.fillRect(0,y,NS.W,1);ctx.globalAlpha=1; const vg=ctx.createRadialGradient(NS.W/2,NS.H/2,NS.W*0.25,NS.W/2,NS.H/2,NS.W*0.8);vg.addColorStop(0,'transparent');vg.addColorStop(1,'rgba(0,0,0,'+(NS.gameState.nightMode?'0.7':'0.5')+')');ctx.fillStyle=vg;ctx.fillRect(0,0,NS.W,NS.H); };

  /* ---------- UI ---------- */
  NS.UI = {
    show(id) { const el=document.getElementById(id); if(el){el.classList.remove('hidden');if(id.includes('panel')||id==='pause-panel')document.body.style.overflow='hidden';} },
    hide(id) { const el=document.getElementById(id); if(el){el.classList.add('hidden');const panels=document.querySelectorAll('.panel:not(.hidden)');if(!panels.length||(panels.length===1&&panels[0].id===id))document.body.style.overflow='';} },
    toggle(id,force) { const el=document.getElementById(id);if(!el)return false;const on=force!==undefined?force:!el.classList.contains('on');el.classList.toggle('on',on);el.setAttribute('aria-checked',on);return on; },
    text(id,v) { const el=document.getElementById(id);if(el)el.textContent=v; },
    notify(txt,cls,dur) { const el=document.getElementById('notif');if(!el)return;el.textContent=txt;el.className='notif show '+(cls||'cyan');setTimeout(()=>el.classList.remove('show'),dur||1500); },
    updateLang() { document.documentElement.lang=NS.currentLang;document.documentElement.dir=NS.currentLang==='ar'?'rtl':'ltr';document.getElementById('lang-toggle').textContent=NS.currentLang==='ar'?'English':'العربية';document.getElementById('mm-sub').textContent=NS.currentLang==='ar'?'عاصفة النيون':'Neon Storm'; }
  };

  /* ---------- MENU ---------- */
  NS.updateMenuInfo = function() {
    NS.UI.text('mm-xp',(NS.currentLang==='ar'?'المستوى ':'Level ')+NS.meta.level+' — '+NS.meta.xp+'/'+NS.xpForLevel(NS.meta.level)+' XP — '+NS.getTitle());
    document.getElementById('xp-bar-fill').style.width=(NS.meta.xp/NS.xpForLevel(NS.meta.level)*100)+'%';
    const dc=NS.getDailyChallenge(); if(dc){const progress=NS.Store.get('dm_'+dc.id,0); NS.UI.text('mm-daily',(NS.currentLang==='ar'?'تحدّي اليوم: ':'Daily Challenge: ')+(NS.currentLang==='ar'?dc.desc_ar:dc.desc_en)+` (${progress}/${dc.target})`);}
    const mm=document.getElementById('mm-missions'); mm.innerHTML=''; NS.DAILY_MISSIONS.forEach(dm=>{const p=NS.Store.get('dm_'+dm.id,0);const done=p>=dm.target;mm.innerHTML+=(done?'✅ ':'⏳ ')+(NS.currentLang==='ar'?dm.desc_ar:dm.desc_en)+` (${p}/${dm.target}) `+(done?(NS.currentLang==='ar'?'- مكافأة: ':'- Reward: ')+dm.reward+'🪙':'')+'<br>';});
    document.getElementById('mm-streak').textContent=(NS.currentLang==='ar'?'🔥 سلسلة الدخول: ':'🔥 Login Streak: ')+(NS.meta.loginStreak||1)+' '+(NS.currentLang==='ar'?'يوم':'days');
  };

  /* ---------- SHOP ---------- */
  NS.SHOP_ITEMS = [
    {key:'dmg',name_ar:'تعزيز الضرر',name_en:'Damage Boost',desc_ar:'زيادة ضرر الطلقات',desc_en:'Increase bullet damage',icon:'⚔️',max:10,base:50,inc:30},
    {key:'hp',name_ar:'تعزيز الصحة',name_en:'HP Boost',desc_ar:'زيادة الحد الأقصى للصحة',desc_en:'Increase max health',icon:'❤️',max:10,base:40,inc:25},
    {key:'spd',name_ar:'تعزيز السرعة',name_en:'Speed Boost',desc_ar:'زيادة سرعة الحركة',desc_en:'Increase movement speed',icon:'⚡',max:5,base:60,inc:40},
    {key:'fr',name_ar:'سرعة الإطلاق',name_en:'Fire Rate',desc_ar:'زيادة معدل النار',desc_en:'Increase fire rate',icon:'🔥',max:8,base:45,inc:35},
    {key:'bombs',name_ar:'قنابل إضافية',name_en:'Extra Bombs',desc_ar:'ابدأ بقنابل أكثر',desc_en:'Start with more bombs',icon:'💣',max:5,base:30,inc:20},
    {key:'magnet',name_ar:'مغناطيس العملات',name_en:'Coin Magnet',desc_ar:'زيادة نطاق جذب العملات',desc_en:'Increase coin pickup range',icon:'🧲',max:8,base:35,inc:25},
    {key:'drone',name_ar:'طائرة دعم',name_en:'Companion Drone',desc_ar:'طائرة مساعدة تطلق النار',desc_en:'Companion that fires with you',icon:'🛸',max:3,base:100,inc:80}
  ];
  NS.renderShop = function() {
    NS.UI.text('shop-coins',NS.meta.coins); const c=document.getElementById('shop-items'); c.innerHTML='';
    NS.SHOP_ITEMS.forEach(it=>{ const lvl=NS.meta.upgrades[it.key]||0,cost=it.base+it.inc*lvl,mx=lvl>=it.max; const d=document.createElement('div'); d.className='shop-item'+(NS.meta.coins>=cost&&!mx?' affordable':'');
      const iconDiv=document.createElement('div');iconDiv.style.cssText='font-size:clamp(18px,3.5vw,26px)';iconDiv.textContent=it.icon;
      const infoDiv=document.createElement('div');infoDiv.className='shop-info';
      const nameDiv=document.createElement('div');nameDiv.className='name';nameDiv.textContent=(NS.currentLang==='ar'?it.name_ar:it.name_en); if(lvl>0){const span=document.createElement('span');span.style.color='#00e5ff';span.textContent=` (${lvl}/${it.max})`;nameDiv.appendChild(span);}
      const descDiv=document.createElement('div');descDiv.className='desc';descDiv.textContent=(NS.currentLang==='ar'?it.desc_ar:it.desc_en); infoDiv.appendChild(nameDiv);infoDiv.appendChild(descDiv);
      const rightDiv=document.createElement('div');rightDiv.style.textAlign='left';
      if(mx){const eq=document.createElement('span');eq.className='shop-equipped';eq.textContent='✅ '+(NS.currentLang==='ar'?'مفعّل':'Active');rightDiv.appendChild(eq);}
      else{const costDiv=document.createElement('div');costDiv.className='shop-cost';costDiv.textContent='🪙 '+cost; const btn=document.createElement('button');btn.className='shop-btn';btn.textContent=NS.currentLang==='ar'?'شراء':'Buy';btn.disabled=NS.meta.coins<cost;btn.addEventListener('click',(e)=>{e.stopPropagation();NS.buyShopItem(it.key);});rightDiv.appendChild(costDiv);rightDiv.appendChild(btn);}
      d.appendChild(iconDiv);d.appendChild(infoDiv);d.appendChild(rightDiv);c.appendChild(d);
    });
  };
  NS.buyShopItem = function(key) { const it=NS.SHOP_ITEMS.find(i=>i.key===key); if(!it)return; const lvl=NS.meta.upgrades[key]||0; if(lvl>=it.max)return; const cost=it.base+it.inc*lvl; if(NS.meta.coins<cost)return; NS.meta.coins-=cost; NS.meta.upgrades[key]=lvl+1; NS.meta.stats.totalCoins=(NS.meta.stats.totalCoins||0)+cost; NS.Store.set('meta',NS.meta); NS.Audio.play('powerup'); NS.renderShop(); NS.checkAchievements(); };

  /* ---------- ACHIEVEMENTS ---------- */
  NS.ACHS = [
    {id:'first_kill',icon:'🔫',name_ar:'القتل الأول',name_en:'First Kill',desc_ar:'اقتل عدواً واحداً',desc_en:'Kill one enemy',ck:m=>m.stats.totalKills>=1},
    {id:'kill_100',icon:'💀',name_ar:'المئة',name_en:'Century',desc_ar:'اقتل 100 عدو',desc_en:'Kill 100 enemies',ck:m=>m.stats.totalKills>=100},
    {id:'kill_1000',icon:'☠️',name_ar:'الألف',name_en:'Millennium',desc_ar:'اقتل 1000 عدو',desc_en:'Kill 1000 enemies',ck:m=>m.stats.totalKills>=1000},
    {id:'wave5',icon:'🌊',name_ar:'الصامد',name_en:'Survivor',desc_ar:'الوصول للموجة 5',desc_en:'Reach wave 5',ck:m=>m.stats.bestWave>=5},
    {id:'wave10',icon:'🌊',name_ar:'المقاوم',name_en:'Enduring',desc_ar:'الوصول للموجة 10',desc_en:'Reach wave 10',ck:m=>m.stats.bestWave>=10},
    {id:'wave20',icon:'🌊',name_ar:'الأسطورة',name_en:'Legend',desc_ar:'الوصول للموجة 20',desc_en:'Reach wave 20',ck:m=>m.stats.bestWave>=20},
    {id:'boss1',icon:'👑',name_ar:'صياد الزعماء',name_en:'Boss Hunter',desc_ar:'اقتل زعيماً',desc_en:'Kill a boss',ck:m=>m.stats.bossKills>=1},
    {id:'boss5',icon:'👑',name_ar:'محطم الزعماء',name_en:'Boss Slayer',desc_ar:'اقتل 5 زعماء',desc_en:'Kill 5 bosses',ck:m=>m.stats.bossKills>=5},
    {id:'combo10',icon:'🔥',name_ar:'سلسلة نارية',name_en:'Fire Chain',desc_ar:'كومبو 10',desc_en:'Combo 10',ck:m=>m.stats.maxCombo>=10},
    {id:'combo25',icon:'🔥',name_ar:'سلسلة ملتهبة',name_en:'Blazing Chain',desc_ar:'كومبو 25',desc_en:'Combo 25',ck:m=>m.stats.maxCombo>=25},
    {id:'score10k',icon:'⭐',name_ar:'10 آلاف',name_en:'10K',desc_ar:'احصل على 10,000 نقطة',desc_en:'Score 10,000 points',ck:m=>m.stats.bestScore>=10000},
    {id:'score100k',icon:'⭐',name_ar:'100 ألف',name_en:'100K',desc_ar:'احصل على 100,000 نقطة',desc_en:'Score 100,000 points',ck:m=>m.stats.bestScore>=100000},
    {id:'bomb5',icon:'💣',name_ar:'المدمر',name_en:'Destroyer',desc_ar:'اقتل 5 أعداء بقنبلة',desc_en:'Kill 5 with one bomb',ck:m=>m.stats.bombKillsMax>=5},
    {id:'noperfect',icon:'🛡️',name_ar:'المنيع',name_en:'Untouchable',desc_ar:'أكمل موجة بدون إصابة',desc_en:'Complete wave without damage',ck:m=>m.stats.perfectWaves>=1},
    {id:'fullup',icon:'💎',name_ar:'مكتمل الترقيات',name_en:'Fully Upgraded',desc_ar:'ارقِ كل شيء للحد الأقصى',desc_en:'Max all upgrades',ck:m=>NS.SHOP_ITEMS.every(i=>(m.upgrades[i.key]||0)>=i.max)},
    {id:'lv10',icon:'🎖️',name_ar:'المبتدئ',name_en:'Novice',desc_ar:'اصل للمستوى 10',desc_en:'Reach level 10',ck:m=>m.level>=10},
    {id:'lv25',icon:'🎖️',name_ar:'المتقدم',name_en:'Advanced',desc_ar:'اصل للمستوى 25',desc_en:'Reach level 25',ck:m=>m.level>=25},
    {id:'share',icon:'📤',name_ar:'المشارك',name_en:'Sharer',desc_ar:'شارك نتيجتك',desc_en:'Share your result',ck:m=>m.stats.shared},
    {id:'secret1hp',icon:'💀',name_ar:'الناجي',name_en:'Survivor',desc_ar:'ابقَ حياً بـ1 HP لمدة 10 ثوانٍ',desc_en:'Survive 10s at 1 HP',ck:m=>m.stats.survived1hp}
  ];
  NS.checkAchievements = function() { let n=false; NS.ACHS.forEach(a=>{ if(NS.meta.achievements[a.id])return; if(a.ck(NS.meta)){NS.meta.achievements[a.id]=true;NS.achQueue.push(a);n=true;} }); if(n)NS.Store.set('meta',NS.meta); };
  NS.showNextAch = function() { if(!NS.achQueue.length)return; const a=NS.achQueue.shift(); NS.UI.text('at-icon',a.icon); NS.UI.text('at-text',(NS.currentLang==='ar'?'إنجاز: ':'Achievement: ')+(NS.currentLang==='ar'?a.name_ar:a.name_en)); document.getElementById('ach-toast').classList.add('show'); NS.Audio.play('achievement'); NS.Audio.vibrate([50,30,50]); setTimeout(()=>document.getElementById('ach-toast').classList.remove('show'),3000); };
  NS.renderAchievements = function() { const c=document.getElementById('achievements-list'); c.innerHTML=''; NS.ACHS.forEach(a=>{ const u=!!NS.meta.achievements[a.id]; const d=document.createElement('div'); d.className='achievement'+(u?' unlocked':''); const iconDiv=document.createElement('div');iconDiv.className='ach-icon';iconDiv.textContent=u?a.icon:'🔒'; const infoDiv=document.createElement('div');infoDiv.className='ach-info'; const nameDiv=document.createElement('div');nameDiv.className='name';nameDiv.textContent=(NS.currentLang==='ar'?a.name_ar:a.name_en); const descDiv=document.createElement('div');descDiv.className='desc';descDiv.textContent=(NS.currentLang==='ar'?a.desc_ar:a.desc_en); infoDiv.appendChild(nameDiv);infoDiv.appendChild(descDiv); d.appendChild(iconDiv);d.appendChild(infoDiv);c.appendChild(d); }); };

  /* ---------- LEADERBOARD ---------- */
  NS.addLeaderboard = function(sc,w) { NS.meta.leaderboard=NS.meta.leaderboard||[]; NS.meta.leaderboard.push({score:sc,wave:w,date:Date.now(),player:NS.meta.playerName,title:NS.getTitle()}); NS.meta.leaderboard.sort((a,b)=>b.score-a.score); NS.meta.leaderboard=NS.meta.leaderboard.slice(0,10); if(NS.meta.leaderboard[0]?.score===sc){NS.meta.hallOfFame=NS.meta.hallOfFame||[];NS.meta.hallOfFame.push({score:sc,wave:w,date:Date.now(),difficulty:NS.gameState.difficulty});NS.meta.hallOfFame.sort((a,b)=>b.score-a.score);NS.meta.hallOfFame=NS.meta.hallOfFame.slice(0,3);} NS.Store.set('meta',NS.meta); };
  NS.renderLeaderboard = function() { const c=document.getElementById('leaderboard-list'); c.innerHTML=''; let entries=[...(NS.meta.leaderboard||[])]; if(entries.length<4){NS.CFG.FAKE_NAMES.slice(0,6-entries.length).forEach(n=>{entries.push({score:NS.randInt(2000,60000),wave:NS.randInt(3,18),player:n,fake:true});});entries.sort((a,b)=>b.score-a.score);} if(!entries.length){c.innerHTML='<p style="color:#556;padding:16px">'+(NS.currentLang==='ar'?'لا توجد نتائج':'No results yet')+'</p>';return;} entries.slice(0,10).forEach((e,i)=>{const d=document.createElement('div');d.className='lb-entry'+(e.player===NS.meta.playerName?' me':'');const nm=e.fake?e.player:(e.player||(NS.currentLang==='ar'?'أنت':'You'));const ttl=e.title?' <span class="title-badge">'+e.title+'</span>':'';const dateStr=e.date?new Date(e.date).toLocaleDateString(NS.currentLang==='ar'?'ar-EG':'en-US'):'';d.innerHTML=`<span class="rank">#${i+1}</span><span style="flex:1;text-align:right;font-size:clamp(10px,1.8vw,12px);color:#889">${nm}${ttl} ${dateStr}</span><span class="score">${e.score.toLocaleString()}</span><span class="wave-lbl">${NS.currentLang==='ar'?'م':'W'}${e.wave}</span>`;c.appendChild(d);}); };

  /* ---------- DAILY ---------- */
  NS.DAILY_MISSIONS = [
    {id:'kill30',desc_ar:'اقتل 30 عدو',desc_en:'Kill 30 enemies',target:30,reward:80,type:'kills'},
    {id:'nobomb2',desc_ar:'أكمل موجتين بدون قنبلة',desc_en:'2 waves without bomb',target:2,reward:60,type:'nobomb'},
    {id:'score3k',desc_ar:'احصل على 3000 نقطة',desc_en:'Score 3000',target:3000,reward:70,type:'score'}
  ];
  NS.getDailyChallenge = function() { const day=Math.floor(Date.now()/86400000); const storedDay=NS.Store.get('dailyDate',0); if(storedDay!==day){NS.Store.set('dailyDate',day);NS.DAILY_MISSIONS.forEach(c=>NS.Store.set('dm_'+c.id,0));if(storedDay&&day-storedDay===1){NS.meta.loginStreak=(NS.meta.loginStreak||0)+1;}else if(day-storedDay>1){NS.meta.loginStreak=1;}NS.meta.lastLoginDay=day;NS.Store.set('meta',NS.meta);} return NS.DAILY_MISSIONS[day%NS.DAILY_MISSIONS.length]; };

  /* ---------- GAME OVER ---------- */
  NS.updateGameOver = function(dt) { if(NS.gameOverDelay>0){NS.gameOverDelay-=dt;if(NS.gameOverDelay<=0&&!NS.gameOverShown)NS.showGameOver();} };
  NS.showGameOver = function() {
    NS.gameOverShown=true;NS.gameState.state='gameover';NS.goTimer=0; const hi=NS.Store.get('hiScore',0); if(NS.score>hi){NS.Store.set('hiScore',NS.score);NS.meta.stats.bestScore=NS.score;}
    const earnedXP=Math.floor(NS.score/100+NS.kills*2); NS.meta.stats.totalGames++;NS.meta.stats.totalKills+=NS.kills;NS.meta.stats.totalScore+=NS.score;NS.meta.stats.maxCombo=Math.max(NS.meta.stats.maxCombo||0,NS.maxCombo);NS.meta.stats.bestWave=Math.max(NS.meta.stats.bestWave||0,NS.wave);NS.meta.stats.totalPlayTime=(NS.meta.stats.totalPlayTime||0)+Math.floor(NS.gameTime);NS.meta.stats.shotsFired=(NS.meta.stats.shotsFired||0)+NS.shotsFiredThisGame;if(NS.meta.stats.shotsFired>0)NS.meta.stats.accuracy=Math.floor((NS.shotsHitThisGame/NS.meta.stats.shotsFired)*100);NS.meta.coins+=NS.coins;NS.addLeaderboard(NS.score,NS.wave);NS.addXP(earnedXP);
    const dc=NS.getDailyChallenge(); if(dc){const cur=NS.Store.get('dm_'+dc.id,0);const prog=dc.type==='kills'?NS.kills:dc.type==='score'?NS.score:dc.type==='nobomb'?NS.perfectWavesThisGame:NS.wave;NS.Store.set('dm_'+dc.id,Math.max(cur,prog));if(NS.Store.get('dm_'+dc.id,0)>=dc.target){NS.meta.coins+=dc.reward;NS.Store.set('dm_'+dc.id,0);NS.UI.notify(NS.t('dailyReward')+' '+dc.reward+' 🪙','gold',3000);}}
    NS.Store.set('meta',NS.meta);NS.checkAchievements();NS.Audio.stopMusic();
    NS.UI.text('go-score',NS.score.toLocaleString());NS.UI.text('go-wave',NS.wave);NS.UI.text('go-kills',NS.kills);NS.UI.text('go-combo',NS.maxCombo);NS.UI.text('go-coins',NS.coins);NS.UI.text('go-hi',Math.max(NS.score,hi).toLocaleString());NS.UI.text('go-rank',NS.getRank(NS.score));NS.UI.text('go-xp','+'+earnedXP+' XP');
    document.getElementById('gameover-screen').classList.add('show');NS.UI.text('go-title-text',NS.t('gameOver'));
  };

  /* ---------- HUD ---------- */
  NS.updateHUD = function(dt) {
    NS.UI.text('hud-score',NS.score.toLocaleString()); const ce=document.getElementById('hud-combo');
    if(NS.combo>1){ce.textContent=(NS.combo>=20?'🔥🔥 ':'')+'x'+NS.combo+' '+(NS.currentLang==='ar'?'كومبو':'Combo');ce.style.display='block';ce.style.color=NS.combo>=20?'#ff2d95':'#ffd700';}else ce.style.display='none';
    NS.UI.text('hud-bombs','💣 '+NS.bombs);document.getElementById('touch-bomb-count').textContent=NS.bombs;NS.UI.text('hud-coins','🪙 '+NS.coins);NS.UI.text('hud-xp','LV'+NS.meta.level);
    const hpP=NS.player.hp/NS.player.maxHp,hpBar=document.getElementById('hp-bar');hpBar.style.width=(hpP*100)+'%';hpBar.className='bar-fill hp-fill'+(hpP<=0.25?' critical':hpP<=0.5?' warn':'');
    const sw=document.getElementById('shield-bar-wrap'); if(NS.shield>0){sw.style.display='block';document.getElementById('shield-bar').style.width=(NS.shield/NS.shieldMax*100)+'%';}else sw.style.display='none';
    const puBar=document.getElementById('pu-bar'); if(NS.powerupActive){const pt=NS.PU_TYPES.find(t=>t.type===NS.powerupActive);if(pt&&pt.dur>0){puBar.style.display='flex';document.getElementById('pu-icon').textContent=pt.icon;document.getElementById('pu-icon').style.background=pt.col+'30';document.getElementById('pu-fill').style.width=(NS.powerupTimer/pt.dur*100)+'%';document.getElementById('pu-fill').style.background=pt.col;}else puBar.style.display='none';}else puBar.style.display='none';
    NS.UI.text('hud-wave',(NS.currentLang==='ar'?'الموجة ':'Wave ')+NS.wave);
    if(NS.boss){document.getElementById('wave-bar').style.width=Math.round((1-NS.boss.hp/NS.boss.maxHp)*100)+'%';}else if(NS.waveQueue.length>0||NS.enemies.length>0){const total=NS.waveEnemyCount(NS.wave),rem=NS.waveQueue.length+NS.enemies.length;document.getElementById('wave-bar').style.width=Math.round(Math.max(0,Math.min(100,(1-rem/total)*100)))+'%';}else document.getElementById('wave-bar').style.width='100%';
    if(NS.aimAssist)NS.UI.text('hud-aim',NS.currentLang==='ar'?'تصويب تلقائي: مفعّل':'Auto Aim: ON');else NS.UI.text('hud-aim','');
  };

  /* ---------- SETTINGS ---------- */
  NS.Settings = {
    toggleSfx(){NS.Audio.sfxOn=!NS.Audio.sfxOn;NS.UI.toggle('toggle-sfx',NS.Audio.sfxOn);NS.Store.set('sfxOn',NS.Audio.sfxOn);},
    toggleMusic(){NS.Audio.musicOn=!NS.Audio.musicOn;NS.UI.toggle('toggle-music',NS.Audio.musicOn);NS.Store.set('musicOn',NS.Audio.musicOn);},
    toggleHaptic(){NS.Audio.hapticOn=!NS.Audio.hapticOn;NS.UI.toggle('toggle-haptic',NS.Audio.hapticOn);NS.Store.set('hapticOn',NS.Audio.hapticOn);},
    toggleBattery(){const on=NS.UI.toggle('toggle-battery');NS.gameState.targetFPS=on?30:60;NS.gameState.frameInterval=1000/NS.gameState.targetFPS;NS.Store.set('battery',on);if(on){NS.gameState.quality=NS.CFG.QUALITY.low;document.getElementById('quality-select').value='low';}else{NS.gameState.quality=NS.CFG.QUALITY[NS.Store.get('quality','high')];document.getElementById('quality-select').value=NS.Store.get('quality','high');}},
    toggleAimAssist(){NS.aimAssist=!NS.aimAssist;NS.UI.toggle('toggle-aim-assist',NS.aimAssist);NS.Store.set('aimAssist',NS.aimAssist);},
    toggleNight(){NS.gameState.nightMode=!NS.gameState.nightMode;NS.UI.toggle('toggle-night',NS.gameState.nightMode);NS.Store.set('nightMode',NS.gameState.nightMode);document.body.style.background=NS.gameState.nightMode?'#020208':'#050510';},
    toggleFPS(){NS.gameState.showFPS=!NS.gameState.showFPS;NS.UI.toggle('toggle-fps',NS.gameState.showFPS);NS.Store.set('showFPS',NS.gameState.showFPS);document.getElementById('fps-counter').classList.toggle('visible',NS.gameState.showFPS);},
    setQuality(v){NS.gameState.quality=NS.CFG.QUALITY[v]||NS.CFG.QUALITY.high;NS.Store.set('quality',v);},
    setSensitivity(v){NS.gameState.joystickSensitivity=parseInt(v)/100;NS.Store.set('joystickSensitivity',parseInt(v));},
    setJoystickSize(v){NS.gameState.joystickSize=v;NS.Store.set('joystickSize',v);if(NS.updateJoystickSize)NS.updateJoystickSize();},
    fullscreen(){const el=document.documentElement;if(el.requestFullscreen)el.requestFullscreen().catch(()=>{});},
    init(){NS.UI.toggle('toggle-sfx',NS.Audio.sfxOn);NS.UI.toggle('toggle-music',NS.Audio.musicOn);NS.UI.toggle('toggle-haptic',NS.Audio.hapticOn);NS.UI.toggle('toggle-aim-assist',NS.aimAssist);NS.UI.toggle('toggle-night',NS.gameState.nightMode);NS.UI.toggle('toggle-fps',NS.gameState.showFPS);document.getElementById('quality-select').value=NS.Store.get('quality','high');document.getElementById('sensitivity-slider').value=NS.Store.get('joystickSensitivity',100);document.getElementById('joystick-size').value=NS.gameState.joystickSize;if(NS.Store.get('battery',false)){NS.UI.toggle('toggle-battery',true);NS.gameState.targetFPS=30;NS.gameState.frameInterval=1000/30;NS.gameState.quality=NS.CFG.QUALITY.low;}if(NS.updateJoystickSize)NS.updateJoystickSize();}
  };

  /* ---------- INPUT: KEYBOARD ---------- */
  NS.keys = {};
  window.addEventListener('keydown',e=>{NS.keys[e.code]=true; if(e.code==='KeyP'||e.code==='Escape'){if(NS.gameState.state==='playing')NS.Game.pause();else if(NS.gameState.state==='paused')NS.Game.resume();} if(e.code==='Space'){e.preventDefault();NS.fireHeld=true;} if(e.code==='KeyF')NS.bombPressed=true;});
  window.addEventListener('keyup',e=>{NS.keys[e.code]=false;if(e.code==='Space')NS.fireHeld=false;});
  window.addEventListener('blur',()=>{for(let k in NS.keys)NS.keys[k]=false;NS.fireHeld=false;NS.joyActive=false;NS.joyDX=NS.joyDY=0;if(NS.gameState.state==='playing')NS.Game.pause();});

  /* ---------- INPUT: TOUCH ---------- */
  NS.initTouchDetection = function() {
    const detect=()=>{NS.gameState.isMobileDevice=true;NS.gameState.quality.shadows=false;document.getElementById('touch-controls')?.classList.add('active');document.removeEventListener('touchstart',detect);};
    document.addEventListener('touchstart',detect,{once:true});
    if('ontouchstart'in window&&matchMedia('(pointer:coarse)').matches){NS.gameState.isMobileDevice=true;NS.gameState.quality.shadows=false;setTimeout(()=>document.getElementById('touch-controls')?.classList.add('active'),100);}
  };
  NS.initTouchControls = function() {
    const zone=document.getElementById('joystick-zone'),knob=document.getElementById('joystick-knob'),fireBtn=document.getElementById('touch-fire'),bombBtn=document.getElementById('touch-bomb'),pauseBtn=document.getElementById('touch-pause');
    if(!zone||!knob||!fireBtn||!bombBtn||!pauseBtn)return;
    document.addEventListener('touchstart',e=>{e.preventDefault();NS.Audio.init();NS.Audio.resume();for(let i=0;i<e.changedTouches.length;i++){const t=e.changedTouches[i];if(t.clientX<NS.W/2&&!NS.joyActive){NS.joyActive=true;NS.joyTouchId=t.identifier;NS.joyStartX=t.clientX;NS.joyStartY=t.clientY;NS.joyDX=0;NS.joyDY=0;zone.style.left=(t.clientX-zone.offsetWidth/2)+'px';zone.style.top=(t.clientY-zone.offsetHeight/2)+'px';zone.classList.add('active-ring');}}},{passive:false});
    document.addEventListener('touchmove',e=>{e.preventDefault();for(let i=0;i<e.touches.length;i++){const t=e.touches[i];if(t.identifier===NS.joyTouchId){const maxR=zone.offsetWidth*0.35;NS.joyDX=NS.clamp(t.clientX-NS.joyStartX,-maxR,maxR);NS.joyDY=NS.clamp(t.clientY-NS.joyStartY,-maxR,maxR);knob.style.transform=`translate(${NS.joyDX}px,${NS.joyDY}px)`;const mag=Math.hypot(NS.joyDX,NS.joyDY)/maxR;if(mag<NS.CFG.JOY_DEADZONE){NS.joyDX=0;NS.joyDY=0;}else{NS.joyDX=(NS.joyDX/maxR)*NS.gameState.joystickSensitivity;NS.joyDY=(NS.joyDY/maxR)*NS.gameState.joystickSensitivity;}break;}}},{passive:false});
    const jEnd=e=>{for(let i=0;i<e.changedTouches.length;i++){if(e.changedTouches[i].identifier===NS.joyTouchId){NS.joyActive=false;NS.joyDX=0;NS.joyDY=0;NS.joyTouchId=null;knob.style.transform='translate(0,0)';zone.classList.remove('active-ring');break;}}};
    document.addEventListener('touchend',jEnd);document.addEventListener('touchcancel',jEnd);
    fireBtn.addEventListener('pointerdown',e=>{e.preventDefault();NS.fireHeld=true;}); fireBtn.addEventListener('pointerup',()=>{NS.fireHeld=false;}); fireBtn.addEventListener('pointerleave',()=>{NS.fireHeld=false;});
    bombBtn.addEventListener('pointerdown',e=>{e.preventDefault();NS.bombPressed=true;}); bombBtn.addEventListener('pointerup',()=>{NS.bombPressed=false;});
    pauseBtn.addEventListener('pointerdown',e=>{e.preventDefault();if(NS.gameState.state==='playing')NS.Game.pause();else if(NS.gameState.state==='paused')NS.Game.resume();});
  };
  NS.updateJoystickSize = function() { const sz={small:'80px',medium:'110px',large:'140px'};const v=sz[NS.gameState.joystickSize]||'110px';const z=document.getElementById('joystick-zone');if(z){z.style.width=v;z.style.height=v;} };

  /* ---------- INPUT: GAMEPAD ---------- */
  NS.pollGamepad = function() { const gps=navigator.getGamepads?navigator.getGamepads():[]; for(const gp of gps){if(!gp)continue;const lx=gp.axes[0]||0,ly=gp.axes[1]||0;if(Math.abs(lx)>.15)NS.joyDX=lx;if(Math.abs(ly)>.15)NS.joyDY=ly;if(gp.buttons[0]?.pressed)NS.fireHeld=true;else if(!NS.gameState.isMobileDevice)NS.fireHeld=false;if(gp.buttons[2]?.pressed&&!gp.buttons[2]._pressed){NS.bombPressed=true;gp.buttons[2]._pressed=true;}else if(!gp.buttons[2]?.pressed)gp.buttons[2]._pressed=false;if(gp.buttons[9]?.pressed&&!gp.buttons[9]._pressed){if(NS.gameState.state==='playing')NS.Game.pause();else if(NS.gameState.state==='paused')NS.Game.resume();gp.buttons[9]._pressed=true;}else if(!gp.buttons[9]?.pressed)gp.buttons[9]._pressed=false;} };

  /* ---------- CANVAS ---------- */
  NS.initCanvas = function() { NS.canvas=document.getElementById('c');if(!NS.canvas)return;NS.ctx=NS.canvas.getContext('2d');if(!NS.ctx)return;NS.resize(); window.addEventListener('resize',()=>{clearTimeout(NS._resizeTimeout);NS._resizeTimeout=setTimeout(NS.resize,100);}); if(window.visualViewport){visualViewport.addEventListener('resize',()=>{clearTimeout(NS._resizeTimeout);NS._resizeTimeout=setTimeout(NS.resize,100);});} window.addEventListener('orientationchange',()=>{clearTimeout(NS._resizeTimeout);NS._resizeTimeout=setTimeout(NS.resize,200);}); };
  NS.resize = function() { if(!NS.canvas||!NS.ctx)return; const vv=window.visualViewport; NS.dpr=NS.gameState.isMobileDevice?Math.min(window.devicePixelRatio||1,2):(window.devicePixelRatio||1); NS.W=(vv?vv.width:innerWidth);NS.H=(vv?vv.height:innerHeight); NS.canvas.width=NS.W*NS.dpr;NS.canvas.height=NS.H*NS.dpr;NS.canvas.style.width=NS.W+'px';NS.canvas.style.height=NS.H+'px';NS.ctx.setTransform(NS.dpr,0,0,NS.dpr,0,0); if(NS.player){NS.player.x=NS.clamp(NS.player.x,30,NS.W-30);NS.player.y=NS.clamp(NS.player.y,30,NS.H-30);} if(NS.initStars)NS.initStars(); };

  /* ---------- RENDER LOOP ---------- */
  NS.render = function() { const ctx=NS.ctx; ctx.save();ctx.translate(NS.shX,NS.shY);ctx.fillStyle=NS.gameState.nightMode?'#020208':'#050510';ctx.fillRect(-20,-20,NS.W+40,NS.H+40); NS.renderStars(); if(NS.gameState.state==='playing'||NS.gameState.state==='gameover'){NS.renderPowerups();NS.renderBullets();NS.renderEnemies();NS.renderBoss();if(NS.gameState.state==='playing')NS.renderPlayer();} NS.renderParticles(); if(NS.combo>=20&&NS.gameState.state==='playing'){ctx.globalAlpha=0.06;ctx.fillStyle='#ff4444';ctx.fillRect(-10,-10,NS.W+20,NS.H+20);ctx.globalAlpha=1;} const totalFlash=Math.min(NS.flashAlpha+NS.flowAlpha,0.5);if(totalFlash>0){ctx.globalAlpha=totalFlash;ctx.fillStyle=NS.flashAlpha>NS.flowAlpha?'#fff':'#ff000020';ctx.fillRect(-10,-10,NS.W+20,NS.H+20);ctx.globalAlpha=1;} if(!NS.gameState.isMobileDevice&&NS.gameState.state==='playing'){ctx.strokeStyle=NS.currentWaveColor;ctx.globalAlpha=0.5;ctx.lineWidth=1;ctx.beginPath();ctx.arc(NS.mouseX,NS.mouseY,12,0,NS.TAU);ctx.stroke();ctx.beginPath();ctx.moveTo(NS.mouseX-18,NS.mouseY);ctx.lineTo(NS.mouseX-8,NS.mouseY);ctx.moveTo(NS.mouseX+8,NS.mouseY);ctx.lineTo(NS.mouseX+18,NS.mouseY);ctx.moveTo(NS.mouseX,NS.mouseY-18);ctx.lineTo(NS.mouseX,NS.mouseY-8);ctx.moveTo(NS.mouseX,NS.mouseY+8);ctx.lineTo(NS.mouseX,NS.mouseY+18);ctx.stroke();ctx.globalAlpha=1;} if(NS.powerupActive==='freeze'){ctx.globalAlpha=0.08;ctx.fillStyle='#88ccff';ctx.fillRect(-10,-10,NS.W+20,NS.H+20);ctx.globalAlpha=1;} ctx.restore(); };
  NS.loop = function(ts) { NS.gameState.animationFrameId=requestAnimationFrame(NS.loop); if(!NS.gameState.lastTime){NS.gameState.lastTime=ts;return;} let rawDt=(ts-NS.gameState.lastTime)/1000;NS.gameState.lastTime=ts;if(document.hidden)return;if(rawDt>NS.CFG.FREEZE_DT)return; let dt=Math.min(rawDt,NS.CFG.MAX_DT); if(NS.slowMoActive||NS.bulletTimeActive){dt*=0.4;if(NS.bulletTimeActive)NS.bulletTimeTimer-=rawDt;} NS.gameState.globalTime+=dt; NS.trackFPS(dt); if(NS.gameState.state==='playing')NS.pollGamepad();
    switch(NS.gameState.state){ case'menu':NS.updateStars(dt);NS.updateParticles(dt);NS.render();break;
      case'playing':NS.gameTime+=dt;NS.updatePlayer(dt);NS.updateBullets(dt);NS.updateWaveSpawning(dt);NS.updateEnemies(dt);NS.updateBoss(dt);NS.updatePowerups(dt);NS.checkCollisions(dt);NS.checkWaveComplete(dt);if(NS.comboTimer>0){NS.comboTimer-=dt;if(NS.comboTimer<=0){NS.combo=0;NS.comboTimer=0;}}NS.updateEffects(dt);NS.updateStars(dt);NS.updateParticles(dt);NS.updateOffscreenIndicators();NS.updateLowHPOverlay();NS.updateGameOver(dt);NS.updateHUD(dt);NS.render();break;
      case'paused':NS.render();break;
      case'gameover':NS.goTimer+=dt;NS.updateStars(dt);NS.updateParticles(dt);NS.render();break; }
    if(NS.achQueue&&NS.achQueue.length&&!document.getElementById('ach-toast').classList.contains('show'))NS.showNextAch(); };
  NS.trackFPS = function(dt) { NS._fpsHistory=NS._fpsHistory||[];NS._fpsHistory.push(1/dt);if(NS._fpsHistory.length>30){const avg=NS._fpsHistory.reduce((a,b)=>a+b,0)/NS._fpsHistory.length;NS._fpsHistory=[];if(NS.gameState.showFPS)NS.UI.text('fps-counter',Math.round(avg)+' FPS');if(avg<25&&NS.gameState.quality!==NS.CFG.QUALITY.low){NS.gameState.quality=NS.CFG.QUALITY.low;if(document.getElementById('quality-select'))document.getElementById('quality-select').value='low';}} };
  NS.updateOffscreenIndicators = function() { const arrows={up:document.getElementById('arrow-up'),down:document.getElementById('arrow-down'),left:document.getElementById('arrow-left'),right:document.getElementById('arrow-right')};Object.values(arrows).forEach(a=>a.classList.remove('visible'));NS.enemies.forEach(e=>{if(e.y<50)arrows.up.classList.add('visible');if(e.y>NS.H-50)arrows.down.classList.add('visible');if(e.x<50)arrows.left.classList.add('visible');if(e.x>NS.W-50)arrows.right.classList.add('visible');});if(NS.boss&&NS.boss.y<60)arrows.up.classList.add('visible'); };
  NS.updateLowHPOverlay = function() { const overlay=document.getElementById('low-hp-overlay');if(NS.player&&NS.player.alive&&NS.player.hp<=NS.player.maxHp*0.3)overlay.classList.add('active');else overlay.classList.remove('active'); };

  /* ---------- GAME MANAGER ---------- */
  NS.Game = {
    start(mode) { NS.gameState.gameMode=mode||'normal';NS.gameState.state='playing';NS.score=0;NS.wave=0;NS.combo=0;NS.comboTimer=0;NS.maxCombo=0;NS.kills=0;NS.bombs=NS.PB.baseBombs+(NS.meta.upgrades.bombs||0);NS.coins=0;NS.waveKills=0;NS.coinPickups=[];NS.shield=0;NS.shieldMax=0;NS.powerupActive=null;NS.powerupTimer=0;NS.hitSoundCooldown=0;NS.killsSinceLastPU=0;NS.gameOverDelay=0;NS.gameOverShown=false;NS.goTimer=0;NS.flashAlpha=0;NS.flowAlpha=0;NS.waveDamageTaken=false;NS.hiScoreNotified=false;NS.hiComboNotified=false;NS.slowMoActive=false;NS.slowMoTimer=0;NS.bulletTimeActive=false;NS.bulletTimeTimer=0;NS.shotsFiredThisGame=0;NS.shotsHitThisGame=0;NS.comboPitch=1.0;NS.perfectWavesThisGame=0;NS.bombUsedThisWave=false;NS.achQueue=[];NS.bossDefeatTimers.forEach(clearTimeout);NS.bossDefeatTimers=[];NS.currentWaveColor=NS.CFG.WAVE_COLORS[0];NS.player=NS.createPlayer();NS.enemies.length=0;NS.powerups.length=0;NS.waveQueue.length=0;NS.boss=null;NS.pBulletPool.releaseAll();NS.eBulletPool.releaseAll();NS.particlePool.releaseAll();NS.ringPool.releaseAll();NS.floatTextPool.releaseAll();NS.gameState.lastTime=performance.now();NS.UI.hide('main-menu');NS.UI.hide('difficulty-select');document.getElementById('gameover-screen').classList.remove('show');NS.UI.show('hud');NS.Audio.startMusic();NS.startWave(); },
    quickRestart() { document.getElementById('gameover-screen').classList.remove('show');setTimeout(()=>NS.Game.start(NS.gameState.gameMode),200); },
    pause() { if(NS.gameState.state!=='playing')return;NS.gameState.state='paused';NS.UI.show('pause-panel');NS.fireHeld=false; },
    resume() { if(NS.gameState.state!=='paused')return;NS.gameState.state='playing';NS.gameState.lastTime=performance.now();NS.UI.hide('pause-panel'); },
    goToMenu() { NS.gameState.state='menu';NS.UI.hide('hud');NS.UI.hide('pause-panel');document.getElementById('gameover-screen').classList.remove('show');NS.enemies.length=0;NS.powerups.length=0;NS.boss=null;NS.waveQueue.length=0;NS.pBulletPool.releaseAll();NS.eBulletPool.releaseAll();NS.particlePool.releaseAll();NS.ringPool.releaseAll();NS.floatTextPool.releaseAll();NS.UI.show('main-menu');NS.Audio.stopMusic();NS.updateMenuInfo(); },
    setDifficulty(d) { NS.gameState.difficulty=d;NS.UI.hide('difficulty-select');NS.Game.start(NS.gameState.gameMode); },
    toggleLanguage() { NS.currentLang=NS.currentLang==='ar'?'en':'ar';localStorage.setItem('ns_lang',NS.currentLang);NS.UI.updateLang();NS.updateMenuInfo();NS.renderShop();NS.renderAchievements();NS.renderLeaderboard(); },
    shareResult() { NS.meta.stats.shared=true;NS.Store.set('meta',NS.meta);NS.checkAchievements();const txt=NS.currentLang==='ar'?`🚀 NEON STORM\n🏆 ${NS.score.toLocaleString()} نقطة\n🌊 موجة ${NS.wave}\n💀 ${NS.kills} قتيل\n🔥 كومبو ${NS.maxCombo}\n📊 تصنيف: ${NS.getRank(NS.score)}`:`🚀 NEON STORM\n🏆 ${NS.score.toLocaleString()} pts\n🌊 Wave ${NS.wave}\n💀 ${NS.kills} kills\n🔥 Combo ${NS.maxCombo}\n📊 Rank: ${NS.getRank(NS.score)}`;if(navigator.share){navigator.share({title:'NEON STORM',text:txt}).catch(()=>{});}else{navigator.clipboard?.writeText(txt);NS.UI.notify(NS.currentLang==='ar'?'تم نسخ النتيجة!':'Result copied!','cyan',1500);} }
  };

  /* ---------- INIT ---------- */
  function init() {
    NS.pBulletPool = new NS.ObjPool(()=>({x:0,y:0,vx:0,vy:0,dmg:0,col:'#00e5ff',sz:3}), NS.CFG.MAX_PLAYER_BULLETS);
    NS.eBulletPool = new NS.ObjPool(()=>({x:0,y:0,vx:0,vy:0,col:'#ff2d95',sz:4}), NS.CFG.ENEMY_BULLET_MAX);
    NS.particlePool = new NS.ObjPool(()=>({x:0,y:0,vx:0,vy:0,life:0,maxLife:0,col:'#fff',sz:1}), NS.CFG.MAX_PARTICLES);
    NS.ringPool = new NS.ObjPool(()=>({x:0,y:0,r:5,maxR:0,life:0,maxLife:0,col:'#fff'}), 40);
    NS.floatTextPool = new NS.ObjPool(()=>({x:0,y:0,txt:'',col:'#fff',life:0,maxLife:0}), NS.CFG.MAX_FLOATING_TEXTS);

    NS.initCanvas();
    NS.initTouchDetection();
    NS.initStars();
    NS.initTouchControls();
    NS.Settings.init();
    NS.UI.updateLang();

    document.addEventListener('click', function initAudio() { NS.Audio.init(); NS.Audio.resume(); document.removeEventListener('click', initAudio); }, { once: true });
    document.querySelectorAll('.panel-close').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); const panel = b.closest('.panel'); if (panel) { NS.UI.hide(panel.id); if (NS.gameState.state === 'menu') NS.updateMenuInfo(); } }));
    function bind(id, fn) { const el = document.getElementById(id); if (el) el.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); }
    bind('btn-play', () => { NS.gameState.gameMode = 'normal'; NS.UI.hide('main-menu'); NS.UI.show('difficulty-select'); });
    bind('btn-boss', () => { if (NS.meta.level < 3) { NS.UI.notify(NS.t('needLv3'), 'cyan', 1500); return; } NS.gameState.gameMode = 'boss'; NS.UI.hide('main-menu'); NS.UI.show('difficulty-select'); });
    bind('btn-survival', () => { if (NS.meta.level < 5) { NS.UI.notify(NS.t('needLv5'), 'cyan', 1500); return; } NS.gameState.gameMode = 'survival'; NS.UI.hide('main-menu'); NS.UI.show('difficulty-select'); });
    bind('btn-shop', () => { NS.renderShop(); NS.UI.hide('main-menu'); NS.UI.show('shop-panel'); });
    bind('shop-close', () => { NS.UI.hide('shop-panel'); NS.UI.show('main-menu'); NS.updateMenuInfo(); });
    bind('btn-achievements', () => { NS.renderAchievements(); NS.UI.hide('main-menu'); NS.UI.show('achievements-panel'); });
    bind('achievements-close', () => { NS.UI.hide('achievements-panel'); NS.UI.show('main-menu'); NS.updateMenuInfo(); });
    bind('btn-leaderboard', () => { NS.renderLeaderboard(); NS.UI.hide('main-menu'); NS.UI.show('leaderboard-panel'); });
    bind('leaderboard-close', () => { NS.UI.hide('leaderboard-panel'); NS.UI.show('main-menu'); NS.updateMenuInfo(); });
    bind('btn-settings', () => { NS.UI.hide('main-menu'); NS.UI.show('settings-panel'); });
    bind('settings-close', () => { NS.UI.hide('settings-panel'); NS.UI.show('main-menu'); NS.updateMenuInfo(); });
    bind('btn-howto', () => { NS.UI.hide('main-menu'); NS.UI.show('howto-panel'); });
    bind('howto-close', () => { NS.UI.hide('howto-panel'); NS.UI.show('main-menu'); NS.updateMenuInfo(); });
    bind('btn-resume', NS.Game.resume);
    bind('pause-settings-btn', () => { NS.UI.hide('pause-panel'); NS.UI.show('settings-panel'); });
    bind('btn-quit', NS.Game.goToMenu);
    bind('btn-retry', NS.Game.quickRestart);
    bind('btn-share', NS.Game.shareResult);
    bind('btn-menu', NS.Game.goToMenu);
    bind('btn-fullscreen', NS.Settings.fullscreen);
    document.getElementById('toggle-sfx')?.addEventListener('click', NS.Settings.toggleSfx);
    document.getElementById('toggle-music')?.addEventListener('click', NS.Settings.toggleMusic);
    document.getElementById('toggle-haptic')?.addEventListener('click', NS.Settings.toggleHaptic);
    document.getElementById('toggle-battery')?.addEventListener('click', NS.Settings.toggleBattery);
    document.getElementById('toggle-aim-assist')?.addEventListener('click', NS.Settings.toggleAimAssist);
    document.getElementById('toggle-night')?.addEventListener('click', NS.Settings.toggleNight);
    document.getElementById('toggle-fps')?.addEventListener('click', NS.Settings.toggleFPS);
    document.getElementById('quality-select')?.addEventListener('change', e => NS.Settings.setQuality(e.target.value));
    document.getElementById('sensitivity-slider')?.addEventListener('input', e => NS.Settings.setSensitivity(e.target.value));
    document.getElementById('joystick-size')?.addEventListener('change', e => NS.Settings.setJoystickSize(e.target.value));
    document.getElementById('lang-toggle')?.addEventListener('click', NS.Game.toggleLanguage);
    document.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', e => NS.Game.setDifficulty(e.target.dataset.diff)));

    // Loading simulation
    let lp = 0;
    const lb = document.getElementById('load-bar'), lt = document.getElementById('load-text'), lti = document.getElementById('load-tips');
    const tips_ar = ['اسحب لليسار/اليمين لتفعيل القنبلة','الكومبو يزيد الضرر أيضاً!','اقتل 8 أعداء بدون توقف لضمان باور-آب','اضغط P للإيقاف المؤقت','الزعيم يظهر كل 5 موجات'];
    const tips_en = ['Swipe to activate bomb','Combo increases damage!','Kill 8 non-stop for power-up','Press P to pause','Boss every 5 waves'];
    lti.textContent = (NS.currentLang==='ar'?tips_ar:tips_en)[NS.randInt(0,4)];
    let tipIdx = 0;
    const tipInterval = setInterval(() => { tipIdx = (tipIdx+1)%5; lti.style.opacity = '0'; setTimeout(() => { lti.textContent = (NS.currentLang==='ar'?tips_ar:tips_en)[tipIdx]; lti.style.opacity = '1'; }, 400); }, 3000);
    const li = setInterval(() => { lp += NS.rand(15,30); if (lp >= 100) { lp = 100; lb.style.width = '100%'; lt.textContent = NS.t('ready'); clearInterval(li); clearInterval(tipInterval); setTimeout(() => { NS.UI.hide('loading-screen'); NS.UI.show('main-menu'); NS.gameState.state = 'menu'; NS.updateMenuInfo(); }, 400); } else { lb.style.width = lp+'%'; lt.textContent = (NS.currentLang==='ar'?['تحميل الموارد...','تجهيز الأعداء...','شحن الأسلحة...','تهيئة المحرك...']:['Loading assets...','Preparing enemies...','Charging weapons...','Initializing engine...'])[Math.floor(lp/30)]; } }, 180);
    requestAnimationFrame(NS.loop);
  }

  window.addEventListener('beforeunload', () => { if (NS.gameState.animationFrameId) cancelAnimationFrame(NS.gameState.animationFrameId); NS.Audio.stopMusic(); NS.Store.set('meta', NS.meta); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

})(window);
