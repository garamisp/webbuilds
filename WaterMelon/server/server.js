// 🍉 수박게임 io — 협동 · 권위(authoritative) WebSocket 서버
// 서버가 모든 물리를 단독 계산한다. 클라이언트는 조준/투하 입력만 보내고 상태를 렌더링한다.
// 클라이언트(../)는 GitHub Pages 에, 이 서버는 Railway 에 배포한다. (Venice 컨벤션)
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

// tier 별 반지름 (0..10): 체리 -> ... -> 수박
const RADII = [24, 32, 42, 54, 68, 84, 102, 122, 144, 168, 196];
const MAX_TIER = RADII.length - 1;

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
  if (tier < MAX_TIER) addBall(tier + 1, mx, my, true);
  else score += 200; // 수박 + 수박 = 큰 보너스, 둘 다 사라짐
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
  broadcast({ t: 'gameover', score });
  for (const b of Composite.allBodies(world)) if (b.isBall) Composite.remove(world, b);
  dead.clear();
  ballCount = 0;
  setTimeout(() => { over = false; score = 0; }, RESET_PAUSE_MS);
}

const dtMs = 1000 / TPS;
setInterval(() => {
  Engine.update(engine, dtMs);
  if (!over) processDanger(dtMs);
}, dtMs);

// ------------------------------------------------------------------- http ---
// Railway 에서는 ws 릴레이로만 쓰이고, 로컬/직접접속 시엔 옆 폴더(../)의 클라이언트를
// 그대로 서빙해 단일 오리진으로도 바로 플레이할 수 있게 한다(있을 때만).
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
    res.end(JSON.stringify({ ok: true, balls: ballCount, players: clients.size }));
    return;
  }
  serveStatic(req, res);
});

// -------------------------------------------------------------- websocket ---
const wss = new WebSocketServer({ server });
const clients = new Map(); // ws -> { id, aimX, nextTier, lastDrop }
let pid = 1;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const randTier = () => Math.floor(Math.random() * (SPAWN_TIER_MAX + 1));

function send(ws, obj) { if (ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) {} } }
function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const ws of clients.keys()) if (ws.readyState === 1) { try { ws.send(s); } catch (e) {} }
}

wss.on('connection', (ws) => {
  const st = { id: pid++, aimX: WORLD_W / 2, nextTier: randTier(), lastDrop: 0 };
  clients.set(ws, st);
  send(ws, {
    t: 'welcome', id: st.id, w: WORLD_W, h: WORLD_H, lineY: LINE_Y,
    radii: RADII, maxTier: MAX_TIER, spawnY: SPAWN_Y, tier: st.nextTier,
  });

  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data); } catch (e) { return; }
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
    }
  });

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

// 상태 브로드캐스트
setInterval(() => {
  const b = [];
  for (const body of Composite.allBodies(world)) {
    if (!body.isBall) continue;
    b.push([body.ballId, body.tier, Math.round(body.position.x), Math.round(body.position.y)]);
  }
  const p = [];
  for (const st of clients.values()) p.push([st.id, Math.round(st.aimX), st.nextTier]);
  broadcast({ t: 'state', b, p, s: score, o: over });
}, 1000 / BROADCAST_HZ);

const PORT = process.env.PORT || 8790;
server.listen(PORT, () => console.log(`🍉 Watermelon.io server listening on :${PORT}`));
