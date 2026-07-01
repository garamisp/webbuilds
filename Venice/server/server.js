// 타자 아레나 — 중개 서버 (WebSocket relay + 매치메이킹)
// Railway 에 배포. process.env.PORT 로 리슨한다.
'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8787;
const ROOM_CAP = parseInt(process.env.ROOM_CAP || '6', 10); // 방 최대 인원
const AFK_MS = parseInt(process.env.AFK_MS || '20000', 10); // 자리비움 후 제외까지 유예(ms)
const MAX_MSG = 16 * 1024;

// --- 간단 HTTP (헬스체크/안내) ---
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Typing Arena relay server — OK\nrooms: ' + rooms.size + ', clients: ' + clients.size + '\n');
});

const wss = new WebSocketServer({ server });

let nextId = 1;
const clients = new Map();   // id -> client
const rooms = new Map();     // roomId -> { id, members:Set<id> }
let nextRoom = 1;

function send(client, obj) {
  if (client && client.ws.readyState === 1) {
    try { client.ws.send(JSON.stringify(obj)); } catch (e) {}
  }
}
function broadcast(roomId, obj, exceptId) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const mid of room.members) {
    if (mid === exceptId) continue;
    send(clients.get(mid), obj);
  }
}
function roomPeers(roomId, exceptId) {
  const room = rooms.get(roomId);
  const list = [];
  if (!room) return list;
  for (const mid of room.members) {
    if (mid === exceptId) continue;
    const c = clients.get(mid);
    if (c) list.push({ id: c.id, name: c.name });
  }
  return list;
}

// 빈 자리가 있는 방을 찾고, 없으면 새로 만든다 (비공개 클라이언트는 1인 전용 방)
function assignRoom(priv) {
  if (priv) {
    const id = 'p' + (nextRoom++);
    rooms.set(id, { id, members: new Set() });
    return id;
  }
  for (const [id, room] of rooms) {
    if (id[0] === 'p') continue;             // 비공개방 제외
    if (room.members.size < ROOM_CAP) return id;
  }
  const id = 'r' + (nextRoom++);
  rooms.set(id, { id, members: new Set() });
  return id;
}

function joinRoom(client) {
  client.room = assignRoom(client.priv);
  rooms.get(client.room).members.add(client.id);
  send(client, { t: 'welcome', id: client.id, room: client.room, peers: roomPeers(client.room, client.id) });
  broadcast(client.room, { t: 'join', id: client.id, name: client.name }, client.id);
}

function leaveRoom(client) {
  const room = rooms.get(client.room);
  if (!room) return;
  room.members.delete(client.id);
  broadcast(client.room, { t: 'leave', id: client.id });
  if (room.members.size === 0) rooms.delete(client.room);
}

wss.on('connection', (ws) => {
  const client = { id: nextId++, ws, name: '익명', room: null, dead: false, priv: false, hello: false, afkSince: null, alive: true };
  clients.set(client.id, client);
  ws.on('pong', () => { client.alive = true; });

  ws.on('message', (data) => {
    if (data.length > MAX_MSG) return;
    let m;
    try { m = JSON.parse(data.toString()); } catch (e) { return; }
    client.alive = true;

    switch (m.t) {
      case 'hello': {
        if (client.hello) break;
        client.hello = true;
        client.name = String(m.name || '익명').slice(0, 16);
        client.priv = !!m.priv;
        joinRoom(client);
        break;
      }
      case 'afk':
        // 탭 숨김 → 상대에게 자리비움 표시. AFK_MS 지나면 sweep 이 방에서 제외.
        if (client.room && client.afkSince == null) {
          client.afkSince = Date.now();
          broadcast(client.room, { t: 'away', id: client.id }, client.id);
        }
        break;
      case 'back':
        client.afkSince = null;
        if (client.room) broadcast(client.room, { t: 'back', id: client.id }, client.id);
        else if (client.hello) joinRoom(client); // 유예 초과로 제외됐다 복귀 → 새 방 배정
        break;
      case 'ready':
        client.dead = false;
        break;
      case 'attack':
        if (client.room && typeof m.word === 'string' && m.word.length <= 64) {
          broadcast(client.room, { t: 'attack', from: client.id, word: m.word }, client.id);
        }
        break;
      case 'snap':
        if (client.room && m.s) {
          broadcast(client.room, { t: 'snap', from: client.id, s: m.s }, client.id);
        }
        break;
      case 'dead':
        // 패배자만 게임오버. 생존자들에게 알림(이름 포함) → 라이프 보너스는 클라이언트가.
        if (!client.dead) {
          client.dead = true;
          broadcast(client.room, { t: 'dead', id: client.id, name: client.name }, client.id);
        }
        break;
      case 'chat':
        if (client.room && typeof m.text === 'string') {
          broadcast(client.room, { t: 'chat', from: client.id, name: client.name, text: m.text.slice(0, 200) }, client.id);
        }
        break;
    }
  });

  ws.on('close', () => {
    if (client.room) leaveRoom(client);
    clients.delete(client.id);
  });
  ws.on('error', () => {});
});

// 하트비트: pong 없으면 죽은 소켓으로 보고 정리 (탭 종료·OS 절전 등)
setInterval(() => {
  for (const c of clients.values()) {
    if (c.ws.readyState !== 1) continue;
    if (c.alive === false) { try { c.ws.terminate(); } catch (e) {} continue; }
    c.alive = false;
    try { c.ws.ping(); } catch (e) {}
  }
}, 30000);

// 자리비움(afk) 이 유예시간 초과 → 방에서 제외 (상대는 leave 로 인지, 계속 진행)
setInterval(() => {
  const now = Date.now();
  for (const c of clients.values()) {
    if (c.room && c.afkSince != null && now - c.afkSince > AFK_MS) {
      leaveRoom(c);
      c.room = null;
      c.afkSince = null;
    }
  }
}, 5000);

server.listen(PORT, () => {
  console.log('Venice relay listening on :' + PORT + ' (room cap ' + ROOM_CAP + ')');
});
