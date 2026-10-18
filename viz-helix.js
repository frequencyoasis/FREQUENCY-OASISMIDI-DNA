/* Frequency Oasis — MIDI DNA
 * viz-helix.js : THE MIDI DNA HELIX.
 *
 * Every rung is a vertical slice of the music at one moment:
 *   • strand A  = the highest sounding note        • strand B = the lowest sounding note
 *   • beads on the rung = the notes between them, placed by pitch, coloured by pitch class
 *   • rung colour = measured dissonance of the outer interval (gold → oxide)
 *   • the helix makes one full turn every two bars (four when the piece is long), so metre is visible as twist
 *   • strand radius follows register; glow follows velocity
 * When audio is playing the strands breathe with the real output level of the synth.
 * With no file loaded the helix is shown dormant (uniform, dim) and is labelled as such.
 */
(function () {
  'use strict';
  const FO = (globalThis.FO = globalThis.FO || {});
  const V = FO.viz, P = V.PAL, T = FO.theory;

  const sprites = {};
  function sprite(color) {
    if (sprites[color]) return sprites[color];
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, V.rgba(color, 1)); g.addColorStop(0.18, V.rgba(color, 0.55)); g.addColorStop(0.5, V.rgba(color, 0.12)); g.addColorStop(1, V.rgba(color, 0));
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); sprites[color] = c; return c;
  }

  class Helix {
    constructor(canvas, opts) {
      this.canvas = canvas; this.opts = opts || {}; this.rungs = []; this.seq = null; this.yaw = 0.4; this.pitch = 0.42; this.userYaw = 0; this.userPitch = 0; this.center = 0; this.win = 10; this.dur = 1; this.twistSec = 4; this.hover = null;
      this.drag = null; this.t = 0; this.stamp = null; this.hit = [];
      canvas.style.touchAction = 'none';
      canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); this.drag = { x: e.clientX, y: e.clientY, uy: this.userYaw, up: this.userPitch, moved: false }; });
      canvas.addEventListener('pointermove', (e) => { if (!this.drag) { this.hoverAt(e); return; } const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true; this.userYaw = this.drag.uy + dx * 0.006; this.userPitch = Math.max(-0.9, Math.min(0.9, this.drag.up + dy * 0.004)); this.dirty = true; });
      canvas.addEventListener('pointerup', (e) => { const d = this.drag; this.drag = null; if (d && !d.moved) { const r = this.pick(e); if (r && this.opts.onSeek) this.opts.onSeek(r.t); } });
      canvas.addEventListener('dblclick', () => { this.userYaw = 0; this.userPitch = 0; this.dirty = true; });
      V.register(this); V.observe(this);
    }
    setSeq(seq, analysis) {
      this.seq = seq; this.analysis = analysis || null; this.build();
    }
    build() {
      const seq = this.seq; this.rungs = [];
      if (!seq || !seq.notes.length) return;
      const st = FO.state || {}; const hidden = st.hidden;
      const notes = seq.notes.filter(n => n.channel !== 9 && (!hidden || !hidden.has(n.track)));
      this.dur = Math.max(1, seq.musicalEndSec);
      const bar = Math.max(0.2, seq.tickToSec(seq.meter.entries[0].measTicks) - seq.tickToSec(0)); const bars = this.dur / bar;
      this.barSec = bar; this.twistSec = bar * (bars > 40 ? 4 : 2);
      const groups = new Map(); for (const n of notes) { let g = groups.get(n.startTick); if (!g) groups.set(n.startTick, g = []); g.push(n); }
      let arr = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([tick, g]) => ({ tick, t: g[0].startSec, notes: g }));
      const MAX = 1500;
      if (arr.length > MAX) { const bw = this.dur / MAX, bins = new Map(); for (const g of arr) { const k = Math.floor(g.t / bw); let b = bins.get(k); if (!b) bins.set(k, b = { tick: g.tick, t: k * bw + bw / 2, notes: [] }); for (const n of g.notes) b.notes.push(n); } arr = [...bins.values()].sort((a, b) => a.t - b.t); }
      const inSet = this.analysis && this.analysis.selected ? this.analysis.selected.inSet : null;
      for (const g of arr) {
        let top = g.notes[0], bot = g.notes[0], vel = 0; for (const n of g.notes) { if (n.pitch > top.pitch) top = n; if (n.pitch < bot.pitch) bot = n; vel += n.velocity; }
        const seen = new Map(); for (const n of g.notes) { const o = seen.get(n.pitch); if (!o || n.velocity > o.velocity) seen.set(n.pitch, n); }
        let beads = [...seen.values()].sort((a, b) => b.velocity - a.velocity).slice(0, 7);
        const ic = T.icOf(top.pitch, bot.pitch), diss = top.pitch === bot.pitch ? 0 : T.IC_DISS[ic];
        let out = 0; if (inSet) for (const n of beads) if (!inSet.has(n.pitch % 12)) out++;
        this.rungs.push({ t: g.t, top: top.pitch, bot: bot.pitch, tt: top.track, bt: bot.track, vel: vel / g.notes.length / 127, count: seen.size, diss, beads, out });
      }
    }
    /* projection of one rung; returns {a:[x,y,k], b:[x,y,k], phi} */
    proj(r, ctx3, level) {
      const phi = (r.t / this.twistSec) * 6.2832 + this.t * 0.08, x = (r.t - ctx3.center) * ctx3.xs;
      const rad = ctx3.R * (1 + level * 0.25);
      const ra = rad * (0.78 + 0.5 * V.clamp((r.top - 40) / 56)), rb = rad * (0.78 + 0.5 * V.clamp((r.bot - 24) / 56));
      const A = [x, ra * Math.sin(phi), ra * Math.cos(phi)], B = [x, rb * Math.sin(phi + Math.PI), rb * Math.cos(phi + Math.PI)];
      const tf = (p) => V.project(V.rotX(V.rotY(p, ctx3.yaw), ctx3.pitch), ctx3.cam);
      return { A: tf(A), B: tf(B), phi, tf, ax: [x, 0, 0] };
    }
    hoverAt(e) { this.hover = this.pickRaw(e); this.canvas.style.cursor = this.hover ? 'pointer' : 'grab'; this.dirty = true; }
    pickRaw(e) { const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let best = null, bd = 18 * 18; for (const h of this.hit) { const d = (h.x - x) * (h.x - x) + (h.y - y) * (h.y - y); if (d < bd) { bd = d; best = h.r; } } return best; }
    pick(e) { return this.pickRaw(e); }

    draw(now, dt, state) {
      const { ctx, w, h } = V.fit(this.canvas, 1.5); const eng = state && state.engine; const playing = !!(eng && eng.playing); const reduced = V.perf.reduced;
      if (!reduced) this.t += dt; const t = this.t;
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = P.void; ctx.fillRect(0, 0, w, h);
      // backdrop vignette
      const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7); bg.addColorStop(0, 'rgba(40,32,18,0.55)'); bg.addColorStop(1, 'rgba(5,5,7,0)'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      const dormant = !this.rungs.length;
      let pos = eng ? eng.position : 0, level = playing && eng.level ? Math.min(1, eng.level * 3.2) : 0;
      let rungs = this.rungs;
      if (dormant) { rungs = this.dormant || (this.dormant = Array.from({ length: 160 }, (_, i) => ({ t: i * 0.25, top: 72, bot: 48, vel: 0.35, count: 3, diss: 0.2, beads: [], tt: 0, bt: 1, out: 0 }))); this.dur = 40; this.twistSec = 4; pos = 20; }
      // window & centre (eased)
      const targetWin = playing ? Math.min(this.dur, Math.max(this.barSec * 8, 12)) : this.dur * 1.04;
      this.win += (targetWin - this.win) * Math.min(1, dt * 2.5 || 0.05); const targetC = playing ? pos : this.dur / 2; this.center += (targetC - this.center) * Math.min(1, dt * 4 || 0.1);
      const span = Math.min(w, h * 2.1), xs = (w * 0.86) / this.win, R = Math.min(h * 0.25, w * 0.11);
      const yaw = 0.35 + this.userYaw + (reduced ? 0 : Math.sin(t * 0.07) * 0.28) + (dormant ? t * 0.05 : 0), pitch = 0.30 + this.userPitch + (reduced ? 0 : Math.sin(t * 0.05) * 0.1);
      const cam = { cx: w / 2, cy: h / 2, f: Math.min(w, h * 2.2) * 0.95, dist: R * 3.4 + 0 };
      const c3 = { center: this.center, xs, R: R / xs * xs, yaw, pitch, cam };
      c3.xs = xs * 1; // axis scale in px-equivalent units
      const unit = 1; // world units == px at k=1
      c3.R = R;
      ctx.globalCompositeOperation = 'lighter';
      const rg = state && state.scope && state.scope.region;
      const inView = [];
      for (const r of rungs) { const x = (r.t - this.center) * xs; if (Math.abs(x) > w * 0.75) continue; inView.push(r); }
      this.hit = [];
      // strands
      const strand = (which) => {
        ctx.beginPath(); let started = false;
        for (const r of inView) { const p = this.proj(r, c3, level); const q = which === 'A' ? p.A : p.B; if (!started) { ctx.moveTo(q[0], q[1]); started = true; } else ctx.lineTo(q[0], q[1]); }
        ctx.stroke();
      };
      ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(212,166,74,0.30)'; strand('A'); ctx.strokeStyle = 'rgba(236,230,212,0.22)'; strand('B');
      // axis ticks (bars)
      if (!dormant) { const b0 = Math.floor((this.center - this.win) / this.barSec), b1 = Math.ceil((this.center + this.win) / this.barSec); for (let b = Math.max(0, b0); b <= b1; b++) { const tt = b * this.barSec, p = V.project(V.rotX(V.rotY([(tt - this.center) * xs, 0, 0], yaw), pitch), cam); ctx.fillStyle = b % 4 === 0 ? 'rgba(212,166,74,0.55)' : 'rgba(236,230,212,0.16)'; const s = (b % 4 === 0 ? 2.2 : 1.2); ctx.fillRect(p[0] - s / 2, p[1] - s / 2, s, s); } }
      let flare = null;
      for (const r of inView) {
        const p = this.proj(r, c3, level); const dtp = r.t - pos; const age = dtp < 0 ? Math.min(1, -dtp / (this.win * 0.7)) : 0;
        let a = dormant ? 0.22 : (dtp > 0 ? 0.50 : 0.95 - 0.55 * age); const near = Math.abs(dtp) < Math.max(0.08, this.barSec * 0.06);
        if (rg && (r.t < rg.a || r.t > rg.b)) a *= 0.3;
        const depth = V.clamp(1.25 - (p.A[3] / (cam.dist * 2.4)), 0.35, 1.2); a *= depth;
        const col = V.mix(P.gold, P.oxide, r.diss * 0.9); const rv = 0.25 + 0.75 * r.vel;
        // rung
        ctx.strokeStyle = V.rgba('#d4a64a', 0); const g = ctx.createLinearGradient(p.A[0], p.A[1], p.B[0], p.B[1]); g.addColorStop(0, V.rgba(P.gold, a * 0.55 * rv)); g.addColorStop(0.5, col.replace('rgb', 'rgba').replace(')', `,${a * 0.4 * rv})`)); g.addColorStop(1, V.rgba(P.bone, a * 0.5 * rv));
        ctx.strokeStyle = g; ctx.lineWidth = 0.8 + 1.4 * r.vel * Math.min(1.6, p.A[2]); ctx.beginPath(); ctx.moveTo(p.A[0], p.A[1]); ctx.lineTo(p.B[0], p.B[1]); ctx.stroke();
        // strand nodes
        const sA = sprite(V.trackColor(r.tt)), sB = sprite(V.trackColor(r.bt)); const ns = (5 + 14 * r.vel) * p.A[2] * (near ? 2.4 : 1) * (0.7 + level * 0.5);
        ctx.globalAlpha = Math.min(1, a); ctx.drawImage(sA, p.A[0] - ns, p.A[1] - ns, ns * 2, ns * 2); ctx.drawImage(sB, p.B[0] - ns * 0.8, p.B[1] - ns * 0.8, ns * 1.6, ns * 1.6);
        // beads (inner voices) positioned by pitch between bottom and top
        const span = Math.max(1, r.top - r.bot);
        for (const n of r.beads) { const f = (n.pitch - r.bot) / span; const bx = p.B[0] + (p.A[0] - p.B[0]) * f, by = p.B[1] + (p.A[1] - p.B[1]) * f; const bs = (3.2 + 7 * n.velocity / 127) * (p.A[2] + p.B[2]) / 2 * (near ? 2.2 : 1); const inS = !this.analysis || !this.analysis.selected || this.analysis.selected.inSet.has(n.pitch % 12); ctx.globalAlpha = Math.min(1, a * (inS ? 1 : 1.3)); ctx.drawImage(sprite(inS ? V.pcColor(n.pitch % 12) : P.oxide), bx - bs, by - bs, bs * 2, bs * 2); }
        ctx.globalAlpha = 1;
        if (near && !dormant) flare = { x: (p.A[0] + p.B[0]) / 2, y: (p.A[1] + p.B[1]) / 2, r: Math.hypot(p.A[0] - p.B[0], p.A[1] - p.B[1]) / 2 };
        this.hit.push({ x: (p.A[0] + p.B[0]) / 2, y: (p.A[1] + p.B[1]) / 2, r });
      }
      // playhead disc
      const ph = V.project(V.rotX(V.rotY([(pos - this.center) * xs, 0, 0], yaw), pitch), cam);
      if (!dormant) {
        const rr = R * 1.55 * ph[2]; ctx.save(); ctx.translate(ph[0], ph[1]); ctx.scale(Math.max(0.12, Math.abs(Math.sin(yaw)) * 0.9 + 0.1), 1); ctx.strokeStyle = V.rgba(P.amber, playing ? 0.5 : 0.3); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, rr, 0, 6.283); ctx.stroke(); ctx.strokeStyle = V.rgba(P.amber, 0.12); ctx.beginPath(); ctx.arc(0, 0, rr * 0.6, 0, 6.283); ctx.stroke(); ctx.restore();
      }
      if (flare) { const s = sprite(P.amber), fr = flare.r * 2.4 + 20; ctx.globalAlpha = 0.5 + level * 0.4; ctx.drawImage(s, flare.x - fr, flare.y - fr, fr * 2, fr * 2); ctx.globalAlpha = 1; }
      // hover readout
      ctx.globalCompositeOperation = 'source-over';
      if (this.hover && !dormant) { const r = this.hover; const hit = this.hit.find(q => q.r === r); if (hit) { const lbl = `${FO.fmtTime(r.t)} · ${T.noteName(r.bot)} → ${T.noteName(r.top)} · ${T.intervalName(r.top - r.bot)} · ${r.count} pitch${r.count > 1 ? 'es' : ''}`; ctx.font = '11px ui-monospace, monospace'; const tw = ctx.measureText(lbl).width; const lx = Math.max(8, Math.min(w - tw - 16, hit.x + 12)), ly = Math.max(20, hit.y - 14); ctx.fillStyle = 'rgba(8,8,11,0.88)'; ctx.fillRect(lx - 6, ly - 13, tw + 12, 20); ctx.strokeStyle = 'rgba(212,166,74,0.5)'; ctx.strokeRect(lx - 6.5, ly - 13.5, tw + 13, 21); ctx.fillStyle = P.bone; ctx.fillText(lbl, lx, ly); } }
      ctx.font = '10px ui-monospace, monospace'; ctx.fillStyle = P.ash; ctx.textAlign = 'left';
      ctx.fillText(dormant ? 'DORMANT STRAND — no MIDI loaded. This is an idle ornament, not data.' : `MIDI-DERIVED · one turn = ${Math.round(this.twistSec / this.barSec)} bars · strand A top note, strand B bottom note, beads = notes between${playing ? ' · radius breathes with live synth level' : ''}`, 14, h - 12);
    }
  }
  FO.Helix = Helix;
})();
