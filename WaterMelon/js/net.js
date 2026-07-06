// net.js — 수박게임 io 권위 서버(WebSocket) 클라이언트.
// 서버가 물리를 계산하므로 연결이 없으면 게임을 진행할 수 없다(접속 대기 표시).
(function (global) {
  'use strict';

  // ▼▼▼ Railway 서버 (wss). 배포 후 도메인이 정해지면 여기만 고치면 됨.
  var RAILWAY_URL = 'wss://webbuilds-production-5ab3.up.railway.app';
  // ▲▲▲ 우선순위: ?server= > localStorage('wm_server') > localhost:8790 > RAILWAY_URL

  function resolveUrl() {
    try {
      var q = new URLSearchParams(global.location.search);
      if (q.get('server')) return q.get('server');
    } catch (e) {}
    try {
      var ls = global.localStorage.getItem('wm_server');
      if (ls) return ls;
    } catch (e) {}
    var h = global.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '') return 'ws://localhost:8790';
    return RAILWAY_URL || '';
  }

  function WMNet() {
    var map = {};
    this.on = function (ev, cb) { (map[ev] || (map[ev] = [])).push(cb); return this; };
    this._emit = function (ev, a) { var l = map[ev]; if (l) for (var i = 0; i < l.length; i++) l[i](a); };
    this.ws = null;
    this.connected = false;
    this.id = null;
    this._wantOpen = false;
    this._retry = 0;
  }

  WMNet.prototype.connect = function () {
    var url = resolveUrl();
    if (!url) { this._emit('unavailable'); return false; }
    this._url = url;
    this._wantOpen = true;
    this._open();
    return true;
  };

  WMNet.prototype._open = function () {
    var self = this;
    var ws;
    try { ws = new WebSocket(this._url); }
    catch (e) { this._emit('error', e); this._scheduleRetry(); return; }
    this.ws = ws;

    ws.onopen = function () {
      self.connected = true;
      self._retry = 0;
      self._emit('open');
    };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      switch (m.t) {
        case 'welcome': self.id = m.id; self._emit('welcome', m); break;
        case 'you': self._emit('you', m); break;
        case 'state': self._emit('state', m); break;
        case 'gameover': self._emit('gameover', m); break;
      }
    };
    ws.onclose = function () {
      self.connected = false;
      self._emit('close');
      if (self._wantOpen) self._scheduleRetry();
    };
    ws.onerror = function (e) { self._emit('error', e); };
  };

  WMNet.prototype._scheduleRetry = function () {
    var self = this;
    if (!this._wantOpen) return;
    this._retry = Math.min(this._retry + 1, 6);
    var delay = Math.min(6000, 500 * Math.pow(1.7, this._retry));
    clearTimeout(this._retryT);
    this._retryT = setTimeout(function () { if (self._wantOpen) self._open(); }, delay);
  };

  WMNet.prototype._send = function (obj) {
    if (this.ws && this.connected) { try { this.ws.send(JSON.stringify(obj)); } catch (e) {} }
  };
  WMNet.prototype.sendAim = function (x) { this._send({ t: 'aim', x: x }); };
  WMNet.prototype.sendDrop = function (x) { this._send({ t: 'drop', x: x }); };

  global.WMNet = WMNet;
})(window);
