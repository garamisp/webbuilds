// net.js — Railway 중개 서버(WebSocket) 클라이언트
// 서버가 없거나 연결 실패해도 게임은 솔로로 정상 동작한다.
(function (global) {
  'use strict';

  // ▼▼▼ Railway 중개 서버 (wss). 도메인이 바뀌면 여기만 고치면 됨.
  var RAILWAY_URL = 'wss://webbuilds-production.up.railway.app';
  // ▲▲▲  우선순위: ?server= > localStorage > localhost(로컬 릴레이) > RAILWAY_URL

  function resolveUrl() {
    try {
      var q = new URLSearchParams(global.location.search);
      if (q.get('server')) return q.get('server');
    } catch (e) {}
    try {
      var ls = global.localStorage.getItem('venice_server');
      if (ls) return ls;
    } catch (e) {}
    // 로컬 개발은 로컬 릴레이 우선 (프로덕션 서버 오염 방지)
    var h = global.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '') return 'ws://localhost:8787';
    if (RAILWAY_URL) return RAILWAY_URL;
    return ''; // 미설정 → 솔로 전용
  }

  function emitterMix(obj) {
    var map = {};
    obj.on = function (ev, cb) { (map[ev] || (map[ev] = [])).push(cb); return obj; };
    obj.emit = function (ev, a, b) {
      var l = map[ev]; if (!l) return;
      for (var i = 0; i < l.length; i++) l[i](a, b);
    };
  }

  function VeniceNet() {
    emitterMix(this);
    this.ws = null;
    this.connected = false;
    this.id = null;
    this.peers = {};          // id -> {id, name}
    this._wantOpen = false;
    this._retry = 0;
    this._opts = null;
  }

  VeniceNet.prototype.peerCount = function () {
    return Object.keys(this.peers).length;
  };

  VeniceNet.prototype.connect = function (opts) {
    this._opts = opts || {};
    var url = resolveUrl();
    if (!url) { this.emit('unavailable'); return false; }
    this._url = url;
    this._wantOpen = true;
    this._open();
    return true;
  };

  VeniceNet.prototype._open = function () {
    var self = this;
    var ws;
    try { ws = new WebSocket(this._url); }
    catch (e) { this.emit('error', e); this._scheduleRetry(); return; }
    this.ws = ws;

    ws.onopen = function () {
      self.connected = true;
      self._retry = 0;
      self._send({
        t: 'hello',
        name: self._opts.name || '익명',
        lang: self._opts.lang || 'ko',
        priv: !!self._opts.priv
      });
      self.emit('open');
    };

    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      self._handle(m);
    };

    ws.onclose = function () {
      var was = self.connected;
      self.connected = false;
      self.id = null;
      self.peers = {};
      self.emit('close');
      if (was) self.emit('peerschange', 0);
      if (self._wantOpen) self._scheduleRetry();
    };

    ws.onerror = function (e) { self.emit('error', e); };
  };

  VeniceNet.prototype._scheduleRetry = function () {
    var self = this;
    if (!this._wantOpen) return;
    this._retry = Math.min(this._retry + 1, 6);
    var delay = Math.min(8000, 600 * Math.pow(1.7, this._retry));
    clearTimeout(this._retryT);
    this._retryT = setTimeout(function () { if (self._wantOpen) self._open(); }, delay);
  };

  VeniceNet.prototype._handle = function (m) {
    switch (m.t) {
      case 'welcome':
        this.id = m.id;
        this.peers = {};
        if (m.peers) for (var i = 0; i < m.peers.length; i++) {
          this.peers[m.peers[i].id] = m.peers[i];
        }
        this.emit('welcome', m);
        this.emit('peerschange', this.peerCount());
        break;
      case 'join':
        this.peers[m.id] = { id: m.id, name: m.name };
        this.emit('join', m);
        this.emit('peerschange', this.peerCount());
        break;
      case 'leave':
        delete this.peers[m.id];
        this.emit('leave', m);
        this.emit('peerschange', this.peerCount());
        break;
      case 'attack':
        this.emit('attack', m);    // {from, word}
        break;
      case 'snap':
        this.emit('snap', m);      // {from, s}
        break;
      case 'dead':
        this.emit('peerdead', m);  // {id, name} — 상대가 게임오버됨
        break;
      case 'chat':
        this.emit('chat', m);      // {from, name, text}
        break;
    }
  };

  VeniceNet.prototype._send = function (obj) {
    if (this.ws && this.connected) {
      try { this.ws.send(JSON.stringify(obj)); } catch (e) {}
    }
  };

  VeniceNet.prototype.sendReady = function () { this._send({ t: 'ready' }); };
  VeniceNet.prototype.sendAttack = function (word) { this._send({ t: 'attack', word: word }); };
  VeniceNet.prototype.sendSnap = function (s) { this._send({ t: 'snap', s: s }); };
  VeniceNet.prototype.sendDead = function () { this._send({ t: 'dead' }); };
  VeniceNet.prototype.sendChat = function (text) { this._send({ t: 'chat', text: text }); };

  VeniceNet.prototype.disconnect = function () {
    this._wantOpen = false;
    clearTimeout(this._retryT);
    if (this.ws) { try { this.ws.close(); } catch (e) {} }
    this.connected = false;
    this.peers = {};
    this.id = null;
  };

  global.VeniceNet = VeniceNet;
  global.VENICE_RESOLVE_URL = resolveUrl;
})(window);
