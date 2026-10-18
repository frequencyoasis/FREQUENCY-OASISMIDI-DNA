/* Frequency Oasis — MIDI DNA
 * viz-chladni.js : RESONANCE PLATE (Chladni figures) + ambient field.
 *
 * Model (stated honestly in the UI): a square plate where every sounding MIDI pitch excites one standing-wave mode (n, m)
 * whose mode number grows with pitch (n² + m² ∝ frequency). The displacement field is the sum of the excited modes,
 *      f(x, y) = Σ aᵢ [ cos(nᵢπx)·cos(mᵢπy) − cos(mᵢπx)·cos(nᵢπy) ],   aᵢ = velocity × envelope
 * and ~9,000 grains of sand are shaken away from high displacement until they settle on the nodal lines (f = 0).
 * So a chord literally draws its own interference figure; octaves share related figures; silence lets the sand rest.
 * It is a physical-style visualisation of the written notes, not an analysis of recorded sound.
 */
(function () {
  'use strict';
  const FO = (globalThis.FO = globalThis.FO || {});
  const V = FO.viz, P = V.PAL, T = FO.theory;

  const MODES = []; for (let n = 1; n <= 17; n++) for (let m = n + 1; m <= 18; m++) MODES.push({ n, m, K: n * n + m * m });
  function modeFor(pitch) {
    const target = 6 * Math.pow(2, (pitch - 36) / 12), lt = Math.log(target);
    const near = MODES.map(o => ({ o, d: Math.abs(Math.log(o.K) - lt) })).sort((a, b) => a.d - b.d).slice(0, 4);
    return near[pitch % 3 % near.length].o;
  }
  const modeCache = {}; const getMode = (p) => modeCache[p] || (modeCache[p] = modeFor(p));

  /** Notes currently sounding (or being inspected) → [{pitch, amp, name}] and a drum impact value. */
  function excitation(state, now) {
    const out = []; let impact = 0, source = 'rest';
    const e = state.engine, seq = state.seq;
    if (e && e.playing && seq) {
      const pos = e.position, ns = seq.notes; let lo = 0, hi = ns.length; const key = pos - (state.maxDur || 8) - 0.01;
      while (lo < hi) { const m = (lo + hi) >> 1; if (ns[m].startSec < key) lo = m + 1; else hi = m; }
      for (let i = lo; i < ns.length && ns[i].startSec <= pos; i++) {
        const n = ns[i]; if (!e.audible(n.track)) continue;
        if (n.channel === 9) { const age = pos - n.startSec; if (age < 0.18) impact = Math.max(impact, (n.velocity / 127) * (1 - age / 0.18)); continue; }
        if (pos < n.soundEndSec) { const age = pos - n.startSec; out.push({ pitch: n.pitch, amp: (n.velocity / 127) * (0.55 + 0.45 * Math.exp(-age * 2.2)) }); }
      }
      source = 'playback';
    } else if (state.exciteNotes && state.exciteNotes.length && state.exciteUntil > now) {
      const k = Math.min(1, (state.exciteUntil - now) / 1.2); for (const n of state.exciteNotes) out.push({ pitch: n.pitch, amp: (n.velocity || 90) / 127 * k }); source = state.exciteLabel || 'selection';
    }
    // collapse equal pitches, cap voices
    const m = new Map(); for (const o of out) { const a = m.get(o.pitch); if (!a || o.amp > a.amp) m.set(o.pitch, o); }
    return { notes: [...m.values()].sort((a, b) => b.amp - a.amp).slice(0, 10), impact, source };
  }

  class Plate {
    constructor(canvas, opts) {
      this.canvas = canvas; this.opts = opts || {}; this.sym = this.opts.sym || 1; this.amps = new Map(); this.N = 0; this.px = null; this.py = null; this.rand = V.rng(7);
      this.off = document.createElement('canvas'); this.heat = document.createElement('canvas'); this.heat.width = this.heat.height = 56; this.t = 0; this.info = { source: 'rest', notes: [] };
      this.alwaysStatic = false; this.setCount(); V.register(this); V.observe(this);
    }
    setCount() { const N = Math.round((this.opts.count || 8500) * V.perf.particleScale); if (N !== this.N) { this.N = N; this.px = new Float32Array(N); this.py = new Float32Array(N); for (let i = 0; i < N; i++) { this.px[i] = this.rand(); this.py[i] = this.rand(); } this.cleared = true; } }
    resize() { this.cleared = true; }
    draw(now, dt, state) {
      this.setCount();
      const { ctx, w, h } = V.fit(this.canvas, 1.5); const S = Math.floor(Math.min(w, h) * 0.98), ox = (w - S) / 2, oy = (h - S) / 2;
      if (!this.off || this.off.width !== S) { this.off.width = S; this.off.height = S; this.cleared = true; }
      const oc = this.off.getContext('2d'); if (this.cleared) { oc.fillStyle = P.void; oc.fillRect(0, 0, S, S); this.cleared = false; }
      const ex = excitation(state, now); this.info = ex;
      // smooth mode amplitudes
      const target = new Map(); for (const n of ex.notes) { const md = getMode(n.pitch), k = md.n + ':' + md.m; target.set(k, { md, a: (target.get(k) ? target.get(k).a : 0) + n.amp }); }
      for (const [k, v] of target) { const cur = this.amps.get(k) || { md: v.md, a: 0 }; cur.a += (v.a - cur.a) * Math.min(1, dt * 14 || 0.2); cur.md = v.md; this.amps.set(k, cur); }
      for (const [k, cur] of this.amps) { if (!target.has(k)) { cur.a *= Math.exp(-dt * 3.2); if (cur.a < 0.012) this.amps.delete(k); } }
      const modes = [...this.amps.values()]; const total = modes.reduce((s, m) => s + m.a, 0); const PI = Math.PI;
      const level = state.engine && state.engine.playing && state.engine.level ? Math.min(1, state.engine.level * 3) : 0;
      // precompute mode params
      const M = modes.map(m => ({ n: m.md.n * PI, m: m.md.m * PI, a: m.a / Math.max(1, total * 0.55) }));
      const N = this.N, px = this.px, py = this.py, rand = this.rand;
      const jit = 0.0045 + ex.impact * 0.012 + level * 0.004;
      if (total > 0.02 || ex.impact > 0.02) {
        for (let i = 0; i < N; i++) {
          let x = px[i], y = py[i], f = 0, gx = 0, gy = 0;
          for (let k = 0; k < M.length; k++) { const q = M[k], cnx = Math.cos(q.n * x), snx = Math.sin(q.n * x), cmy = Math.cos(q.m * y), smy = Math.sin(q.m * y), cmx = Math.cos(q.m * x), smx = Math.sin(q.m * x), cny = Math.cos(q.n * y), sny = Math.sin(q.n * y); f += q.a * (cnx * cmy - cmx * cny); gx += q.a * (-q.n * snx * cmy + q.m * smx * cny); gy += q.a * (-q.m * cnx * smy + q.n * cmx * sny); }
          const af = Math.min(1.5, Math.abs(f)), r1 = rand() - 0.5, r2 = rand() - 0.5, s = jit * (0.15 + af * 2.4);
          const gl = Math.hypot(gx, gy) + 1e-3; const pull = Math.min(0.012, 0.006 * af) / gl * f;
          x += r1 * s - pull * gx * 0.9; y += r2 * s - pull * gy * 0.9;
          if (x < 0) x = -x; else if (x > 1) x = 2 - x; if (y < 0) y = -y; else if (y > 1) y = 2 - y;
          px[i] = x; py[i] = y;
        }
      } else { for (let i = 0; i < N; i += 3) { px[i] += (rand() - 0.5) * 0.0006; py[i] += (rand() - 0.5) * 0.0006; } }
      // trails
      oc.globalCompositeOperation = 'source-over'; oc.fillStyle = `rgba(5,5,7,${V.perf.reduced ? 1 : 0.22})`; oc.fillRect(0, 0, S, S);
      // heat underlay (low-res field)
      if (M.length) { const hc = this.heat.getContext('2d'), H = 56, id = hc.createImageData(H, H); let mx = 1e-6; const vals = new Float32Array(H * H); for (let j = 0; j < H; j++) for (let i = 0; i < H; i++) { const x = (i + 0.5) / H, y = (j + 0.5) / H; let f = 0; for (const q of M) f += q.a * (Math.cos(q.n * x) * Math.cos(q.m * y) - Math.cos(q.m * x) * Math.cos(q.n * y)); vals[j * H + i] = f; if (Math.abs(f) > mx) mx = Math.abs(f); }
        for (let k = 0; k < H * H; k++) { const f = vals[k] / mx, a = Math.pow(Math.abs(f), 1.4) * 70 * Math.min(1, total); id.data[k * 4] = f > 0 ? 212 : 111; id.data[k * 4 + 1] = f > 0 ? 166 : 160; id.data[k * 4 + 2] = f > 0 ? 74 : 149; id.data[k * 4 + 3] = a; } hc.putImageData(id, 0, 0); oc.globalAlpha = 0.9; oc.imageSmoothingEnabled = true; oc.drawImage(this.heat, 0, 0, S, S); oc.globalAlpha = 1; }
      // sand
      oc.globalCompositeOperation = 'lighter'; const sz = Math.max(1, S / 520);
      for (let i = 0; i < N; i++) {
        let f = 0; for (let k = 0; k < M.length; k++) { const q = M[k]; f += q.a * (Math.cos(q.n * px[i]) * Math.cos(q.m * py[i]) - Math.cos(q.m * px[i]) * Math.cos(q.n * py[i])); }
        const af = Math.min(1, Math.abs(f)), calm = 1 - af; oc.fillStyle = M.length ? (calm > 0.82 ? `rgba(236,230,212,${0.55 + 0.4 * calm})` : `rgba(212,${150 + 60 * calm | 0},${70 + 40 * calm | 0},${0.22 + 0.4 * calm})`) : 'rgba(150,140,110,0.35)';
        oc.fillRect(px[i] * S, py[i] * S, sz * 1.15, sz * 1.15);
      }
      // compose to main with symmetry
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = P.void; ctx.fillRect(0, 0, w, h);
      const bgr = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, S * 0.7); bgr.addColorStop(0, 'rgba(34,28,16,0.8)'); bgr.addColorStop(1, 'rgba(5,5,7,0)'); ctx.fillStyle = bgr; ctx.fillRect(0, 0, w, h);
      const sym = this.sym; ctx.save(); ctx.translate(w / 2, h / 2);
      if (sym > 1) { ctx.beginPath(); ctx.arc(0, 0, S / 2, 0, 6.283); ctx.clip(); }
      ctx.globalCompositeOperation = 'lighter';
      const rot = (this.opts.spin && !V.perf.reduced) ? (this.t += dt * 0.05) : 0;
      for (let k = 0; k < sym; k++) { ctx.save(); ctx.rotate(rot + (k * 6.283) / sym); if (sym > 1 && k % 2) ctx.scale(-1, 1); ctx.globalAlpha = sym > 1 ? 0.62 : 1; ctx.drawImage(this.off, -S / 2, -S / 2); ctx.restore(); }
      ctx.restore(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      // frame
      if (sym === 1) { ctx.strokeStyle = 'rgba(212,166,74,0.28)'; ctx.lineWidth = 1; ctx.strokeRect(ox + 0.5, oy + 0.5, S - 1, S - 1); } else { ctx.strokeStyle = 'rgba(212,166,74,0.25)'; ctx.beginPath(); ctx.arc(w / 2, h / 2, S / 2 - 1, 0, 6.283); ctx.stroke(); }
      // HUD
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = P.ash;
      const names = ex.notes.map(n => T.noteName(n.pitch)).join(' '); const head = ex.notes.length ? `${ex.source.toUpperCase()} · ${names}` : 'PLATE AT REST — press play, or select a note or chord to excite it';
      ctx.fillStyle = ex.notes.length ? P.amber : P.ash; ctx.fillText(head, 14, 20);
      ctx.fillStyle = P.ash; ctx.fillText(ex.notes.length ? ex.notes.slice(0, 6).map(n => { const m = getMode(n.pitch); return `${T.noteName(n.pitch)}→(${m.n},${m.m})`; }).join('  ') : 'each sounding pitch excites one plate mode (n,m); sand settles on the nodal lines', 14, 36);
      ctx.fillText('MIDI-driven plate model · not a recording of the sound', 14, h - 12);
    }
  }

  /** Spectrum of the REAL synth output (AnalyserNode) — only meaningful during playback. */
  class Spectrum {
    constructor(canvas) { this.canvas = canvas; this.smooth = new Float32Array(96); V.register(this); V.observe(this); }
    draw(now, dt, state) {
      const { ctx, w, h } = V.fit(this.canvas, 1.5); ctx.fillStyle = P.void; ctx.fillRect(0, 0, w, h);
      const e = state.engine, data = e && e.playing ? e.spectrum() : null; const B = this.smooth.length;
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.26;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < B; i++) {
        let v = 0; if (data) { const sr = e.ctx.sampleRate, ny = sr / 2, f0 = 30 * Math.pow(18000 / 30, i / B), f1 = 30 * Math.pow(18000 / 30, (i + 1) / B); const a = Math.floor(f0 / ny * data.length), b = Math.max(a + 1, Math.floor(f1 / ny * data.length)); let m = 0; for (let k = a; k < b && k < data.length; k++) m = Math.max(m, data[k]); v = m / 255; }
        this.smooth[i] += (v - this.smooth[i]) * Math.min(1, dt * (v > this.smooth[i] ? 18 : 5) || 0.3);
        const s = this.smooth[i], ang = (i / B) * 6.2832 - Math.PI / 2, r0 = R, r1 = R + s * Math.min(w, h) * 0.24 + 1;
        ctx.strokeStyle = s > 0.72 ? V.rgba(P.ember, 0.5 + s * 0.4) : V.rgba(P.gold, 0.18 + s * 0.7);
        ctx.lineWidth = Math.max(1.5, (6.28 * R / B) * 0.55); ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0); ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1); ctx.stroke();
        ctx.strokeStyle = V.rgba(P.bone, 0.06 + s * 0.2); ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * (r0 - 3), cy + Math.sin(ang) * (r0 - 3)); ctx.lineTo(cx + Math.cos(ang) * (r0 - 3 - s * R * 0.5), cy + Math.sin(ang) * (r0 - 3 - s * R * 0.5)); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = 'rgba(212,166,74,0.3)'; ctx.beginPath(); ctx.arc(cx, cy, R - 1, 0, 6.283); ctx.stroke();
      ctx.font = '11px ui-monospace, monospace'; ctx.fillStyle = data ? P.amber : P.ash; ctx.textAlign = 'center';
      ctx.fillText(data ? 'LIVE FFT OF SYNTH OUTPUT' : 'AUDIO SPECTRUM', cx, h - 24); ctx.fillStyle = P.ash; ctx.fillText(data ? '30 Hz → 18 kHz, log scale' : 'press play — this ring analyses real audio', cx, h - 9);
      ctx.textAlign = 'left';
    }
  }

  /** Full-window ambient motes. Idle: slow dust. Playing: motes are born from real note onsets. */
  class Ambient {
    constructor(canvas) { this.canvas = canvas; this.p = []; this.rand = V.rng(99); this.lastPos = 0; this.alwaysStatic = false; for (let i = 0; i < 70; i++) this.p.push(this.spawn(true)); V.register(this); V.observe(this); }
    spawn(init, col, x, y, size) { const r = this.rand; return { x: x !== undefined ? x : r(), y: y !== undefined ? y : (init ? r() : 1.02), vx: (r() - 0.5) * 0.004, vy: -(0.004 + r() * 0.01), s: size || (0.6 + r() * 1.4), a: init ? r() * 0.4 : 0.8, col: col || (r() < 0.7 ? P.gold : P.bone), life: init ? 1 : 0, born: !init }; }
    draw(now, dt, state) {
      const { ctx, w, h } = V.fit(this.canvas, 1); ctx.clearRect(0, 0, w, h);
      const e = state.engine, seq = state.seq, playing = e && e.playing; const reduced = V.perf.reduced;
      if (playing && seq && !reduced) {
        const pos = e.position, ns = seq.notes; if (pos > this.lastPos && pos - this.lastPos < 0.4) { let lo = 0, hi = ns.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ns[m].startSec < this.lastPos) lo = m + 1; else hi = m; } for (let i = lo; i < ns.length && ns[i].startSec <= pos; i++) { const n = ns[i]; if (n.startSec <= this.lastPos || !e.audible(n.track)) continue; if (this.p.length > 260 * V.perf.particleScale) break; const y = n.channel === 9 ? 0.92 : 1 - (n.pitch - 24) / 90; const q = this.spawn(false, V.trackColor(n.track), 0.04 + this.rand() * 0.92, Math.max(0.02, Math.min(0.98, y)), 1.2 + 3 * n.velocity / 127); q.vy = -(0.01 + n.velocity / 127 * 0.03); q.vx = (this.rand() - 0.5) * 0.02; this.p.push(q); } } this.lastPos = pos;
      } else this.lastPos = e ? e.position : 0;
      const lvl = playing && e.level ? Math.min(1, e.level * 3) : 0; ctx.globalCompositeOperation = 'lighter';
      const sp = reduced ? 0 : 1;
      for (let i = this.p.length - 1; i >= 0; i--) {
        const q = this.p[i]; q.x += q.vx * dt * 60 * 0.016 * 60 * sp * (1 + lvl * 2); q.y += q.vy * dt * sp * (1 + lvl * 3); if (q.born) q.a *= Math.exp(-dt * 0.9);
        if (q.y < -0.05 || q.a < 0.02 || q.x < -0.05 || q.x > 1.05) { if (q.born) { this.p.splice(i, 1); continue; } this.p[i] = this.spawn(false); continue; }
        const px = q.x * w, py = q.y * h, r = q.s * (1 + lvl); ctx.globalAlpha = Math.min(1, q.a * (q.born ? 0.6 : 0.35 + lvl * 0.4)); const s = sprite2(q.col); ctx.drawImage(s, px - r * 4, py - r * 4, r * 8, r * 8);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }
  const sp2 = {}; function sprite2(color) { if (sp2[color]) return sp2[color]; const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, V.rgba(color, 0.9)); g.addColorStop(0.3, V.rgba(color, 0.25)); g.addColorStop(1, V.rgba(color, 0)); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return (sp2[color] = c); }

  FO.Plate = Plate; FO.Spectrum = Spectrum; FO.Ambient = Ambient; FO.plateModeFor = getMode;
})();
