// 타자 아레나 — 중개 서버 (WebSocket relay + 매치메이킹)
// Railway 에 배포. process.env.PORT 로 리슨한다.
'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8787;
const ROOM_CAP = parseInt(process.env.ROOM_CAP || '6', 10); // 방 최대 인원
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

function leaveRoom(client) {
  const room = rooms.get(client.room);
  if (!room) return;
  room.members.delete(client.id);
  broadcast(client.room, { t: 'leave', id: client.id });
  if (room.members.size === 0) rooms.delete(client.room);
}

wss.on('connection', (ws) => {
  const client = { id: nextId++, ws, name: '익명', room: null, dead: false, priv: false, hello: false };
  clients.set(client.id, client);

  ws.on('message', (data) => {
    if (data.length > MAX_MSG) return;
    let m;
    try { m = JSON.parse(data.toString()); } catch (e) { return; }

    switch (m.t) {
      case 'hello': {
        if (client.hello) break;
        client.hello = true;
        client.name = String(m.name || '익명').slice(0, 16);
        client.priv = !!m.priv;
        client.room = assignRoom(client.priv);
        rooms.get(client.room).members.add(client.id);
        send(client, { t: 'welcome', id: client.id, room: client.room, peers: roomPeers(client.room, client.id) });
        broadcast(client.room, { t: 'join', id: client.id, name: client.name }, client.id);
        break;
      }
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

// keepalive ping (유휴 연결 정리)
setInterval(() => {
  for (const c of clients.values()) {
    if (c.ws.readyState === 1) { try { c.ws.ping(); } catch (e) {} }
  }
}, 30000);

server.listen(PORT, () => {
  console.log('Venice relay listening on :' + PORT + ' (room cap ' + ROOM_CAP + ')');
});
