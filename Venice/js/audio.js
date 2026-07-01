// audio.js — Web Audio API 합성 효과음 (외부 파일 없음)
// 브라우저 정책상 오디오는 사용자 제스처 후에만 시작 → resume() 를 시작 클릭 등에서 호출.
(function (global) {
  'use strict';

  var ctx = null, master = null, muted = false;
  try { muted = localStorage.getItem('venice_muted') === '1'; } catch (e) {}

  function ensure() {
    if (!ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  // 톤: 주파수 스윕 + 짧은 엔벨로프
  function tone(o) {
    if (muted) return;
    var c = ensure(); if (!c) return;
    var t0 = c.currentTime, dur = o.dur || 0.1;
    var osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + dur);
    var peak = o.gain || 0.15;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  // 노이즈 버스트 (물보라/타격감)
  function noise(dur, peak, cutoff) {
    if (muted) return;
    var c = ensure(); if (!c) return;
    var t0 = c.currentTime, n = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    var src = c.createBufferSource(); src.buffer = buf;
    var g = c.createGain(); g.gain.setValueAtTime(peak || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff || 1200;
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  var api = {
    resume: function () { ensure(); },
    isMuted: function () { return muted; },
    setMuted: function (m) {
      muted = !!m;
      try { localStorage.setItem('venice_muted', muted ? '1' : '0'); } catch (e) {}
      if (master) master.gain.value = muted ? 0 : 1;
      return muted;
    },
    toggle: function () { return api.setMuted(!muted); },

    key: function () { tone({ type: 'square', f0: 300 + Math.random() * 130, f1: 180, dur: 0.03, gain: 0.04 }); },
    hit: function () { tone({ type: 'triangle', f0: 720, f1: 1150, dur: 0.10, gain: 0.16 }); tone({ type: 'sine', f0: 1350, dur: 0.07, gain: 0.05 }); },
    attack: function () { tone({ type: 'sawtooth', f0: 260, f1: 1200, dur: 0.16, gain: 0.11 }); },
    skill: function () { tone({ type: 'sawtooth', f0: 150, f1: 950, dur: 0.28, gain: 0.16 }); tone({ type: 'square', f0: 420, f1: 1500, dur: 0.2, gain: 0.07 }); },
    damage: function () { tone({ type: 'sawtooth', f0: 230, f1: 70, dur: 0.22, gain: 0.17 }); noise(0.18, 0.11, 900); },
    heal: function () { tone({ type: 'sine', f0: 523, dur: 0.12, gain: 0.12 }); setTimeout(function () { tone({ type: 'sine', f0: 784, dur: 0.16, gain: 0.12 }); }, 90); },
    over: function () { tone({ type: 'sawtooth', f0: 420, f1: 80, dur: 0.6, gain: 0.2 }); }
  };

  global.VeniceAudio = api;
})(window);
