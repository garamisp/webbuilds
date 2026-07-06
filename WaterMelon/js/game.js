// game.js — 서버 상태 렌더 + 조준/투하 입력 + 채팅. 물리는 서버가 담당.
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
  var elMelons = document.getElementById('melons');
  var elConn = document.getElementById('conn');
  var overlay = document.getElementById('overlay');
  var elOverScore = document.getElementById('over-score');

  var chatlog = document.getElementById('chatlog');
  var chatinput = document.getElementById('chatinput');
  var chatname = document.getElementById('chatname');
  var chatsend = document.getElementById('chatsend');

  var cfg = null;               // { w, h, lineY, radii, maxTier, spawnY }
  var balls = new Map();        // id -> { tier, x, y, tx, ty }
  var players = [];             // [ [id, aimX, tier, isBot] ]
  var flyaways = [];            // 수박 완성 연출
  var score = 0, melons = 0, over = false;
  var myName = '';
  var myAim = 900, myTier = 0;
  var lastDropAt = -9999;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var afkMode = false, pausedMode = false;   // 자리비움/탭숨김으로 연결 종료됨

  // -------- net --------
  net.on('open', function () { elConn.textContent = '🟢 접속됨'; afkMode = false; pausedMode = false; });
  net.on('close', function () { if (!afkMode && !pausedMode) elConn.textContent = '🔴 재연결 중…'; });
  net.on('error', function () { if (!afkMode && !pausedMode) elConn.textContent = '🟠 연결 오류'; });
  net.on('unavailable', function () { elConn.textContent = '서버 미설정'; });
  net.on('afk', function () { afkMode = true; elConn.textContent = '💤 자리비움 — 클릭해 재접속'; });
  net.on('paused', function () { pausedMode = true; elConn.textContent = '⏸ 탭 나감 — 돌아오면 자동 재접속'; });

  function resumeIfPaused() {
    if (afkMode || pausedMode) { afkMode = false; pausedMode = false; elConn.textContent = '연결 중…'; net.resume(); return true; }
    return false;
  }

  net.on('welcome', function (m) {
    cfg = m;
    myAim = m.w / 2;
    myTier = m.tier;
    melons = m.wm || 0;
    elMelons.textContent = '🍉 ' + melons;
    myName = m.name || '';
    if (chatname && !chatname.value) chatname.value = myName;
    if (m.recent && m.recent.length) {
      for (var i = 0; i < m.recent.length; i++) addChatLine(m.recent[i].name, m.recent[i].text, m.recent[i].bot);
    }
    resize();
  });
  net.on('you', function (m) { myTier = m.tier; });
  net.on('state', function (st) {
    var seen = new Set();
    for (var i = 0; i < st.b.length; i++) {
      var row = st.b[i], id = row[0];
      seen.add(id);
      var bb = balls.get(id);
      if (!bb) balls.set(id, { tier: row[1], x: row[2], y: row[3], tx: row[2], ty: row[3] });
      else { bb.tier = row[1]; bb.tx = row[2]; bb.ty = row[3]; }
    }
    balls.forEach(function (_v, id) { if (!seen.has(id)) balls.delete(id); });
    players = st.p;
    score = st.s;
    over = st.o;
    melons = st.wm || 0;
    elPlayers.textContent = '👥 ' + players.length;
    elScore.textContent = '⭐ ' + score;
    elMelons.textContent = '🍉 ' + melons;
  });
  net.on('gameover', function (g) {
    overlay.classList.remove('hidden');
    elOverScore.textContent = '점수 ' + g.score + ' · 완성한 수박 ' + (g.watermelons || 0) + '개 🍉';
    setTimeout(function () { overlay.classList.add('hidden'); }, 2400);
  });
  net.on('chat', function (m) { addChatLine(m.name, m.text, m.bot); });
  net.on('watermelon', function (m) { spawnFlyaway(m.x, m.y); });

  net.connect();

  // -------- chat --------
  function addChatLine(name, text, isBot) {
    var line = document.createElement('div');
    line.className = 'line' + (isBot ? ' bot' : (name === myName ? ' me' : ''));
    var nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = name + ': ';          // textContent → 한글/이모지 안전, XSS 없음
    var tx = document.createElement('span');
    tx.className = 'tx';
    tx.textContent = text;
    line.appendChild(nm); line.appendChild(tx);
    chatlog.appendChild(line);
    while (chatlog.childNodes.length > 60) chatlog.removeChild(chatlog.firstChild);
    chatlog.scrollTop = chatlog.scrollHeight;
  }
  function sendChatMsg() {
    var t = chatinput.value.trim();
    if (!t) return;
    net.sendChat(t);
    chatinput.value = '';
  }
  chatinput.addEventListener('keydown', function (e) {
    // Enter: 전송 후 게임으로 복귀(blur) → 스페이스바 조작 재개. Esc: 취소하고 복귀.
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendChatMsg(); chatinput.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); chatinput.value = ''; chatinput.blur(); }
  });
  chatsend.addEventListener('click', sendChatMsg);
  chatname.addEventListener('change', function () {
    var n = chatname.value.trim();
    if (n) { myName = n; net.sendName(n); }
  });

  // -------- watermelon fly-away --------
  function spawnFlyaway(x, y) {
    var sparks = [];
    for (var i = 0; i < 10; i++) sparks.push({ a: Math.random() * Math.PI * 2, spd: 120 + Math.random() * 200 });
    flyaways.push({ x: x, y: y, t0: performance.now(), sparks: sparks });
  }

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
  function typingInChat() {
    var a = document.activeElement;
    return a && (a === chatinput || a === chatname);
  }
  var aimPending = false;
  function setAim(clientX) {
    if (!cfg) return;
    myAim = Math.max(0, Math.min(cfg.w, screenToWorldX(clientX)));
    if (!aimPending) { aimPending = true; setTimeout(function () { aimPending = false; net.sendAim(myAim); }, 45); }
  }
  function drop() {
    if (!cfg || over) return;
    lastDropAt = performance.now();
    net.sendDrop(myAim);
  }
  canvas.addEventListener('mousemove', function (e) { setAim(e.clientX); });
  canvas.addEventListener('mousedown', function (e) { if (resumeIfPaused()) return; setAim(e.clientX); drop(); });
  canvas.addEventListener('touchmove', function (e) { setAim(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchstart', function (e) { e.preventDefault(); if (resumeIfPaused()) return; setAim(e.touches[0].clientX); drop(); }, { passive: false });
  window.addEventListener('keydown', function (e) {
    if (typingInChat()) return;                       // 채팅 입력 중이면 게임 단축키 무시
    if (afkMode || pausedMode) { if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); resumeIfPaused(); } return; }
    if (e.code === 'Space') { e.preventDefault(); drop(); }
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); chatinput.focus(); }
  });

  // -------- draw helpers --------
  function lighten(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(r + (255 - r) * amt); g = Math.round(g + (255 - g) * amt); b = Math.round(b + (255 - b) * amt);
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
      ctx.strokeStyle = COLORS[tier]; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]);
    } else {
      var g = ctx.createRadialGradient(sx - r * 0.3, sy - r * 0.3, r * 0.1, sx, sy, r);
      g.addColorStop(0, lighten(COLORS[tier], 0.35)); g.addColorStop(1, COLORS[tier]);
      ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.05); ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.stroke();
    }
    ctx.font = (r * 1.15) + 'px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = ghost ? alpha * 0.7 : alpha;
    ctx.fillText(EMOJI[tier], sx, sy + r * 0.05);
    ctx.restore();
  }

  function drawFlyaways(v, t) {
    var wmTier = cfg.maxTier;               // 수박 = 최고 등급
    for (var i = flyaways.length - 1; i >= 0; i--) {
      var fa = flyaways[i];
      var age = (t - fa.t0) / 1000;
      if (age > 1.95) { flyaways.splice(i, 1); continue; }
      var ox = v.ox + fa.x * v.sc, oy = v.oy + fa.y * v.sc;

      // 완성 순간엔 제자리에서 팡(0~0.6s), 그 뒤 위로 발사
      var lift = Math.max(0, age - 0.6);
      var rise = lift * lift * 760;
      var wy = oy - rise * v.sc;
      var wx = ox + Math.sin(age * 7) * 10 * v.sc;
      var scale;
      if (age < 0.22) scale = 0.45 + (age / 0.22) * 0.75;               // 팝 인 0.45 -> 1.2
      else if (age < 0.6) scale = 1.2 - Math.sin((age - 0.22) / 0.38 * Math.PI) * 0.08; // 살짝 출렁
      else scale = Math.max(0.32, 1.12 - (age - 0.6) / 1.35 * 0.8);     // 날아가며 축소
      var alpha = age < 1.4 ? 1 : Math.max(0, 1 - (age - 1.4) / 0.55);
      var R = cfg.radii[wmTier] * v.sc * scale;

      // 완성 링 플래시
      if (age < 0.55) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, 0.6 - age);
        ctx.strokeStyle = '#c7f5a0';
        ctx.lineWidth = 5 * v.sc;
        ctx.beginPath(); ctx.arc(ox, oy, R * (1 + age * 2.6), 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      // 반짝이
      ctx.save();
      for (var k = 0; k < fa.sparks.length; k++) {
        var sp = fa.sparks[k];
        var sa = Math.min(1, age / 0.7);
        var px = ox + Math.cos(sp.a) * sp.spd * age * v.sc;
        var py = oy + Math.sin(sp.a) * sp.spd * age * v.sc;
        ctx.globalAlpha = Math.max(0, 1 - sa);
        ctx.fillStyle = k % 2 ? '#ffe27a' : '#8fe0a0';
        ctx.beginPath(); ctx.arc(px, py, Math.max(1.5, 6 * v.sc) * (1 - sa * 0.6), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      // 거대한 둥근 수박 (필드 공과 같은 그라데이션 스타일)
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(wx, wy);
      ctx.rotate(lift * 2.0);               // 날아갈 때만 회전
      var g = ctx.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R);
      g.addColorStop(0, lighten(COLORS[wmTier], 0.35));
      g.addColorStop(1, COLORS[wmTier]);
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = Math.max(1, R * 0.05); ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.stroke();
      ctx.font = (R * 1.15) + 'px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(EMOJI[wmTier], 0, R * 0.05);
      ctx.restore();
      // "수박 완성! +1"
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - age / 1.2);
      ctx.fillStyle = '#ffd76b';
      ctx.font = 'bold ' + (32 * v.sc) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🍉 수박 완성! +1', ox, oy - cfg.radii[wmTier] * 0.75 * v.sc - age * 50 * v.sc);
      ctx.restore();
    }
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
    ctx.lineWidth = 3; ctx.setLineDash([16, 12]);
    ctx.beginPath(); ctx.moveTo(v.ox, ly); ctx.lineTo(v.ox + cfg.w * v.sc, ly); ctx.stroke();
    ctx.restore();

    balls.forEach(function (bb) {
      bb.x += (bb.tx - bb.x) * 0.35;
      bb.y += (bb.ty - bb.y) * 0.35;
      drawBall(v, bb.x, bb.y, bb.tier, 1, false);
    });

    // 다른 참가자(사람/봇) 조준 + 다음 공(고스트)
    for (var i = 0; i < players.length; i++) {
      var pid = players[i][0], ax = players[i][1], tier = players[i][2], isBot = players[i][3];
      if (pid === net.id) continue;
      var psx = v.ox + ax * v.sc;
      ctx.save();
      ctx.strokeStyle = isBot ? 'rgba(255,180,80,.28)' : 'rgba(180,200,255,.25)';
      ctx.lineWidth = 1; ctx.setLineDash([4, 8]);
      ctx.beginPath(); ctx.moveTo(psx, v.oy); ctx.lineTo(psx, ly); ctx.stroke();
      ctx.restore();
      drawBall(v, ax, cfg.spawnY, tier, 0.7, true);
      if (isBot) {
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.font = (18 * v.sc + 6) + 'px serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText('🤖', psx, v.oy + cfg.spawnY * v.sc - cfg.radii[tier] * v.sc - 4);
        ctx.restore();
      }
    }

    // 내 조준 + 고스트 + 쿨다운
    var cd = Math.min(1, (t - lastDropAt) / 600);
    var sx = v.ox + myAim * v.sc;
    ctx.save();
    ctx.strokeStyle = over ? 'rgba(255,90,90,.5)' : 'rgba(120,230,150,' + (0.35 + 0.3 * cd) + ')';
    ctx.lineWidth = 2; ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.moveTo(sx, v.oy); ctx.lineTo(sx, ly); ctx.stroke();
    ctx.restore();
    drawBall(v, myAim, cfg.spawnY, myTier, cd < 1 ? 0.35 : 0.9, cd < 1);

    drawFlyaways(v, t);

    if (over) {
      ctx.fillStyle = 'rgba(160,20,20,.18)';
      ctx.fillRect(v.ox, v.oy, cfg.w * v.sc, cfg.h * v.sc);
    }
  }
  requestAnimationFrame(frame);
})();
