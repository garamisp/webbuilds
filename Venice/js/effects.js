// effects.js — 파티클/연출 시스템 (단어 파괴, 물보라, 데미지 플래시)
(function (global) {
  'use strict';

  function rand(a, b) { return a + Math.random() * (b - a); }

  function Particles() {
    this.list = [];
  }

  // 단어 파괴 폭발: 글자가 흩어지며 터지는 느낌
  Particles.prototype.burst = function (x, y, color, text) {
    var n = 14 + Math.min(20, (text ? text.length : 3) * 3);
    for (var i = 0; i < n; i++) {
      var ang = rand(0, Math.PI * 2);
      var spd = rand(60, 320);
      this.list.push({
        x: x, y: y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - rand(20, 80),
        life: rand(0.4, 0.9), max: 0.9,
        size: rand(2, 5),
        color: color || '#ffd166',
        g: 520,
        glyph: null
      });
    }
    // 부서지는 글자 조각
    if (text) {
      for (var c = 0; c < text.length; c++) {
        var a2 = rand(-Math.PI, 0);
        this.list.push({
          x: x + rand(-18, 18), y: y,
          vx: Math.cos(a2) * rand(40, 180),
          vy: -rand(120, 280),
          life: rand(0.6, 1.0), max: 1.0,
          size: rand(14, 20),
          color: '#ffffff',
          g: 700,
          rot: rand(-3, 3), vr: rand(-6, 6), r: 0,
          glyph: text[c]
        });
      }
    }
  };

  // 바닥(물)에 단어가 닿았을 때 물보라
  Particles.prototype.splash = function (x, y, color) {
    var n = 22;
    for (var i = 0; i < n; i++) {
      this.list.push({
        x: x + rand(-14, 14), y: y,
        vx: rand(-160, 160),
        vy: -rand(120, 420),
        life: rand(0.5, 1.0), max: 1.0,
        size: rand(2, 5),
        color: color || '#7ec8ff',
        g: 900,
        glyph: null
      });
    }
  };

  Particles.prototype.update = function (dt) {
    var L = this.list;
    for (var i = L.length - 1; i >= 0; i--) {
      var p = L[i];
      p.life -= dt;
      if (p.life <= 0) { L.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.vr) { p.r += p.vr * dt; }
    }
  };

  Particles.prototype.draw = function (ctx) {
    var L = this.list;
    for (var i = 0; i < L.length; i++) {
      var p = L[i];
      var alpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.globalAlpha = alpha;
      if (p.glyph) {
        ctx.save();
        ctx.translate(p.x, p.y);
        if (p.r) ctx.rotate(p.r);
        ctx.fillStyle = p.color;
        ctx.font = '700 ' + p.size + 'px ' + VeniceFX.FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.glyph, 0, 0);
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  };

  Particles.prototype.clear = function () { this.list.length = 0; };

  global.VeniceFX = {
    FONT: '"Pretendard","Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif',
    Particles: Particles
  };
})(window);
