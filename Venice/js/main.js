// main.js — UI / 입력(IME) / 네트워크 연결 / 상대 미니뷰 / 채팅
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var canvas = $('game');
  var typeInput = $('typeInput');
  var typeRow = $('typeRow');
  var fireBtn = $('fireBtn');
  var chatInput = $('chatInput');
  var modeBadge = $('modeBadge');
  var levelVal = $('levelVal');
  var scoreVal = $('scoreVal');
  var heartsEl = $('hearts');
  var oppEl = $('opponents');
  var chatLog = $('chatLog');
  var netDot = $('netDot');
  var netLabel = $('netLabel');
  var startOverlay = $('startOverlay');
  var overOverlay = $('overOverlay');
  var skillBtn = $('skillBtn');
  var skillCount = $('skillCount');
  var skillBar = $('skillBar');
  var skillModal = $('skillModal');
  var skillInput = $('skillInput');
  var skillHint = $('skillHint');

  var game = new VeniceGame(canvas);
  var net = new VeniceNet();

  var settings = {
    name: (function () { try { return localStorage.getItem('venice_nick') || ''; } catch (e) { return ''; } })(),
    lang: (function () { try { return localStorage.getItem('venice_lang') || 'ko'; } catch (e) { return 'ko'; } })(),
    pub: true
  };

  var opponents = {}; // id -> {card, canvas, ctx, snap, name, dead}
  var resultShown = false;
  var skillOpen = false;

  // ---------- 라이프(하트) ----------
  function buildHearts() {
    heartsEl.innerHTML = '';
    for (var i = 0; i < VeniceGame.MAX_LIFE; i++) {
      var d = document.createElement('div');
      d.className = 'h';
      heartsEl.appendChild(d);
    }
  }
  function renderHearts(life) {
    var hs = heartsEl.children;
    for (var i = 0; i < hs.length; i++) {
      hs[i].className = 'h' + (i < life ? '' : ' off');
    }
  }

  // ---------- 게임 이벤트 ----------
  game.on('life', renderHearts);
  game.on('score', function (s) { scoreVal.textContent = s; });
  game.on('level', function (l) { levelVal.textContent = l; });
  game.on('mode', function (m) {
    if (m === 'battle') { modeBadge.textContent = '대결'; modeBadge.className = 'badge battle'; }
    else { modeBadge.textContent = '혼자'; modeBadge.className = 'badge'; }
  });
  game.on('clear', function (word) {
    if (net.connected) net.sendAttack(word);
  });
  game.on('dead', function () {
    if (net.connected) net.sendDead();  // 상대들에게 통지 (그들은 계속 + 라이프 보너스)
    sysMsg('당신의 도시가 수몰되었습니다.');
  });
  game.on('gameover', function (info) {
    var battle = info && info.mode === 'battle';
    showResult('수몰… 게임 오버', battle ? '다시 도전하세요! 상대는 계속 싸우고 있습니다.' : '도시가 수몰되었습니다.', info);
  });
  game.on('skill', updateSkillUI);
  game.on('heal', function () { toast('🎯 10개 파괴! 라이프 +1 ❤'); });

  // ---------- 스페셜 스킬: 단어 발사 ----------
  function updateSkillUI(st) {
    st = st || game.getSkillState();
    skillCount.textContent = st.charges;
    skillBar.style.width = Math.round(st.progress * 100) + '%';
    var ready = st.ready && canPlay();
    skillBtn.classList.toggle('ready', ready);
    skillBtn.disabled = !ready;
  }
  function openSkill() {
    if (skillOpen || !canPlay() || game.dead || game.skillCharges < 1) return;
    skillOpen = true;
    skillHint.textContent = '';
    skillInput.value = '';
    skillModal.classList.remove('hidden');
    setTimeout(function () { try { skillInput.focus(); } catch (e) {} }, 0);
  }
  function closeSkill() {
    if (!skillOpen) return;
    skillOpen = false;
    skillModal.classList.add('hidden');
    setTimeout(focusType, 0);
  }
  function fireSkill() {
    var raw = skillInput.value.replace(/\s+/g, '');
    if (!raw) { skillHint.textContent = '단어를 입력하세요 (공백 불가).'; return; }
    if (raw.length > 10) { skillHint.textContent = '최대 10자까지!'; return; }
    var word = game.useSkill(raw); // 자신에게 떨어뜨리고 정제된 단어 반환
    if (!word) { skillHint.textContent = '충전이 부족합니다.'; return; }
    if (net.connected) net.sendAttack(word); // 다른 모두에게 발사
    sysMsg('⚡ "' + word + '" 발사! (모두에게 + 나에게도)');
    closeSkill();
  }
  skillBtn.addEventListener('click', openSkill);
  skillInput.addEventListener('input', function () {
    var cleaned = skillInput.value.replace(/\s+/g, '').slice(0, 10);
    if (cleaned !== skillInput.value) skillInput.value = cleaned;
    if (skillHint.textContent) skillHint.textContent = '';
  });
  skillInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); fireSkill(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeSkill(); }
  });
  $('skillFire').addEventListener('click', fireSkill);
  $('skillCancel').addEventListener('click', closeSkill);
  // Tab 으로 스킬 열기 (게임 입력 중에도) / 게임오버 화면에선 Enter 로 재도전
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Tab' && canPlay() && !skillOpen) {
      e.preventDefault();
      openSkill();
    } else if (e.key === 'Enter' && !overOverlay.classList.contains('hidden')) {
      e.preventDefault();
      $('restartBtn').click();
    }
  });

  // ---------- 입력 (한글 IME) ----------
  // 입력 중에는 강조만 (자동 파괴 없음). 파괴는 발사(Enter 또는 발사 버튼)로만.
  function onType() { game.setTyped(typeInput.value); }
  typeInput.addEventListener('input', onType);
  typeInput.addEventListener('compositionend', onType);

  function fireWord() {
    var v = typeInput.value;
    var had = v.trim().length > 0;
    game.tryMatch(v);            // 일치하면 발사(파괴)
    typeInput.value = '';        // 무조건 비움 → 오타는 발사로 즉시 정리 후 재입력
    game.setTyped('');
    if (had) firePulse();        // 발사 연출
  }
  typeInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); fireWord(); }
    else if (e.key === 'Escape') { typeInput.value = ''; game.setTyped(''); }
  });
  // 모바일: 키패드에 엔터가 없으니 발사 버튼으로. 포커스 뺏기지 않게 pointerdown 막음(키보드 유지).
  fireBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); });
  fireBtn.addEventListener('click', function () { fireWord(); focusType(); });
  function firePulse() {
    typeRow.classList.remove('fire');
    void typeRow.offsetWidth;    // 리플로우로 애니메이션 재시작
    typeRow.classList.add('fire');
  }

  function canPlay() {
    return startOverlay.classList.contains('hidden') &&
           overOverlay.classList.contains('hidden');
  }
  function focusType() { if (canPlay() && !skillOpen) try { typeInput.focus(); } catch (e) {} }
  typeInput.addEventListener('blur', function () {
    setTimeout(function () {
      if (canPlay() && !skillOpen && document.activeElement !== chatInput &&
          document.activeElement !== skillInput) focusType();
    }, 30);
  });
  canvas.addEventListener('pointerdown', focusType);
  window.addEventListener('focus', focusType);

  // ---------- 네트워크 ----------
  function setNet(on, label) {
    netDot.className = 'dot' + (on ? '' : ' off');
    netLabel.textContent = label;
  }

  net.on('open', function () { setNet(true, '대기 중 (공개방)'); });
  net.on('close', function () { setNet(false, '오프라인 (혼자)'); });
  net.on('unavailable', function () { setNet(false, '서버 미설정 (혼자)'); });

  net.on('welcome', function (m) {
    rebuildOpponents();
  });
  net.on('join', function (m) {
    sysMsg(m.name + ' 님이 입장했습니다.');
    addOpponent(m.id, m.name);
  });
  net.on('leave', function (m) {
    var o = opponents[m.id];
    sysMsg((o ? o.name : '상대') + ' 님이 퇴장했습니다.');
    removeOpponent(m.id);
  });
  net.on('peerschange', function (count) {
    updateNetLabel(count);
    // 솔로 ↔ 대결 전환
    if (count > 0 && game.mode === 'solo' && canPlay()) {
      sysMsg('대결 시작! 레벨이 초기화됩니다.');
      game.startBattle();
      net.sendReady();
    } else if (count === 0 && game.mode === 'battle') {
      if (resultShown) { /* 결과 화면 중 — '다시 시작' 버튼이 처리 */ }
      else if (game.dead) { sysMsg('상대 이탈 — 혼자 모드로 재시작합니다.'); game.startSolo(); }
      else { sysMsg('상대가 모두 떠나 혼자 모드로 전환합니다.'); game.toSolo(); }
    }
  });
  net.on('attack', function (m) {
    game.receiveAttack(m.word);
  });
  net.on('snap', function (m) {
    var o = opponents[m.from];
    if (!o) o = addOpponent(m.from, '상대');
    o.snap = m.s;
    if (m.s && typeof m.s.level === 'number') {
      o.lvEl.textContent = 'LV' + m.s.level;
      o.card.classList.toggle('dead', !!m.s.dead);
    }
    drawOpp(o);
  });
  // 상대가 게임오버됨 → 나(생존자)는 계속 플레이 + 라이프 +1 보너스
  net.on('peerdead', function (m) {
    var o = opponents[m.id];
    var nm = (o && o.name) || m.name || '상대';
    if (o) o.card.classList.add('dead');
    var healed = game.addLife(1);
    toast('☠ ' + nm + ' 게임오버!' + (healed ? '  라이프 +1 ❤' : ''));
    sysMsg(nm + ' 님이 수몰되었습니다. ' + (healed ? '(생존 보너스 라이프 +1)' : ''));
  });
  net.on('chat', function (m) { chatMsg(m.name, m.text); });

  function updateNetLabel(count) {
    if (!net.connected) return;
    setNet(true, count > 0 ? (count + '명과 대결 중') : '대기 중 (공개방)');
  }

  // 스냅샷 송신 + 스킬 UI 갱신 루프
  setInterval(function () {
    updateSkillUI();
    if (net.connected && game.mode === 'battle') {
      net.sendSnap(game.getSnapshot());
    }
  }, 130);

  // ---------- 상대 미니뷰 ----------
  function emptyHint() {
    if (Object.keys(opponents).length === 0) {
      oppEl.innerHTML = '<div class="opp-empty">상대 대기 중…<br/>공개방에 누군가 들어오면<br/>여기에 표시됩니다.</div>';
    } else {
      var e = oppEl.querySelector('.opp-empty');
      if (e) e.remove();
    }
  }
  function addOpponent(id, name) {
    if (opponents[id]) return opponents[id];
    var card = document.createElement('div');
    card.className = 'opp';
    var nm = document.createElement('div'); nm.className = 'name';
    var nameSpan = document.createElement('span'); nameSpan.textContent = name || '상대';
    var lvSpan = document.createElement('span'); lvSpan.className = 'lv'; lvSpan.textContent = 'LV1';
    nm.appendChild(nameSpan); nm.appendChild(lvSpan);
    var cv = document.createElement('canvas'); cv.width = 240; cv.height = 280;
    var life = document.createElement('div'); life.className = 'mini-life';
    for (var i = 0; i < VeniceGame.MAX_LIFE; i++) { var bi = document.createElement('i'); life.appendChild(bi); }
    card.appendChild(nm); card.appendChild(cv); card.appendChild(life);
    oppEl.appendChild(card);
    opponents[id] = { card: card, canvas: cv, ctx: cv.getContext('2d'),
      snap: null, name: name || '상대', lvEl: lvSpan, lifeEl: life };
    emptyHint();
    return opponents[id];
  }
  function removeOpponent(id) {
    var o = opponents[id];
    if (o) { o.card.remove(); delete opponents[id]; }
    emptyHint();
  }
  function rebuildOpponents() {
    for (var k in opponents) removeOpponent(k);
    for (var id in net.peers) addOpponent(id, net.peers[id].name);
    emptyHint();
  }

  function drawOpp(o) {
    var ctx = o.ctx, W = o.canvas.width, H = o.canvas.height, s = o.snap;
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0e1530'); sky.addColorStop(1, '#1d3470');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    if (!s) return;
    // 섬
    ctx.fillStyle = '#e2483d';
    ctx.fillRect(W / 2 - 6, H * 0.62, 12, H * 0.3);
    // 물
    var wy = (s.wy || 0.9) * H;
    var g = ctx.createLinearGradient(0, wy, 0, H);
    g.addColorStop(0, 'rgba(60,150,230,0.5)'); g.addColorStop(1, 'rgba(20,60,150,0.85)');
    ctx.fillStyle = g; ctx.fillRect(0, wy, W, H - wy);
    // 단어
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 13px ' + VeniceFX.FONT;
    if (s.words) for (var i = 0; i < s.words.length; i++) {
      var w = s.words[i];
      ctx.fillStyle = w.a ? '#ff8a7a' : '#cfe0ff';
      ctx.fillText(w.t, w.x * W, w.y * H);
    }
    // 라이프 바
    var bars = o.lifeEl.children;
    for (var b = 0; b < bars.length; b++) bars[b].className = (b < (s.life || 0)) ? '' : 'off';
  }

  // ---------- 토스트 (킬 알림 등) ----------
  var toastEl = $('toast');
  var toastT;
  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  // ---------- 채팅 ----------
  function appendChat(html) {
    var d = document.createElement('div');
    d.className = 'msg'; d.innerHTML = html;
    chatLog.appendChild(d);
    chatLog.scrollTop = chatLog.scrollHeight;
    while (chatLog.children.length > 80) chatLog.removeChild(chatLog.firstChild);
  }
  function esc(t) { return String(t).replace(/[<>&]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]; }); }
  function chatMsg(name, text) { appendChat('<span class="who">' + esc(name) + '</span> ' + esc(text)); }
  function sysMsg(text) { appendChat('<span class="sys">' + esc(text) + '</span>'); }

  chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var t = chatInput.value.trim();
      if (t) {
        if (net.connected) net.sendChat(t);
        chatMsg(settings.name || '나', t);
      }
      chatInput.value = '';
      focusType();
    }
  });

  // ---------- 시작 화면 ----------
  (function initStartUI() {
    var nick = $('nickInput');
    nick.value = settings.name;
    // 언어 토글
    var langSeg = $('langSeg');
    Array.prototype.forEach.call(langSeg.children, function (b) {
      b.classList.toggle('on', b.dataset.lang === settings.lang);
      b.addEventListener('click', function () {
        settings.lang = b.dataset.lang;
        Array.prototype.forEach.call(langSeg.children, function (x) { x.classList.toggle('on', x === b); });
      });
    });
    // 모드 토글
    var modeSeg = $('modeSeg');
    Array.prototype.forEach.call(modeSeg.children, function (b) {
      b.addEventListener('click', function () {
        settings.pub = b.dataset.mode === 'public';
        Array.prototype.forEach.call(modeSeg.children, function (x) { x.classList.toggle('on', x === b); });
      });
    });
    $('startBtn').addEventListener('click', function () {
      settings.name = (nick.value || '플레이어').trim().slice(0, 12) || '플레이어';
      try { localStorage.setItem('venice_nick', settings.name); localStorage.setItem('venice_lang', settings.lang); } catch (e) {}
      startGame();
    });
  })();

  function startGame() {
    closeSkill();
    startOverlay.classList.add('hidden');
    overOverlay.classList.add('hidden');
    resultShown = false;
    game.setLang(settings.lang);
    game.startSolo();
    if (settings.pub) {
      net.connect({ name: settings.name, lang: settings.lang, priv: false });
    } else {
      net.disconnect();
      setNet(false, '비공개 (혼자 레벨업)');
    }
    setTimeout(focusType, 50);
  }

  // ---------- 결과 ----------
  function showResult(title, sub, info) {
    if (resultShown) return;
    resultShown = true;
    closeSkill();
    game.stop();
    $('overTitle').textContent = title;
    $('overSub').textContent = sub || '';
    $('overScore').textContent = (info && info.score) || game.score;
    $('overLevel').textContent = (info && info.level) || game.level;
    overOverlay.classList.remove('hidden');
  }
  $('restartBtn').addEventListener('click', function () {
    overOverlay.classList.add('hidden');
    resultShown = false;
    game.setLang(settings.lang);
    if (net.connected && net.peerCount() > 0) { game.startBattle(); net.sendReady(); }
    else game.startSolo();
    setTimeout(focusType, 50);
  });

  // ---------- 리사이즈 ----------
  var rt;
  function scheduleResize() { clearTimeout(rt); rt = setTimeout(function () { game.resize(); }, 120); }
  window.addEventListener('resize', scheduleResize);
  window.addEventListener('orientationchange', scheduleResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleResize);

  // 초기화
  buildHearts();
  renderHearts(VeniceGame.MAX_LIFE);
  emptyHint();

  // 디버그/콘솔 접근용 핸들
  window.Venice = { game: game, net: net, settings: settings };
})();
