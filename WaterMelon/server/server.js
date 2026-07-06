// 🍉 수박게임 io — 협동 · 권위(authoritative) WebSocket 서버
// 서버가 모든 물리를 단독 계산한다. 클라이언트는 조준/투하 입력만 보내고 상태를 렌더링한다.
// 상시 AI 봇 + 채팅 + 수박 완성(날아가기) 포함. 클라(../)는 GitHub Pages, 서버는 Railway. (Venice 컨벤션)
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Matter = require('matter-js');

const { Engine, Bodies, Body, Composite, Events } = Matter;

// ----------------------------------------------------------------- config ---
const WORLD_W = 1800;          // 가로로 넓은 io 필드
const WORLD_H = 900;
const LINE_Y = 150;            // 경계선(월드 y). 이 위 = 위험 구역.
const WALL = 120;
const SPAWN_Y = 64;            // 투하된 공이 생성되는 높이(경계선 위)
const TPS = 60;                // 물리 틱/초
const BROADCAST_HZ = 30;       // 상태 전송/초

const DROP_COOLDOWN_MS = 600;  // 플레이어별 투하 쿨다운
const SPAWN_GRACE_MS = 1600;   // 갓 생성된 공은 이 시간 동안 게임오버 유발 불가
const SETTLE_SPEED = 1.4;      // body.speed 가 이 값 미만이면 "멈춘 것"으로 간주
const DANGER_HOLD_MS = 2000;   // 멈춘 채 경계선 위에 이만큼 지속되면 게임오버
const MAX_BODIES = 340;        // 안전 상한
const SPAWN_TIER_MAX = 4;      // 플레이어는 tier 0..4 를 떨어뜨림
const RESET_PAUSE_MS = 2600;

const BOT_COUNT = parseInt(process.env.BOT_COUNT || '3', 10);   // 상시 봇 수
const CHAT_MAX = 120;          // 채팅 최대 길이
const CHAT_MIN_GAP_MS = 500;   // 채팅 최소 간격/인당

// tier 별 반지름 (0..10): 체리 -> ... -> 멜론 -> 수박
const RADII = [24, 32, 42, 54, 68, 84, 102, 122, 144, 168, 196];
const MAX_TIER = RADII.length - 1;   // 10 = 수박. 수박은 완성 즉시 날아가므로 필드엔 tier 9까지만 남는다.

// ---------------------------------------------------------------- physics ---
const engine = Engine.create();
engine.gravity.y = 1.1;
const world = engine.world;

function makeWall(x, y, w, h) {
  return Bodies.rectangle(x, y, w, h, { isStatic: true, friction: 0.6 });
}
Composite.add(world, [
  makeWall(WORLD_W / 2, WORLD_H + WALL / 2, WORLD_W + WALL * 2, WALL), // 바닥
  makeWall(-WALL / 2, WORLD_H / 2, WALL, WORLD_H * 3),                 // 좌
  makeWall(WORLD_W + WALL / 2, WORLD_H / 2, WALL, WORLD_H * 3),        // 우
]);

let ballSeq = 1;
let ballCount = 0;
let score = 0;
let watermelons = 0;   // 이번 판 완성한 수박 개수
let over = false;
const dead = new Set();

function addBall(tier, x, y, popUp) {
  const r = RADII[tier];
  const b = Bodies.circle(x, y, r, {
    restitution: 0.05, friction: 0.5, frictionStatic: 0.8, density: 0.0012, slop: 0.02,
  });
  b.ballId = ballSeq++;
  b.tier = tier;
  b.isBall = true;
  b.spawnAt = Date.now();
  b.dangerMs = 0;
  Composite.add(world, b);
  ballCount++;
  if (popUp) Body.setVelocity(b, { x: (Math.random() - 0.5) * 2, y: -2.4 });
  return b;
}

function killBall(b) {
  if (dead.has(b.ballId)) return;
  dead.add(b.ballId);
  Composite.remove(world, b);
  ballCount--;
}

function mergePair(a, b) {
  const tier = a.tier;
  const mx = (a.position.x + b.position.x) / 2;
  const my = (a.position.y + b.position.y) / 2;
  killBall(a);
  killBall(b);
  score += (tier + 1) * 3;
  if (tier + 1 < MAX_TIER) {
    addBall(tier + 1, mx, my, true);
  } else {
    // 멜론(tier 9) 둘이 합쳐져 수박 완성! 수박은 필드에 남기지 않고 날려보낸다(무한 플레이).
    watermelons++;
    score += 300;
    broadcast({ t: 'watermelon', x: Math.round(mx), y: Math.round(my), count: watermelons });
  }
}

Events.on(engine, 'collisionStart', (evt) => {
  for (const pair of evt.pairs) {
    const a = pair.bodyA, b = pair.bodyB;
    if (!a.isBall || !b.isBall) continue;
    if (a.tier !== b.tier) continue;
    if (dead.has(a.ballId) || dead.has(b.ballId)) continue;
    mergePair(a, b);
  }
});

// 게임오버: 공이 "멈춘 채(settled)" 경계선 위로 삐져나온 상태가 DANGER_HOLD_MS 동안
// 연속될 때만. 갓 떨어진 공(유예)과 충돌로 빠르게 움직이는 공(넉백)은 절대 유발하지 않는다.
function processDanger(dtMs) {
  const now = Date.now();
  for (const b of Composite.allBodies(world)) {
    if (!b.isBall) continue;
    if (now - b.spawnAt < SPAWN_GRACE_MS) { b.dangerMs = 0; continue; }
    const top = b.position.y - RADII[b.tier];
    if (b.speed < SETTLE_SPEED && top < LINE_Y) {
      b.dangerMs += dtMs;
      if (b.dangerMs >= DANGER_HOLD_MS) { triggerGameOver(); return; }
    } else {
      b.dangerMs = 0;
    }
  }
}

function triggerGameOver() {
  over = true;
  broadcast({ t: 'gameover', score, watermelons });
  for (const b of Composite.allBodies(world)) if (b.isBall) Composite.remove(world, b);
  dead.clear();
  ballCount = 0;
  setTimeout(() => { over = false; score = 0; watermelons = 0; }, RESET_PAUSE_MS);
}

const dtMs = 1000 / TPS;
function stepPhysics() {
  Engine.update(engine, dtMs);
  if (!over) processDanger(dtMs);
}

// ---- 유휴 절전: 접속자가 0명이면 물리/봇/브로드캐스트 루프를 멈춰 CPU를 아낀다.
//      첫 접속 시 깨어나 새 판을 시작하고, 마지막 접속자가 나가면 다시 멈춘다.
let running = false;
let physTimer = null, botTimer = null, castTimer = null;

function clearField() {
  for (const b of Composite.allBodies(world)) if (b.isBall) Composite.remove(world, b);
  dead.clear();
  ballCount = 0; score = 0; watermelons = 0; over = false;
}
function startLoops() {
  if (running) return;
  running = true;
  clearField();
  physTimer = setInterval(stepPhysics, dtMs);
  botTimer = setInterval(botTick, 60);
  castTimer = setInterval(broadcastState, 1000 / BROADCAST_HZ);
  console.log('▶ 플레이어 접속 — 게임 루프 시작');
}
function stopLoops() {
  if (!running) return;
  running = false;
  clearInterval(physTimer); clearInterval(botTimer); clearInterval(castTimer);
  physTimer = botTimer = castTimer = null;
  clearField();
  console.log('⏸ 접속자 0명 — 게임 루프 정지(절전)');
}

// -------------------------------------------------------------- helpers ---
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const randTier = () => Math.floor(Math.random() * (SPAWN_TIER_MAX + 1));

function sanitizeText(s, max) {
  if (typeof s !== 'string') return '';
  // 제어문자 제거 + 공백 정리 + 길이 제한 (유니코드/한글은 그대로 유지)
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// ------------------------------------------------------------------ bots ---
const BOT_NAMES = ['🤖 멜론봇', '🤖 수박이', '🤖 통통이', '🤖 데굴이', '🤖 말랑이'];
const BOT_CHATTER = ['오 좋은데?', '여기 합치자', '🍉!', '굿굿', '나이스~', '합쳐졌다!', '조심조심', '자리 좀 비켜줄래', 'ㅎㅎ'];
let lastBotChatAt = 0;

const bots = [];
for (let i = 0; i < BOT_COUNT; i++) {
  const x0 = (WORLD_W * (i + 1)) / (BOT_COUNT + 1);
  bots.push({
    id: -(i + 1),                 // 봇은 음수 id (사람과 구분)
    isBot: true,
    name: BOT_NAMES[i % BOT_NAMES.length],
    aimX: x0,
    nextTier: randTier(),
    lastDrop: 0,
    cooldown: 900 + Math.random() * 500,
    target: x0,
    safe: true,
    nextThinkAt: 0,
  });
}

// 낙하 예측(레이캐스트): x 에 반지름 r 공을 떨구면 어디에 멈추고 무엇 위에 얹히는지
function predictLanding(x, r, ballsArr) {
  let restY = WORLD_H - r;   // 바닥
  let supTier = -1;
  for (let i = 0; i < ballsArr.length; i++) {
    const b = ballsArr[i];
    const br = RADII[b.tier];
    const sum = r + br;
    const dx = b.position.x - x;
    if (dx < sum && dx > -sum) {
      const dy = Math.sqrt(sum * sum - dx * dx);
      const cy = b.position.y - dy;   // 이 공 위에 얹혔을 때 내 중심 y
      if (cy < restY) { restY = cy; supTier = b.tier; }
    }
  }
  return { restY, supTier };
}

// 봇의 목표 x 선택: 합치기 우선 + 위험 회피 + 사람/봇 자리 회피 + 낮은 곳 선호
function botChoose(bot, ballsArr, parts) {
  const T = bot.nextTier;
  const r = RADII[T];
  let bestX = bot.aimX, bestS = -Infinity, bestOk = false;
  for (let x = r + 6; x <= WORLD_W - r - 6; x += 22) {
    const L = predictLanding(x, r, ballsArr);
    const isMerge = (L.supTier === T);              // 같은 등급 위 → 즉시 합치기
    const landsSafe = L.restY > LINE_Y + r * 2.2;   // 낮고 안전한 자리
    // 합치기는 공간을 오히려 비우므로 높이와 무관하게 허용. 그 외엔 안전한 자리만.
    const ok = isMerge || landsSafe;
    let s = 0;
    if (isMerge) s += 1600;                         // 합치기 최우선 (꽉 찼을 때 특히 중요)
    else if (L.supTier === T - 1) s += 130;         // 다음 합치기 준비에 유리
    s += L.restY * 0.7;                             // 낮게 쌓이는 곳 선호(계곡 메우기)
    if (!ok) s -= 4000;                             // 합치기도 안전지대도 아니면 회피
    for (let k = 0; k < parts.length; k++) {
      const o = parts[k];
      if (o === bot) continue;
      const d = Math.abs(o.aimX - x);
      const claim = o.isBot ? 55 : 150;             // 사람 자리는 더 넓게 회피
      if (d < claim) s -= (o.isBot ? 180 : 800) * (1 - d / claim);
    }
    s += Math.random() * 40;                        // 살짝 흔들어 자연스럽게/분산
    if (s > bestS) { bestS = s; bestX = x; bestOk = ok; }
  }
  return { x: bestX, safe: bestOk };
}

function maybeBotChat(bot) {
  const now = Date.now();
  if (now - lastBotChatAt < 6000) return;           // 봇 채팅 전역 쿨다운
  if (Math.random() > 0.04) return;                 // 드물게만
  lastBotChatAt = now;
  pushChat(bot.name, BOT_CHATTER[Math.floor(Math.random() * BOT_CHATTER.length)], true);
}

function botTick() {
  if (bots.length === 0) return;
  const now = Date.now();
  const ballsArr = [];
  for (const b of Composite.allBodies(world)) if (b.isBall) ballsArr.push(b);
  const parts = [];
  for (const st of clients.values()) parts.push(st);
  for (const bt of bots) parts.push(bt);

  for (const bot of bots) {
    if (now >= bot.nextThinkAt) {
      const res = botChoose(bot, ballsArr, parts);
      bot.target = res.x;
      bot.safe = res.safe;
      bot.nextThinkAt = now + 350 + Math.random() * 300;
    }
    const dx = bot.target - bot.aimX;      // 커서를 목표로 부드럽게 이동
    const step = 30;
    bot.aimX = clamp(Math.abs(dx) < step ? bot.target : bot.aimX + Math.sign(dx) * step, 0, WORLD_W);

    if (!over && bot.safe && Math.abs(bot.aimX - bot.target) < 14 &&
        now - bot.lastDrop > bot.cooldown && ballCount < MAX_BODIES - 20) {
      const r = RADII[bot.nextTier];
      const px = clamp(bot.aimX, r + 4, WORLD_W - r - 4);
      addBall(bot.nextTier, px, SPAWN_Y);
      bot.lastDrop = now;
      bot.nextTier = randTier();
      bot.cooldown = 850 + Math.random() * 550;
      bot.nextThinkAt = now + 120;
      maybeBotChat(bot);
    }
  }
}

// ------------------------------------------------------------------ chat ---
const chatHistory = [];                  // 최근 메시지 (신규 접속자에게 전달)
function pushChat(name, text, isBot) {
  const msg = { name, text, bot: !!isBot };
  chatHistory.push(msg);
  if (chatHistory.length > 30) chatHistory.shift();
  broadcast({ t: 'chat', name: msg.name, text: msg.text, bot: msg.bot });
}

// ------------------------------------------------------------------- http ---
const CLIENT_ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(CLIENT_ROOT, urlPath));
  if (!filePath.startsWith(CLIENT_ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('🍉 Watermelon.io relay. Connect via WebSocket.');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, running, balls: ballCount, players: clients.size, bots: bots.length, watermelons }));
    return;
  }
  serveStatic(req, res);
});

// -------------------------------------------------------------- websocket ---
const wss = new WebSocketServer({ server });
const clients = new Map(); // ws -> { id, isBot, name, aimX, nextTier, lastDrop, lastChat }
let pid = 1;

function send(ws, obj) { if (ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) {} } }
function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const ws of clients.keys()) if (ws.readyState === 1) { try { ws.send(s); } catch (e) {} }
}

wss.on('connection', (ws) => {
  const id = pid++;
  const st = { id, isBot: false, name: '손님' + id, aimX: WORLD_W / 2, nextTier: randTier(), lastDrop: 0, lastChat: 0 };
  clients.set(ws, st);
  if (clients.size === 1) startLoops();   // 첫 접속자 → 깨우기
  send(ws, {
    t: 'welcome', id, name: st.name, w: WORLD_W, h: WORLD_H, lineY: LINE_Y,
    radii: RADII, maxTier: MAX_TIER, spawnY: SPAWN_Y, tier: st.nextTier,
    wm: watermelons, recent: chatHistory,
  });

  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data.toString('utf8')); } catch (e) { return; }   // 명시적 UTF-8
    const pl = clients.get(ws);
    if (!pl) return;

    if (m.t === 'aim') {
      if (typeof m.x === 'number' && isFinite(m.x)) pl.aimX = clamp(m.x, 0, WORLD_W);
    } else if (m.t === 'drop') {
      if (over) return;
      const now = Date.now();
      if (now - pl.lastDrop < DROP_COOLDOWN_MS) return;
      if (ballCount >= MAX_BODIES) return;
      const tier = pl.nextTier;
      const r = RADII[tier];
      const px = clamp(typeof m.x === 'number' && isFinite(m.x) ? m.x : pl.aimX, r + 4, WORLD_W - r - 4);
      addBall(tier, px, SPAWN_Y);
      pl.lastDrop = now;
      pl.aimX = px;
      pl.nextTier = randTier();
      send(ws, { t: 'you', tier: pl.nextTier, r: RADII[pl.nextTier] });
    } else if (m.t === 'name') {
      const n = sanitizeText(m.name, 16);
      if (n) pl.name = n;
    } else if (m.t === 'chat') {
      const now = Date.now();
      if (now - pl.lastChat < CHAT_MIN_GAP_MS) return;    // 도배 방지
      const text = sanitizeText(m.text, CHAT_MAX);
      if (!text) return;
      pl.lastChat = now;
      pushChat(pl.name, text, false);
    }
  });

  ws.on('close', () => { clients.delete(ws); if (clients.size === 0) stopLoops(); });
  ws.on('error', () => { clients.delete(ws); if (clients.size === 0) stopLoops(); });
});

// 상태 브로드캐스트 (공 + 참가자 커서 + 점수/수박). 참가자 항목: [id, aimX, nextTier, isBot]
function broadcastState() {
  const b = [];
  for (const body of Composite.allBodies(world)) {
    if (!body.isBall) continue;
    b.push([body.ballId, body.tier, Math.round(body.position.x), Math.round(body.position.y)]);
  }
  const p = [];
  for (const st of clients.values()) p.push([st.id, Math.round(st.aimX), st.nextTier, 0]);
  for (const bt of bots) p.push([bt.id, Math.round(bt.aimX), bt.nextTier, 1]);
  broadcast({ t: 'state', b, p, s: score, o: over, wm: watermelons });
}

const PORT = process.env.PORT || 8790;
server.listen(PORT, () => console.log(`🍉 Watermelon.io server listening on :${PORT} (bots: ${bots.length}, idle-sleep on)`));
