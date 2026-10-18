/* Frequency Oasis — MIDI DNA
 * viz-core.js : palette, canvas utilities, tiny 3-D projection, shared render loop with performance + reduced-motion handling.
 * Every visual registered here reads real analysis / transport state (FO.state); none animate on invented data.
 */
(function () {
  'use strict';
  const FO = (globalThis.FO = globalThis.FO || {});

  const PAL = {
    void: '#050507', obsidian: '#08080b', ink: '#0d0d12', graphite: '#15151c', steel: '#23242e', smoke: '#3b3d4a', ash: '#7c7e8d',
    bone: '#ece6d4', gold: '#d4a64a', amber: '#f0c56a', brass: '#a9823a', oxide: '#b4412f', ember: '#e0703f', verdigris: '#6fa095', violet: '#9a8fb3'
  };
  const TRACK_COLORS = ['#d4a64a', '#ece6d4', '#c9763c', '#6fa095', '#9a8fb3', '#c4503e', '#8c9aa8', '#c9b27c', '#7c9a62', '#d98d6c', '#b5a0c8', '#9bb8a6'];
  const trackColor = (i) => TRACK_COLORS[((i % TRACK_COLORS.length) + TRACK_COLORS.length) % TRACK_COLORS.length];

  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const _rgbCache = {};
  function rgba(hex, a) { const c = _rgbCache[hex] || (_rgbCache[hex] = hexToRgb(hex)); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
  function mix(h1, h2, t) { const a = hexToRgb(h1), b = hexToRgb(h2); return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`; }
  /** Pitch class → hue-free colour on the antique palette (gold→copper→verdigris→violet loop) for harmonic displays. */
  const PC_COLORS = ['#e6c35a', '#d98d3c', '#c9663c', '#b4412f', '#a04a62', '#8b5a8a', '#7a6aa8', '#6a85b0', '#6fa0a8', '#6fa095', '#8fae78', '#b9b25c'];
  const pcColor = (pc) => PC_COLORS[((pc % 12) + 12) % 12];

  const perf = {
    reduced: false, lite: false, fpsCap: 60,
    init() {
      try { const mq = matchMedia('(prefers-reduced-motion: reduce)'); this.reduced = mq.matches; mq.addEventListener && mq.addEventListener('change', e => { this.reduced = e.matches; FO.viz.invalidate(); }); } catch (e) {}
      try { const s = JSON.parse(localStorage.getItem('fo-perf') || '{}'); if (s.lite !== undefined) this.lite = !!s.lite; if (s.reduced !== undefined) this.reduced = this.reduced || !!s.reduced; } catch (e) {}
      if (!('lite' in (safeJSON('fo-perf') || {})) && ((navigator.hardwareConcurrency || 4) <= 2 || (navigator.deviceMemory || 4) <= 2 || /Mobi|Android/i.test(navigator.userAgent))) this.lite = true;
    },
    save() { try { localStorage.setItem('fo-perf', JSON.stringify({ lite: this.lite, reduced: this.reduced })); } catch (e) {} },
    get particleScale() { return this.reduced ? 0.25 : this.lite ? 0.4 : 1; }
  };
  function safeJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }

  /** Size a canvas to its CSS box at device resolution. Returns {ctx,w,h,dpr}. */
  function fit(canvas, maxDpr) {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr || (perf.lite ? 1 : 2));
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h, dpr };
  }

  /* ---- 3-D ---- */
  function rotY(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; }
  function rotX(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; }
  function project(p, cam) { const z = p[2] + cam.dist; const k = cam.f / Math.max(0.01, z); return [cam.cx + p[0] * k, cam.cy + p[1] * k, k, z]; }

  /* ---- shared loop ---- */
  const visuals = new Set(); let raf = 0, last = 0, lastDraw = 0, running = false;
  function visible(v) { const c = v.canvas; return c && c.isConnected && c.offsetParent !== null && c.clientWidth > 0; }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const cap = perf.reduced ? 4 : perf.lite ? 30 : 60;
    if (now - lastDraw < 1000 / cap - 2) return;
    const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now; lastDraw = now;
    const playing = FO.state && FO.state.engine && FO.state.engine.playing;
    for (const v of visuals) {
      if (document.hidden || !visible(v)) continue;
      if ((perf.reduced && !playing) && !v.dirty && !v.alwaysStatic) { if (v._drawn) continue; }
      try { v.draw(now / 1000, dt, FO.state); v._drawn = true; v.dirty = false; } catch (e) { console.error('visual error', e); v.dirty = false; }
    }
  }
  function start() { if (running) return; running = true; raf = requestAnimationFrame(frame); }
  function register(v) { visuals.add(v); v.dirty = true; start(); return v; }
  function unregister(v) { visuals.delete(v); }
  function invalidate() { for (const v of visuals) { v.dirty = true; v._drawn = false; } }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { last = 0; });

  /** Observe a canvas for size changes so visuals redraw. */
  function observe(v) { try { const ro = new ResizeObserver(() => { v.dirty = true; v._drawn = false; if (v.resize) v.resize(); }); ro.observe(v.canvas); v._ro = ro; } catch (e) {} }

  /** deterministic PRNG */
  function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;

  FO.viz = { PAL, TRACK_COLORS, trackColor, rgba, mix, pcColor, PC_COLORS, perf, fit, rotX, rotY, project, register, unregister, invalidate, observe, rng, clamp, lerp };
  if (typeof module !== 'undefined' && module.exports) module.exports = FO.viz;
})();
