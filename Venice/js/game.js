// game.js — 베네치아 온라인 게임 엔진 (솔로 + 대결 공용)
// 좌표계: 캔버스의 CSS 픽셀 크기를 논리 좌표로 사용하고, 백킹 스토어는 dpr 배율.
(function (global) {
  'use strict';

  var MAX_LIFE = 9;
  var SKILL_RECHARGE = 30; // 초
  var FONT = VeniceFX.FONT;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // 아주 작은 이벤트 이미터
  function emitterMix(obj) {
    var map = {};
    obj.on = function (ev, cb) { (map[ev] || (map[ev] = [])).push(cb); return obj; };
    obj.emit = function (ev, a, b) {
      var l = map[ev]; if (!l) return;
      for (var i = 0; i < l.length; i++) l[i](a, b);
    };
  }

  function VeniceGame(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    emitterMix(this);

    this.lang = 'ko';
    this.W = 480; this.H = 720;
    this.dpr = 1;

    this.words = [];
    this.fx = new VeniceFX.Particles();

    this.mode = 'solo';          // 'solo' | 'battle'
    this.running = false;
    this.paused = false;         // 탭 숨김 시 일시정지
    this.gameOver = false;
    this.dead = false;           // 대결에서 수몰됨(관전)

    this.life = MAX_LIFE;
    this.level = 1;
    this.score = 0;
    this.combo = 0;

    this.typed = '';
    this._spawnTimer = 0;
    this._levelTimer = 0;
    this._clearsThisLevel = 0;
    this._clearsForHeal = 0;    // 10개 파괴마다 라이프 +1
    this._last = 0;
    this._damageFlash = 0;
    this._healFlash = 0;
    this._shake = 0;
    this._pendingOver = null;   // 파괴 연출 후 게임오버까지 남은 시간(초)

    // 스페셜 스킬: 단어 발사 (30초마다 1충전, 최대 skillMax)
    this.skillCharges = 0;
    this.skillMax = 3;
    this._skillTimer = 0;

    this._busy = new Set();      // 현재 떠 있는 단어 텍스트
    this._loop = this._loop.bind(this);

    this.resize();
  }

  // ----- 화면 크기 -----
  VeniceGame.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var dpr = global.devicePixelRatio || 1;
    this.dpr = dpr;
    this.W = Math.max(280, rect.width);
    this.H = Math.max(360, rect.height);
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  // ----- 파라미터 (난이도 스케일) -----
  // 속도는 상한선을 둔다(레벨 ~22 에서 최대). 난이도는 영어 섞임·대결 공격으로 보강.
  VeniceGame.prototype.fallSpeed = function () {
    return Math.min(this.H * 0.30, this.H * (0.09 + 0.010 * (this.level - 1)));
  };
  VeniceGame.prototype.spawnInterval = function () {
    return Math.max(0.75, 2.4 - 0.09 * (this.level - 1));
  };
  VeniceGame.prototype.wordsPerLevel = function () {
    return this.mode === 'battle' ? 10 : 8;
  };
  // 한국어 모드에서 특정 레벨부터 영어 단어가 섞여 나올 확률
  VeniceGame.prototype.englishChance = function () {
    if (this.lang !== 'ko' || this.level < 10) return 0;
    return Math.min(0.4, (this.level - 9) * 0.05);
  };
  VeniceGame.prototype.fontPx = function () {
    return clamp(Math.round(this.H * 0.040), 18, 30);
  };
  // 물 표면 y (라이프가 줄수록 위로 차오름 → 수몰)
  VeniceGame.prototype.waterY = function () {
    var bottomPad = this.H * 0.06;
    var blockH = (this.H * 0.46) / MAX_LIFE;
    return this.H - bottomPad - (MAX_LIFE - this.life) * blockH;
  };

  // ----- 라이프사이클 -----
  VeniceGame.prototype.setLang = function (lang) { this.lang = lang === 'en' ? 'en' : 'ko'; };

  VeniceGame.prototype._resetState = function () {
    this.words.length = 0;
    this._busy.clear();
    this.fx.clear();
    this.score = 0;
    this.combo = 0;
    this.life = MAX_LIFE;
    this.level = 1;
    this.typed = '';
    this._spawnTimer = 0.4;
    this._levelTimer = 0;
    this._clearsThisLevel = 0;
    this._clearsForHeal = 0;
    this._damageFlash = 0;
    this._healFlash = 0;
    this._shake = 0;
    this._pendingOver = null;
    this.skillCharges = 0;
    this._skillTimer = 0;
    this.paused = false;
    this.gameOver = false;
    this.dead = false;
  };

  VeniceGame.prototype.startSolo = function () {
    this._resetState();
    this.mode = 'solo';
    this.emit('mode', 'solo');
    this.emit('life', this.life);
    this.emit('level', this.level);
    this.emit('score', this.score);
    this.emit('skill', this.getSkillState());
    this.start();
  };

  // 누군가 조인 → 대결 시작 (레벨 최소로, 라이프 풀로 리셋)
  VeniceGame.prototype.startBattle = function () {
    this._resetState();
    this.mode = 'battle';
    this.emit('mode', 'battle');
    this.emit('life', this.life);
    this.emit('level', this.level);
    this.emit('score', this.score);
    this.emit('skill', this.getSkillState());
    this.start();
  };

  // 대결 중 모두 떠나면 솔로로 (현재 상태 유지하고 계속)
  VeniceGame.prototype.toSolo = function () {
    if (this.mode === 'solo') return;
    this.mode = 'solo';
    this.emit('mode', 'solo');
  };

  VeniceGame.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this._last = 0;
    this._raf = global.requestAnimationFrame(this._loop);
  };
  VeniceGame.prototype.stop = function () {
    this.running = false;
    if (this._raf) global.cancelAnimationFrame(this._raf);
  };

  // 탭 숨김 → 일시정지 (그동안 오는 공격은 무시하여 복귀 시 폭탄 방지)
  VeniceGame.prototype.pause = function () { this.paused = true; };
  VeniceGame.prototype.resume = function () {
    if (!this.paused) return;
    this.paused = false;
    this._last = 0; // dt 급증(빨리감기) 방지
    if (this.running) {
      if (this._raf) global.cancelAnimationFrame(this._raf);
      this._raf = global.requestAnimationFrame(this._loop);
    }
  };

  // ----- 입력 매칭 -----
  VeniceGame.prototype.setTyped = function (s) { this.typed = s || ''; };

  // 정확히 일치하는 단어 중 "가장 아래(가장 큰 y)" 한 개만 파괴
  VeniceGame.prototype.tryMatch = function (typed) {
    typed = (typed || '').trim();
    if (!typed) return false;
    var target = null;
    for (var i = 0; i < this.words.length; i++) {
      var w = this.words[i];
      if (w.dying) continue;
      if (w.text === typed) {
        if (!target || w.y > target.y) target = w;
      }
    }
    if (!target) return false;
    this._destroy(target, true);
    return true;
  };

  VeniceGame.prototype._destroy = function (w, byPlayer) {
    var idx = this.words.indexOf(w);
    if (idx >= 0) this.words.splice(idx, 1);
    this._busy.delete(w.text);
    this.fx.burst(w.x, w.y, w.launched ? '#c08bff' : (w.incoming ? '#ff7b6b' : '#ffd166'), w.text);

    if (byPlayer) {
      this.combo++;
      var gain = Math.round((10 + w.text.length * 2) * (1 + this.level * 0.1) * (1 + Math.min(this.combo, 10) * 0.05));
      this.score += gain;
      this.emit('score', this.score);
      this._clearsThisLevel++;
      // 대결: 내가 자연 생성한 단어를 깰 때만 상대에게 발사 (받은 공격·발사 단어는 방어 전용 → 핑퐁 방지)
      if (this.mode === 'battle' && !w.incoming && !w.launched) this.emit('clear', w.text);
      // 레벨업 (클리어 누적)
      if (this._clearsThisLevel >= this.wordsPerLevel()) {
        this._clearsThisLevel = 0;
        this._levelUp();
      }
      // 10개 파괴마다 라이프 +1 (솔로/대결 공통)
      this._clearsForHeal++;
      if (this._clearsForHeal >= 10) {
        this._clearsForHeal = 0;
        if (this.addLife(1)) this.emit('heal', { by: 'clears', n: 10 });
      }
    }
  };

  VeniceGame.prototype._levelUp = function () {
    if (this.level >= 30) return;
    this.level++;
    this.emit('level', this.level);
  };

  // 단어가 물에 닿음 → 데미지
  VeniceGame.prototype._hitWater = function (w) {
    var idx = this.words.indexOf(w);
    if (idx >= 0) this.words.splice(idx, 1);
    this._busy.delete(w.text);
    this.combo = 0;
    this.fx.splash(w.x, this.waterY(), '#7ec8ff');
    this._damageFlash = 0.5;
    this._shake = 8;
    this.life = Math.max(0, this.life - 1);
    this.emit('life', this.life);
    if (this.life <= 0) this._die();
  };

  // 수몰 → 파괴 연출을 잠깐 보여준 뒤 (본인) 게임오버.
  VeniceGame.prototype._die = function () {
    if (this.dead) return;
    this.dead = true;
    this.combo = 0;
    this._bigDestroy();
    this._pendingOver = 1.3; // 이 시간 뒤 gameover 이벤트
    // 대결이면 서버/상대에게 알림 (상대는 계속 플레이 + 라이프 보너스)
    if (this.mode === 'battle') this.emit('dead');
  };

  // 도시 붕괴 연출: 타워 주변 폭발 + 물보라 + 화면 흔들림
  VeniceGame.prototype._bigDestroy = function () {
    var cx = this.W / 2, wy = this.waterY();
    for (var i = 0; i < 6; i++) {
      this.fx.burst(cx + (Math.random() - 0.5) * this.W * 0.4,
                    wy - Math.random() * this.H * 0.25, '#ff8a5b', null);
    }
    for (var j = 0; j < 4; j++) {
      this.fx.splash(cx + (Math.random() - 0.5) * this.W * 0.6, wy, '#7ec8ff');
    }
    this._damageFlash = 0.8;
    this._shake = 16;
  };

  // 라이프 회복 (대결에서 상대가 게임오버되면 생존자 보너스)
  VeniceGame.prototype.addLife = function (n) {
    if (this.dead || this.gameOver) return false;
    var before = this.life;
    this.life = Math.min(MAX_LIFE, this.life + (n || 1));
    if (this.life !== before) { this.emit('life', this.life); this._healFlash = 0.6; }
    return this.life !== before;
  };

  // 외부에서 강제 종료
  VeniceGame.prototype.finish = function (info) {
    this.gameOver = true;
    this.emit('gameover', info || { score: this.score, level: this.level, mode: this.mode });
  };

  // 공격 수신 → 단어 떨어뜨림
  VeniceGame.prototype.receiveAttack = function (text) {
    if (this.paused || this.dead || this.gameOver) return;
    this._spawnWord(text, true);
  };

  // ----- 스페셜 스킬: 단어 발사 -----
  VeniceGame.prototype.getSkillState = function () {
    return {
      charges: this.skillCharges,
      max: this.skillMax,
      progress: this.skillCharges >= this.skillMax ? 1 : Math.min(1, this._skillTimer / SKILL_RECHARGE),
      ready: this.skillCharges > 0
    };
  };

  // 발사한 단어를 자신에게도 떨어뜨린다. 성공 시 (정제된) 단어 문자열, 실패 시 false 반환.
  VeniceGame.prototype.useSkill = function (text) {
    if (this.gameOver || this.dead) return false;
    if (this.skillCharges < 1) return false;
    text = String(text == null ? '' : text).replace(/\s+/g, '').slice(0, 10);
    if (!text) return false;
    this.skillCharges--;
    this.emit('skill', this.getSkillState());
    this._spawnWord(text, false, true); // 자신에게도 떨어짐 (launched 스타일)
    return text;
  };

  // ----- 스폰 -----
  VeniceGame.prototype._spawnWord = function (text, incoming, launched) {
    if (text == null) {
      var pickLang = (Math.random() < this.englishChance()) ? 'en' : this.lang;
      text = VeniceWords.pick(pickLang, this.level, this._busy);
    }
    this.ctx.font = '700 ' + this.fontPx() + 'px ' + FONT;
    var halfW = this.ctx.measureText(text).width / 2 + 14;
    var x = clamp(Math.random() * this.W, halfW + 6, this.W - halfW - 6);
    this.words.push({
      text: text, x: x, y: -10,
      speed: this.fallSpeed() * (incoming ? 1.05 : 1) * (0.92 + Math.random() * 0.16),
      incoming: !!incoming,
      launched: !!launched,
      dying: false,
      hw: halfW
    });
    this._busy.add(text);
  };

  // ----- 메인 루프 -----
  VeniceGame.prototype._loop = function (ts) {
    if (!this.running) return;
    if (!this._last) this._last = ts;
    var dt = Math.min(0.05, (ts - this._last) / 1000);
    this._last = ts;
    this.update(dt);
    this.draw();
    this._raf = global.requestAnimationFrame(this._loop);
  };

  VeniceGame.prototype.update = function (dt) {
    if (this.paused) return;
    this.fx.update(dt);
    if (this._damageFlash > 0) this._damageFlash = Math.max(0, this._damageFlash - dt);
    if (this._healFlash > 0) this._healFlash = Math.max(0, this._healFlash - dt);
    if (this._shake > 0) this._shake = Math.max(0, this._shake - dt * 26);

    // 파괴 연출 후 게임오버 화면 띄우기
    if (this._pendingOver != null) {
      this._pendingOver -= dt;
      if (this._pendingOver <= 0) {
        this._pendingOver = null;
        this.gameOver = true;
        this.emit('gameover', { score: this.score, level: this.level, mode: this.mode });
        return;
      }
    }

    if (this.gameOver) return;

    // 죽지 않았을 때만 스폰/낙하
    if (!this.dead) {
      // 스킬 충전 (30초마다 1, 최대 skillMax)
      if (this.skillCharges < this.skillMax) {
        this._skillTimer += dt;
        if (this._skillTimer >= SKILL_RECHARGE) {
          this._skillTimer = 0;
          this.skillCharges++;
          this.emit('skill', this.getSkillState());
        }
      } else {
        this._skillTimer = 0;
      }
      // 솔로: 시간으로도 레벨 상승 (완만하게)
      if (this.mode === 'solo') {
        this._levelTimer += dt;
        if (this._levelTimer >= 14) { this._levelTimer = 0; this._levelUp(); }
      }
      this._spawnTimer -= dt;
      if (this._spawnTimer <= 0) {
        this._spawnTimer = this.spawnInterval();
        this._spawnWord(null, false);
      }
    }

    var wy = this.waterY();
    for (var i = this.words.length - 1; i >= 0; i--) {
      var w = this.words[i];
      w.y += w.speed * dt;
      if (w.y >= wy) this._hitWater(w);
    }
  };

  // ----- 렌더 -----
  VeniceGame.prototype.draw = function () {
    var ctx = this.ctx, W = this.W, H = this.H;
    ctx.save();
    if (this._shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * this._shake, (Math.random() - 0.5) * this._shake);
    }

    // 하늘 배경
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0e1530');
    sky.addColorStop(0.55, '#16224a');
    sky.addColorStop(1, '#1d3470');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // 은은한 별
    this._drawStars(ctx, W, H);

    var wy = this.waterY();

    // 타워/등대 (물 아래에 그려지고 물이 차오르며 덮음)
    this._drawTower(ctx, W, H, wy);

    // 단어들
    this._drawWords(ctx);

    // 물 표면 + 물 (반투명, 차오르는 영역)
    this._drawWater(ctx, W, H, wy);

    // 파티클
    this.fx.draw(ctx);

    // 데미지 플래시
    if (this._damageFlash > 0) {
      ctx.globalAlpha = this._damageFlash * 0.6;
      ctx.fillStyle = '#ff3b3b';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    // 회복 플래시 (라이프 +1)
    if (this._healFlash > 0) {
      ctx.globalAlpha = this._healFlash * 0.45;
      ctx.fillStyle = '#3bff9b';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // 수몰 연출 텍스트
    if (this.dead) {
      ctx.fillStyle = 'rgba(6,10,24,0.62)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ff9a7a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 ' + Math.round(H * 0.075) + 'px ' + FONT;
      ctx.fillText('수몰!', W / 2, H / 2);
    }

    ctx.restore();
  };

  VeniceGame.prototype._drawStars = function (ctx, W, H) {
    if (!this._stars) {
      this._stars = [];
      for (var i = 0; i < 40; i++) {
        this._stars.push({ x: Math.random() * W, y: Math.random() * H * 0.5, r: Math.random() * 1.4 + 0.3 });
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (var j = 0; j < this._stars.length; j++) {
      var s = this._stars[j];
      ctx.globalAlpha = 0.25 + 0.3 * Math.abs(Math.sin((this._last + s.x * 30) / 900));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  VeniceGame.prototype._drawTower = function (ctx, W, H, wy) {
    var cx = W / 2;
    var baseY = H - H * 0.055;
    var towerH = H * 0.42;
    var topY = baseY - towerH;
    var halfBase = W * 0.085;
    var halfTop = W * 0.05;

    // 섬(바닥)
    ctx.fillStyle = '#3a2f25';
    ctx.beginPath();
    ctx.moveTo(cx - halfBase * 1.7, baseY);
    ctx.quadraticCurveTo(cx, baseY - 18, cx + halfBase * 1.7, baseY);
    ctx.lineTo(cx + halfBase * 1.9, baseY + 30);
    ctx.lineTo(cx - halfBase * 1.9, baseY + 30);
    ctx.closePath();
    ctx.fill();

    // 등대 몸통 (빨강/흰 줄무늬)
    var stripes = 6;
    for (var s = 0; s < stripes; s++) {
      var y0 = baseY - (towerH * s) / stripes;
      var y1 = baseY - (towerH * (s + 1)) / stripes;
      var t0 = s / stripes, t1 = (s + 1) / stripes;
      var hb0 = halfBase + (halfTop - halfBase) * t0;
      var hb1 = halfBase + (halfTop - halfBase) * t1;
      ctx.fillStyle = (s % 2 === 0) ? '#e7ecf5' : '#e2483d';
      ctx.beginPath();
      ctx.moveTo(cx - hb0, y0);
      ctx.lineTo(cx + hb0, y0);
      ctx.lineTo(cx + hb1, y1);
      ctx.lineTo(cx - hb1, y1);
      ctx.closePath();
      ctx.fill();
    }
    // 등대 머리 + 불빛
    ctx.fillStyle = '#2b3550';
    ctx.fillRect(cx - halfTop * 1.4, topY - H * 0.03, halfTop * 2.8, H * 0.03);
    var glow = ctx.createRadialGradient(cx, topY - H * 0.015, 2, cx, topY - H * 0.015, W * 0.12);
    glow.addColorStop(0, 'rgba(255,224,130,0.9)');
    glow.addColorStop(1, 'rgba(255,224,130,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, topY - H * 0.015, W * 0.12, 0, Math.PI * 2);
    ctx.fill();
  };

  VeniceGame.prototype._drawWords = function (ctx) {
    var fp = this.fontPx();
    ctx.font = '700 ' + fp + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var typed = this.typed.trim();
    for (var i = 0; i < this.words.length; i++) {
      var w = this.words[i];
      var matchLen = 0;
      if (typed && w.text.indexOf(typed) === 0) matchLen = typed.length;

      // 종류별 색: 발사(보라) / 받은공격(빨강) / 일반(파랑)
      var bgFill = w.launched ? 'rgba(70,40,110,0.6)' : (w.incoming ? 'rgba(120,30,30,0.55)' : 'rgba(12,20,44,0.55)');
      var lineCol = w.launched ? 'rgba(192,139,255,0.8)' : (w.incoming ? 'rgba(255,120,100,0.7)' : 'rgba(140,170,220,0.35)');
      var txtCol = w.launched ? '#e3ccff' : (w.incoming ? '#ffd9d2' : '#eaf1ff');

      // 캡슐 배경
      var halfW = w.hw;
      var hh = fp * 0.82;
      ctx.fillStyle = bgFill;
      this._roundRect(ctx, w.x - halfW, w.y - hh, halfW * 2, hh * 2, hh);
      ctx.fill();
      ctx.lineWidth = matchLen ? 2.5 : 1.2;
      ctx.strokeStyle = matchLen ? '#ffd166' : lineCol;
      this._roundRect(ctx, w.x - halfW, w.y - hh, halfW * 2, hh * 2, hh);
      ctx.stroke();

      // 텍스트: 이미 친 접두부는 강조색
      if (matchLen > 0) {
        var pre = w.text.slice(0, matchLen);
        var rest = w.text.slice(matchLen);
        var preW = ctx.measureText(pre).width;
        var restW = ctx.measureText(rest).width;
        var startX = w.x - (preW + restW) / 2;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffd166';
        ctx.fillText(pre, startX, w.y);
        ctx.fillStyle = txtCol;
        ctx.fillText(rest, startX + preW, w.y);
        ctx.textAlign = 'center';
      } else {
        ctx.fillStyle = txtCol;
        ctx.fillText(w.text, w.x, w.y);
      }
    }
  };

  VeniceGame.prototype._drawWater = function (ctx, W, H, wy) {
    var grad = ctx.createLinearGradient(0, wy, 0, H);
    grad.addColorStop(0, 'rgba(60,150,230,0.45)');
    grad.addColorStop(1, 'rgba(20,60,150,0.78)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, wy, W, H - wy);
    // 물결 표면 라인
    ctx.strokeStyle = 'rgba(180,220,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    var t = this._last / 600;
    for (var x = 0; x <= W; x += 8) {
      var y = wy + Math.sin(x / 38 + t) * 3;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  VeniceGame.prototype._roundRect = function (ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  // ----- 네트워크용 스냅샷 (미니뷰) -----
  VeniceGame.prototype.getSnapshot = function () {
    var wy = this.waterY();
    var arr = [];
    var n = Math.min(this.words.length, 14);
    for (var i = 0; i < n; i++) {
      var w = this.words[i];
      arr.push({
        x: +(w.x / this.W).toFixed(3),
        y: +(w.y / this.H).toFixed(3),
        t: w.text,
        a: w.incoming ? 1 : 0
      });
    }
    return {
      life: this.life,
      level: this.level,
      score: this.score,
      dead: this.dead ? 1 : 0,
      wy: +(wy / this.H).toFixed(3),
      words: arr
    };
  };

  VeniceGame.MAX_LIFE = MAX_LIFE;
  global.VeniceGame = VeniceGame;
})(window);
