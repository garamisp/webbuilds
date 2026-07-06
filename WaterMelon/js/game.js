// game.js — 서버 상태 렌더 + 조준/투하 입력 전송. 물리는 서버가 담당.
(function () {
  'use strict';

  var net = new WMNet();

  var EMOJI = ['🍒', '🍓', '🍇', '🍋', '🍊', '🍎', '🍐', '🍑', '🍍', '🍈', '🍉'];
  var COLORS = ['#e23b3b', '#e2537b', '#7d4fd0', '#e9d84a', '#e8963a',
                '#e0402f', '#c7d64a', '#f0a5c0', '#e6c34a', '#8fd14a', '#2ea84a'];

  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var elPlayers = document.getElementById('players');
  var elScore = document.getElementById('score');
  var elConn = document.getElementById('conn');
  var overlay = document.getElementById('overlay');
  var elOverScore = document.getElementById('over-score');

  var cfg = null;               // { w, h, lineY, radii, maxTier, spawnY }
  var balls = new Map();        // id -> { tier, x, y, tx, ty }
  var players = [];             // [ [id, aimX, tier] ]
  var score = 0, over = false;
  var myAim = 900, myTier = 0;
  var lastDropAt = -9999;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  // -------- net --------
  net.on('open', function () { elConn.textContent = '🟢 접속됨'; });
  net.on('close', function () { elConn.textContent = '🔴 재연결 중…'; });
  net.on('error', function () { elConn.textContent = '🟠 연결 오류'; });
  net.on('unavailable', function () { elConn.textContent = '서버 미설정'; });

  net.on('welcome', function (m) {
    cfg = m;
    myAim = m.w / 2;
    myTier = m.tier;
    resize();
  });
  net.on('you', function (m) { myTier = m.tier; });
  net.on('state', function (st) {
    var seen = new Set();
    for (var i = 0; i < st.b.length; i++) {
      var row = st.b[i], id = row[0], tier = row[1], x = row[2], y = row[3];
      seen.add(id);
      var bb = balls.get(id);
      if (!bb) balls.set(id, { tier: tier, x: x, y: y, tx: x, ty: y });
      else { bb.tier = tier; bb.tx = x; bb.ty = y; }
    }
    balls.forEach(function (_v, id) { if (!seen.has(id)) balls.delete(id); });
    players = st.p;
    score = st.s;
    over = st.o;
    elPlayers.textContent = '👥 ' + players.length;
    elScore.textContent = '⭐ ' + score;
  });
  net.on('gameover', function (g) {
    overlay.classList.remove('hidden');
    elOverScore.textContent = '최종 점수 ' + g.score;
    setTimeout(function () { overlay.classList.add('hidden'); }, 2400);
  });

  net.connect();

  // -------- view transform --------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  function view() {
    var cw = canvas.width, ch = canvas.height;
    var sc = Math.min(cw / cfg.w, ch / cfg.h);
    return { sc: sc, ox: (cw - cfg.w * sc) / 2, oy: (ch - cfg.h * sc) / 2 };
  }
  function screenToWorldX(clientX) {
    var v = view();
    return (clientX * dpr - v.ox) / v.sc;
  }

  // -------- input --------
  var aimPending = false;
  function setAim(clientX) {
    if (!cfg) return;
    myAim = Math.max(0, Math.min(cfg.w, screenToWorldX(clientX)));
    if (!aimPending) {
      aimPending = true;
      setTimeout(function () { aimPending = false; net.sendAim(myAim); }, 45);
    }
  }
  function drop() {
    if (!cfg || over) return;
    lastDropAt = performance.now();
    net.sendDrop(myAim);
  }
  canvas.addEventListener('mousemove', function (e) { setAim(e.clientX); });
  canvas.addEventListener('mousedown', function (e) { setAim(e.clientX); drop(); });
  canvas.addEventListener('touchmove', function (e) { setAim(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchstart', function (e) { setAim(e.touches[0].clientX); drop(); e.preventDefault(); }, { passive: false });
  window.addEventListener('keydown', function (e) { if (e.code === 'Space') { e.preventDefault(); drop(); } });

  // -------- draw helpers --------
  function lighten(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(r + (255 - r) * amt);
    g = Math.round(g + (255 - g) * amt);
    b = Math.round(b + (255 - b) * amt);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function drawBall(v, x, y, tier, alpha, ghost) {
    var r = cfg.radii[tier] * v.sc;
    var sx = v.ox + x * v.sc, sy = v.oy + y * v.sc;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    if (ghost) {
      ctx.strokeStyle = COLORS[tier];
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      var g = ctx.createRadialGradient(sx - r * 0.3, sy - r * 0.3, r * 0.1, sx, sy, r);
      g.addColorStop(0, lighten(COLORS[tier], 0.35));
      g.addColorStop(1, COLORS[tier]);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.05);
      ctx.strokeStyle = 'rgba(0,0,0,.18)';
      ctx.stroke();
    }
    ctx.font = (r * 1.15) + 'px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = ghost ? alpha * 0.7 : alpha;
    ctx.fillText(EMOJI[tier], sx, sy + r * 0.05);
    ctx.restore();
  }

  // -------- render loop --------
  function frame() {
    requestAnimationFrame(frame);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!cfg) return;

    var v = view();
    var t = performance.now();

    ctx.fillStyle = '#1a2030';
    ctx.fillRect(v.ox, v.oy, cfg.w * v.sc, cfg.h * v.sc);
    ctx.strokeStyle = 'rgba(120,140,180,.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(v.ox, v.oy, cfg.w * v.sc, cfg.h * v.sc);

    var ly = v.oy + cfg.lineY * v.sc;
    var pulse = 0.45 + 0.25 * Math.sin(t / 350);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,70,70,' + pulse + ')';
    ctx.lineWidth = 3;
    ctx.setLineDash([16, 12]);
    ctx.beginPath();
    ctx.moveTo(v.ox, ly);
    ctx.lineTo(v.ox + cfg.w * v.sc, ly);
    ctx.stroke();
    ctx.restore();

    balls.forEach(function (bb) {
      bb.x += (bb.tx - bb.x) * 0.35;
      bb.y += (bb.ty - bb.y) * 0.35;
      drawBall(v, bb.x, bb.y, bb.tier, 1, false);
    });

    // 다른 플레이어 조준 + 다음 공(고스트)
    for (var i = 0; i < players.length; i++) {
      var id = players[i][0], ax = players[i][1], tier = players[i][2];
      if (id === net.id) continue;
      var psx = v.ox + ax * v.sc;
      ctx.save();
      ctx.strokeStyle = 'rgba(180,200,255,.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.moveTo(psx, v.oy);
      ctx.lineTo(psx, ly);
      ctx.stroke();
      ctx.restore();
      drawBall(v, ax, cfg.spawnY, tier, 0.7, true);
    }

    // 내 조준 + 고스트 + 쿨다운
    var cd = Math.min(1, (t - lastDropAt) / 600);
    var sx = v.ox + myAim * v.sc;
    ctx.save();
    ctx.strokeStyle = over ? 'rgba(255,90,90,.5)' : 'rgba(120,230,150,' + (0.35 + 0.3 * cd) + ')';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(sx, v.oy);
    ctx.lineTo(sx, ly);
    ctx.stroke();
    ctx.restore();
    drawBall(v, myAim, cfg.spawnY, myTier, cd < 1 ? 0.35 : 0.9, cd < 1);

    if (over) {
      ctx.fillStyle = 'rgba(160,20,20,.18)';
      ctx.fillRect(v.ox, v.oy, cfg.w * v.sc, cfg.h * v.sc);
    }
  }
  requestAnimationFrame(frame);
})();
