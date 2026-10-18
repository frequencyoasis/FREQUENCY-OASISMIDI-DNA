/* Frequency Oasis — MIDI DNA
 * viz-geometry.js : HARMONIC ANATOMY (circle-of-fifths chord geometry), PITCH ROSE, MOOD TERRAIN (3-D), ARRANGEMENT MAP.
 * All four are drawn from measured analysis output. Captions state what each axis/colour means.
 */
(function () {
  'use strict';
  const FO = (globalThis.FO = globalThis.FO || {});
  const V = FO.viz, P = V.PAL, T = FO.theory;
  const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
  const ang = (i) => -Math.PI / 2 + (i * Math.PI * 2) / 12;
  const serif = '"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif';
  const mono = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

  /* ================= HARMONIC ANATOMY ================= */
  class Anatomy {
    constructor(canvas, opts) { this.canvas = canvas; this.opts = opts || {}; this.fade = new Map(); this.shown = -1; this.k = 0; V.register(this); V.observe(this); canvas.addEventListener('click', (e) => this.click(e)); canvas.style.cursor = 'pointer'; this.nodes = []; }
    click(e) { const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; for (const n of this.nodes) if (Math.hypot(n.x - x, n.y - y) < n.r + 8) { if (this.opts.onNode) this.opts.onNode(n.pc); return; } }
    draw(now, dt, state) {
      const { ctx, w, h } = V.fit(this.canvas, 1.5); ctx.fillStyle = P.void; ctx.fillRect(0, 0, w, h);
      const A = state.analysis, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.37; this.nodes = [];
      if (!A || !A.chords) { ctx.fillStyle = P.ash; ctx.font = `12px ${mono}`; ctx.textAlign = 'center'; ctx.fillText('No harmonic data in this scope', cx, cy); ctx.textAlign = 'left'; return; }
      const sel = A.selected, segs = A.chords.segments.filter(s => s.kind === 'chord'), pcw = A.key ? A.key.pcw : new Array(12).fill(1 / 12), maxw = Math.max(...pcw) || 1;
      const flats = sel ? sel.flats : false;
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.5); bg.addColorStop(0, 'rgba(36,28,14,0.7)'); bg.addColorStop(1, 'rgba(5,5,7,0)'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      const pt = (pc, rr) => { const i = FIFTHS.indexOf(pc); return [cx + Math.cos(ang(i)) * (rr === undefined ? R : rr), cy + Math.sin(ang(i)) * (rr === undefined ? R : rr)]; };
      // rings
      ctx.strokeStyle = 'rgba(236,230,212,0.07)'; ctx.lineWidth = 1; for (const f of [0.35, 0.68, 1]) { ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, 6.283); ctx.stroke(); }
      for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang(i)) * R, cy + Math.sin(ang(i)) * R); ctx.stroke(); }
      // transition fingerprint (aggregated root→root)
      const agg = new Map(); const chordIdx = new Map(); A.chords.segments.forEach((s, i) => chordIdx.set(i, s));
      for (const t of A.chords.transitions) { const a = A.chords.segments[t.from], b = A.chords.segments[t.to]; if (!a || !b || a.root === b.root) continue; const k = a.root + '>' + b.root; agg.set(k, (agg.get(k) || 0) + 1); }
      const mxA = Math.max(1, ...agg.values()); ctx.globalCompositeOperation = 'lighter';
      for (const [k, c] of agg) { const [a, b] = k.split('>').map(Number); const p = pt(a, R * 0.98), q = pt(b, R * 0.98); const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2; const pull = 0.62; ctx.strokeStyle = V.rgba(P.gold, 0.10 + 0.5 * c / mxA); ctx.lineWidth = 0.8 + 3.2 * c / mxA; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.quadraticCurveTo(cx + (mx - cx) * (1 - pull), cy + (my - cy) * (1 - pull), q[0], q[1]); ctx.stroke(); }
      // current chord (playing → follow, else selected)
      const ci = state.activeChordIndex; const cur = ci !== null && ci !== undefined && A.chords.segments[ci] && A.chords.segments[ci].kind === 'chord' ? A.chords.segments[ci] : null;
      if (cur) { if (this.shown !== ci) { this.fade.set(ci, 1); this.shown = ci; } }
      // trail polygons (previous chords)
      const order = []; if (cur) { let idx = segs.findIndex(s => s.idx === ci); for (let k = 1; k <= 4; k++) if (idx - k >= 0) order.push([segs[idx - k], 1 - k * 0.2]); }
      const poly = (seg, a, thick) => { const pts = seg.tones.map(t => pt(t.pc, R * 0.9)); ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fillStyle = V.rgba(P.gold, a * 0.12); ctx.fill(); ctx.strokeStyle = V.rgba(P.amber, a * 0.9); ctx.lineWidth = thick; ctx.stroke(); };
      for (const [s, a] of order) poly(s, a * 0.5, 1);
      if (cur) { poly(cur, 1, 2); const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R); g.addColorStop(0, V.rgba(P.amber, 0.12)); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); }
      ctx.globalCompositeOperation = 'source-over';
      // nodes
      for (let i = 0; i < 12; i++) {
        const pc = FIFTHS[i], [x, y] = pt(pc), use = Math.sqrt(pcw[pc] / maxw), inS = sel ? sel.inSet.has(pc) : true, isTonic = sel && sel.root === pc, inChord = cur && cur.tones.some(t => t.pc === pc), isRoot = cur && cur.root === pc, isBass = cur && cur.bassPc === pc;
        const rad = 6 + 14 * use; this.nodes.push({ x, y, r: rad, pc });
        ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.283); ctx.fillStyle = inChord ? V.rgba(V.pcColor(pc), 0.95) : V.rgba(V.pcColor(pc), inS ? 0.38 : 0.12); ctx.fill();
        ctx.lineWidth = isTonic ? 2 : 1; ctx.strokeStyle = isTonic ? P.amber : inS ? 'rgba(236,230,212,0.4)' : 'rgba(180,65,47,0.55)'; ctx.stroke();
        if (isRoot) { ctx.strokeStyle = P.bone; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, rad + 5, 0, 6.283); ctx.stroke(); }
        if (isBass) { ctx.fillStyle = P.bone; ctx.fillRect(x - 3, y - 3, 6, 6); }
        const lx = cx + Math.cos(ang(i)) * (R + 30), ly = cy + Math.sin(ang(i)) * (R + 30); ctx.font = `600 13px ${mono}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = inChord ? P.amber : inS ? P.bone : '#8a5a50'; ctx.fillText(T.pcName(pc, flats), lx, ly);
      }
      // centre label
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      if (cur) { ctx.font = `600 ${Math.round(R * 0.28)}px ${serif}`; ctx.fillStyle = P.bone; ctx.fillText(cur.label, cx, cy + R * 0.04); ctx.font = `13px ${mono}`; ctx.fillStyle = P.amber; ctx.fillText((cur.roman || '') + (cur.diatonic === false ? ' · non-diatonic' : ''), cx, cy + R * 0.22); ctx.fillStyle = P.ash; ctx.fillText(`${cur.inversionText} · confidence ${(cur.confidence).toFixed(2)}`, cx, cy + R * 0.36); }
      else { ctx.font = `13px ${mono}`; ctx.fillStyle = P.ash; ctx.fillText('Select a chord in the timeline', cx, cy - 4); ctx.fillText('or press play to follow the harmony', cx, cy + 14); }
      ctx.textAlign = 'left'; ctx.font = `10px ${mono}`; ctx.fillStyle = P.ash; ctx.fillText('MIDI-DERIVED · ring = circle of fifths · node size = pitch-class usage · gold arcs = chord-root motion (thicker = more often) · polygon = current chord', 12, h - 12);
    }
  }

  /* ================= PITCH ROSE ================= */
  class Rose {
    constructor(canvas, opts) { this.canvas = canvas; this.opts = opts || {}; this.cur = new Array(12).fill(0); this.inA = new Array(12).fill(0.5); this.nodes = []; V.register(this); V.observe(this); canvas.style.cursor = 'pointer'; canvas.addEventListener('click', (e) => { const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; for (const n of this.nodes) if (Math.hypot(n.x - x, n.y - y) < 18) { if (this.opts.onPc) this.opts.onPc(n.pc); return; } }); }
    draw(now, dt, state) {
      const { ctx, w, h } = V.fit(this.canvas, 1.5); ctx.fillStyle = P.void; ctx.fillRect(0, 0, w, h); const A = state.analysis; const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.30; this.nodes = [];
      if (!A || !A.key) { ctx.fillStyle = P.ash; ctx.font = `12px ${mono}`; ctx.textAlign = 'center'; ctx.fillText('No pitched notes in this scope', cx, cy); ctx.textAlign = 'left'; return; }
      const sel = A.selected, pcw = A.key.pcw, mx = Math.max(...pcw) || 1, flats = sel.flats; const k = Math.min(1, dt * 7 || 0.2);
      for (let pc = 0; pc < 12; pc++) { this.cur[pc] += (pcw[pc] / mx - this.cur[pc]) * k; this.inA[pc] += ((sel.inSet.has(pc) ? 1 : 0) - this.inA[pc]) * k; }
      ctx.strokeStyle = 'rgba(236,230,212,0.07)'; for (const f of [0.33, 0.66, 1]) { ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, 6.283); ctx.stroke(); }
      ctx.globalCompositeOperation = 'lighter';
      const pts = [];
      for (let pc = 0; pc < 12; pc++) {
        const a = -Math.PI / 2 + (pc * Math.PI * 2) / 12, len = R * (0.08 + 0.92 * this.cur[pc]), x0 = cx + Math.cos(a) * R * 0.18, y0 = cy + Math.sin(a) * R * 0.18, x1 = cx + Math.cos(a) * (R * 0.18 + len * 0.82), y1 = cy + Math.sin(a) * (R * 0.18 + len * 0.82);
        const col = V.mix(P.oxide, P.gold, this.inA[pc]); const wd = (Math.PI * 2 * R * 0.5 / 12) * 0.68;
        const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, V.rgba(P.gold, 0.05)); g.addColorStop(1, col.replace('rgb', 'rgba').replace(')', ',0.85)'));
        ctx.strokeStyle = g; ctx.lineWidth = wd; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        if (sel.inSet.has(pc)) pts.push([cx + Math.cos(a) * R * 1.12, cy + Math.sin(a) * R * 1.12]);
      }
      ctx.globalCompositeOperation = 'source-over';
      // scale polygon
      if (pts.length > 2) { ctx.strokeStyle = 'rgba(212,166,74,0.35)'; ctx.setLineDash([3, 4]); ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `600 12px ${mono}`;
      for (let pc = 0; pc < 12; pc++) { const a = -Math.PI / 2 + (pc * Math.PI * 2) / 12, lx = cx + Math.cos(a) * (R * 1.32), ly = cy + Math.sin(a) * (R * 1.32); this.nodes.push({ x: lx, y: ly, pc }); const inS = sel.inSet.has(pc); ctx.fillStyle = pc === sel.root ? P.amber : inS ? P.bone : '#8a5a50'; ctx.fillText(T.pcName(pc, flats), lx, ly); if (pc === sel.root) { ctx.strokeStyle = P.amber; ctx.beginPath(); ctx.arc(lx, ly, 12, 0, 6.283); ctx.stroke(); } const pc2 = (pcw[pc] * 100); ctx.font = `10px ${mono}`; ctx.fillStyle = P.ash; ctx.fillText(pc2.toFixed(pc2 < 10 ? 1 : 0) + '%', cx + Math.cos(a) * (R * 1.32 + 17), cy + Math.sin(a) * (R * 1.32 + 17)); ctx.font = `600 12px ${mono}`; }
      ctx.font = `600 ${Math.round(R * 0.2)}px ${serif}`; ctx.fillStyle = P.bone; ctx.fillText(sel.rootName, cx, cy - 6); ctx.font = `10px ${mono}`; ctx.fillStyle = P.ash; ctx.fillText(sel.scale.name.split(' (')[0], cx, cy + R * 0.11 + 4);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText('Petal length = duration × velocity weighted pitch-class share · gold = inside the selected scale · red = outside', 12, h - 12);
    }
  }

  /* ================= MOOD TERRAIN ================= */
  class Terrain {
    constructor(canvas) { this.canvas = canvas; this.grid = null; this.yaw = -0.55; this.pitch = 0.62; this.uy = 0; this.up = 0; this.drag = null; this.t = 0; this.cols = 84; this.rows = 34; V.register(this); V.observe(this); canvas.style.touchAction = 'none'; canvas.style.cursor = 'grab';
      canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); this.drag = { x: e.clientX, y: e.clientY, uy: this.uy, up: this.up }; canvas.style.cursor = 'grabbing'; });
      canvas.addEventListener('pointermove', (e) => { if (!this.drag) return; this.uy = this.drag.uy + (e.clientX - this.drag.x) * 0.006; this.up = Math.max(-0.5, Math.min(0.7, this.drag.up + (e.clientY - this.drag.y) * 0.004)); });
      canvas.addEventListener('pointerup', () => { this.drag = null; canvas.style.cursor = 'grab'; }); canvas.addEventListener('dblclick', () => { this.uy = 0; this.up = 0; });
    }
    setData(seq, notes, analysis) {
      this.seq = seq; const C = this.cols, R = this.rows; const g = { h: new Float32Array(C * R), vel: new Float32Array(C * R), lo: 36, hi: 96, tension: new Float32Array(C), dur: Math.max(0.5, seq ? seq.musicalEndSec : 1) };
      const pn = notes.filter(n => n.channel !== 9); this.grid = null; if (!pn.length) return;
      let lo = 127, hi = 0; for (const n of pn) { if (n.pitch < lo) lo = n.pitch; if (n.pitch > hi) hi = n.pitch; } lo = Math.max(0, lo - 1); hi = Math.min(127, Math.max(hi + 1, lo + 12)); g.lo = lo; g.hi = hi;
      const binT = g.dur / C, rowOf = (p) => Math.min(R - 1, Math.floor((p - lo) / (hi - lo + 1) * R));
      for (const n of pn) { const r = rowOf(n.pitch); const c0 = Math.max(0, Math.floor(n.startSec / binT)), c1 = Math.min(C - 1, Math.floor(Math.max(n.startSec, n.endSec - 1e-6) / binT)); const m = (0.4 + 0.6 * n.velocity / 127); for (let c = c0; c <= c1; c++) { const ov = Math.min(n.endSec, (c + 1) * binT) - Math.max(n.startSec, c * binT); const wgt = (c === c0 ? 0.55 : 0) + Math.max(0.05, ov / binT) * 0.75; g.h[c * R + r] += wgt * m; g.vel[c * R + r] = Math.max(g.vel[c * R + r], n.velocity / 127); } }
      // blur along pitch and time lightly
      const b = new Float32Array(g.h.length); for (let c = 0; c < C; c++) for (let r = 0; r < R; r++) { let s = g.h[c * R + r] * 0.5, wsum = 0.5; if (r > 0) { s += g.h[c * R + r - 1] * 0.2; wsum += 0.2; } if (r < R - 1) { s += g.h[c * R + r + 1] * 0.2; wsum += 0.2; } if (c > 0) { s += g.h[(c - 1) * R + r] * 0.1; wsum += 0.1; } if (c < C - 1) { s += g.h[(c + 1) * R + r] * 0.1; wsum += 0.1; } b[c * R + r] = s / wsum; }
      let mx = 0; for (const v of b) if (v > mx) mx = v; for (let i = 0; i < b.length; i++) g.h[i] = Math.pow(b[i] / (mx || 1), 0.65);
      const tb = analysis && analysis.terrain ? analysis.terrain : []; const segs = analysis && analysis.chords ? analysis.chords.segments : [];
      for (let c = 0; c < C; c++) { const t = (c + 0.5) * binT; let tv = null; for (const s of segs) { if (s.startSec <= t && t < s.endSec) { tv = s.kind === 'chord' ? s.tension : (s.tension || 0); break; } } if (tv === null && tb.length) { const row = tb[Math.min(tb.length - 1, Math.floor(c / C * tb.length))]; tv = row.tension; } g.tension[c] = tv === null || tv === undefined ? 0.3 : tv; }
      this.grid = g; this.dirty = true;
    }
    draw(now, dt, state) {
      const { ctx, w, h } = V.fit(this.canvas, 1.5); ctx.fillStyle = P.void; ctx.fillRect(0, 0, w, h); const g = this.grid; const C = this.cols, R = this.rows;
      const bg = ctx.createRadialGradient(w / 2, h * 0.6, 0, w / 2, h * 0.6, Math.max(w, h) * 0.7); bg.addColorStop(0, 'rgba(38,28,14,0.55)'); bg.addColorStop(1, 'rgba(5,5,7,0)'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      if (!g) { ctx.fillStyle = P.ash; ctx.font = `12px ${mono}`; ctx.fillText('No pitched notes in this scope — nothing to build a terrain from.', 20, 30); return; }
      if (!V.perf.reduced) this.t += dt; const yaw = this.yaw + this.uy + (V.perf.reduced ? 0 : Math.sin(this.t * 0.12) * 0.12), pitch = this.pitch + this.up;
      const cam = { cx: w / 2, cy: h * 0.58, f: Math.min(w * 0.95, h * 2.0), dist: 3.1 }; const eng = state.engine; const pos = eng ? eng.position : 0; const pc = Math.max(0, Math.min(C - 1, pos / g.dur * C));
      const X = (c) => (c / (C - 1) - 0.5) * 2.2, Z = (r) => (r / (R - 1) - 0.5) * 1.35, Hh = (c, r) => -(g.h[c * R + r]) * 0.62;
      const proj = (c, r, yy) => V.project(V.rotX(V.rotY([X(c), yy === undefined ? Hh(c, r) : yy, Z(r)], yaw), pitch), cam);
      const pts = new Array(C * R); for (let c = 0; c < C; c++) for (let r = 0; r < R; r++) pts[c * R + r] = proj(c, r);
      const quads = []; for (let c = 0; c < C - 1; c++) for (let r = 0; r < R - 1; r++) { const a = pts[c * R + r], b = pts[(c + 1) * R + r], d = pts[(c + 1) * R + r + 1], e = pts[c * R + r + 1]; quads.push({ c, r, z: a[3] + b[3] + d[3] + e[3], a, b, d, e }); }
      quads.sort((p, q) => q.z - p.z);
      for (const q of quads) {
        const hv = (g.h[q.c * R + q.r] + g.h[(q.c + 1) * R + q.r] + g.h[(q.c + 1) * R + q.r + 1] + g.h[q.c * R + q.r + 1]) / 4, tens = g.tension[q.c], near = Math.abs(q.c + 0.5 - pc) < 1.3 ? 1 : 0;
        const base = V.mix(P.gold, P.oxide, V.clamp(tens * 1.15)); ctx.beginPath(); ctx.moveTo(q.a[0], q.a[1]); ctx.lineTo(q.b[0], q.b[1]); ctx.lineTo(q.d[0], q.d[1]); ctx.lineTo(q.e[0], q.e[1]); ctx.closePath();
        ctx.fillStyle = `rgba(10,10,14,${0.82})`; ctx.fill(); ctx.fillStyle = base.replace('rgb', 'rgba').replace(')', `,${0.05 + hv * 0.42 + near * 0.18})`); ctx.fill();
        ctx.strokeStyle = base.replace('rgb', 'rgba').replace(')', `,${0.10 + hv * 0.7 + near * 0.3})`); ctx.lineWidth = 0.6 + hv * 0.9; ctx.stroke();
      }
      // playhead plane
      const c0 = Math.floor(pc), fr = pc - c0; const pl = []; for (const yy of [0, -0.75]) for (const rr of [0, R - 1]) { const x = X(pc); pl.push(V.project(V.rotX(V.rotY([x, yy, Z(rr)], yaw), pitch), cam)); }
      ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = V.rgba(P.amber, eng && eng.playing ? 0.8 : 0.45); ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(pl[0][0], pl[0][1]); ctx.lineTo(pl[1][0], pl[1][1]); ctx.lineTo(pl[3][0], pl[3][1]); ctx.lineTo(pl[2][0], pl[2][1]); ctx.closePath(); ctx.stroke(); ctx.fillStyle = V.rgba(P.amber, 0.05); ctx.fill(); ctx.globalCompositeOperation = 'source-over';
      // axes labels
      const lab = (txt, p, dx, dy, col) => { ctx.fillStyle = col || P.ash; ctx.font = `10px ${mono}`; ctx.fillText(txt, p[0] + dx, p[1] + dy); };
      const o1 = V.project(V.rotX(V.rotY([X(0), 0.02, Z(R - 1)], yaw), pitch), cam), o2 = V.project(V.rotX(V.rotY([X(C - 1), 0.02, Z(R - 1)], yaw), pitch), cam), o3 = V.project(V.rotX(V.rotY([X(0), 0.02, Z(0)], yaw), pitch), cam);
      lab('0:00', o1, -4, 14); lab(FO.fmtTime(g.dur), o2, -10, 14); lab(T.noteName(g.hi), o3, -34, 4); lab(T.noteName(g.lo), o1, -34, 4);
      ctx.font = `10px ${mono}`; ctx.fillStyle = P.ash; ctx.fillText('HEIGHT = note activity (duration × velocity, measured) · DEPTH = register · COLOUR = chord tension (gold calm → red tense) · drag to orbit, double-click to reset', 14, h - 12);
    }
  }

  /* ================= ARRANGEMENT MAP ================= */
  class ArrMap {
    constructor(canvas, opts) { this.canvas = canvas; this.opts = opts || {}; this.heat = null; this.hit = []; this.hover = null; V.register(this); V.observe(this); canvas.style.cursor = 'pointer';
      canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); this.hover = this.at(e.clientX - r.left, e.clientY - r.top); if (this.opts.onHover) this.opts.onHover(this.hover, e.clientX, e.clientY); this.dirty = true; });
      canvas.addEventListener('pointerleave', () => { this.hover = null; if (this.opts.onHover) this.opts.onHover(null); this.dirty = true; });
      canvas.addEventListener('click', (e) => { const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, hit = this.at(x, y); if (hit && hit.kind === 'region' && this.opts.onRegion) this.opts.onRegion(hit.region); else if (this.geom && x >= this.geom.x0 && this.opts.onSeek) this.opts.onSeek((x - this.geom.x0) / this.geom.W * this.geom.dur); });
    }
    at(x, y) { for (const h of this.hit) if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h; return null; }
    setData(seq, structure, tracks) {
      this.seq = seq; this.st = structure; this.tracks = tracks; this.heat = null; if (!structure || !structure.bins.length) return;
      const bins = structure.bins, edges = bins.map(b => b.t0); edges.push(bins[bins.length - 1].t1); const rows = tracks.filter(t => t.noteCount > 0).map(t => ({ track: t, counts: new Float32Array(bins.length) }));
      const byT = new Map(rows.map(r => [r.track.index, r])); for (const n of seq.notes) { const r = byT.get(n.track); if (!r) continue; let lo = 0, hi = bins.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (edges[m] <= n.startSec) lo = m; else hi = m - 1; } r.counts[lo] += 1; }
      for (const r of rows) { r.max = Math.max(1e-6, ...r.counts); } this.heat = rows; this.dirty = true;
    }
    draw(now, dt, state) {
      const { ctx, w, h } = V.fit(this.canvas, 1.5); ctx.fillStyle = P.void; ctx.fillRect(0, 0, w, h); this.hit = []; const st = this.st;
      if (!st || !this.heat || !st.bins.length) { ctx.fillStyle = P.ash; ctx.font = `12px ${mono}`; ctx.fillText('No arrangement data in this scope', 20, 30); return; }
      const eng = state.engine, x0 = 118, pad = 14, W = w - x0 - pad, dur = st.bins[st.bins.length - 1].t1, X = (t) => x0 + t / dur * W; this.geom = { x0, W, dur };
      const noveltyH = 46, rowH = Math.max(16, Math.min(28, (h - noveltyH - 150) / Math.max(1, this.heat.length))), top = 22 + noveltyH, mapH = this.heat.length * rowH, arcTop = top + mapH + 14;
      // regions bands + labels
      st.regions.forEach((rg, i) => { const xa = X(rg.startSec), xb = X(rg.endSec); ctx.fillStyle = i % 2 ? 'rgba(236,230,212,0.03)' : 'rgba(212,166,74,0.035)'; ctx.fillRect(xa, 8, xb - xa, mapH + noveltyH + 14); ctx.fillStyle = P.bone; ctx.font = `600 11px ${mono}`; ctx.fillText(String.fromCharCode(65 + (i % 26)), xa + 4, 20); ctx.fillStyle = P.ash; ctx.font = `10px ${mono}`; if (xb - xa > 46) ctx.fillText(rg.character, xa + 18, 20); this.hit.push({ kind: 'region', x: xa, y: 8, w: xb - xa, h: mapH + noveltyH + 14, region: rg, label: `Region ${String.fromCharCode(65 + (i % 26))} · bars ${rg.startMeasure}–${rg.endMeasure} · ${FO.fmtTime(rg.startSec)}–${FO.fmtTime(rg.endSec)} · ${rg.noteCount} notes · ${rg.character} · ${rg.activeTracks} track(s) active${rg.bassShare > 0.6 ? ' · bass present' : ''}` }); });
      // novelty curve
      ctx.strokeStyle = 'rgba(212,166,74,0.8)'; ctx.lineWidth = 1.2; ctx.beginPath(); const nov = st.novelty || []; const mxn = Math.max(1e-6, ...nov);
      st.bins.forEach((b, i) => { const x = X((b.t0 + b.t1) / 2), y = 22 + noveltyH - (nov[i] || 0) / mxn * (noveltyH - 6); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.fillStyle = P.ash; ctx.font = `10px ${mono}`; ctx.fillText('change', 14, 22 + noveltyH / 2); ctx.fillText('(novelty)', 14, 22 + noveltyH / 2 + 12);
      for (const a of st.abrupt) { const x = X(a.sec); ctx.fillStyle = a.kind.includes('increase') ? P.amber : P.oxide; ctx.beginPath(); ctx.moveTo(x, 24 + noveltyH); ctx.lineTo(x - 3.5, 31 + noveltyH); ctx.lineTo(x + 3.5, 31 + noveltyH); ctx.closePath(); ctx.fill(); }
      // heat rows
      this.heat.forEach((r, i) => {
        const y = top + i * rowH; const dim = state.engine && !state.engine.audible(r.track.index); ctx.fillStyle = P.ash; ctx.font = `11px ${mono}`; ctx.fillStyle = dim ? '#5a5b66' : P.bone; const nm = (r.track.name || 'Track ' + (r.track.index + 1)); ctx.fillText(nm.length > 15 ? nm.slice(0, 14) + '…' : nm, 14, y + rowH / 2 + 4); ctx.fillStyle = V.rgba(V.trackColor(r.track.index), 1); ctx.fillRect(6, y + rowH / 2 - 3, 4, 6);
        st.bins.forEach((b, k) => { const v = r.counts[k] / r.max; if (!v) return; const xa = X(b.t0), xb = X(b.t1); ctx.fillStyle = V.rgba(V.trackColor(r.track.index), (0.12 + 0.88 * Math.pow(v, 0.7)) * (dim ? 0.25 : 1)); ctx.fillRect(xa, y + 2, Math.max(1, xb - xa - 0.5), rowH - 4); });
        ctx.fillStyle = 'rgba(236,230,212,0.05)'; ctx.fillRect(x0, y + rowH - 1, W, 1);
      });
      // silences
      for (const s of st.silences) { const xa = X(s.startSec), xb = X(s.endSec); ctx.fillStyle = 'rgba(180,65,47,0.12)'; ctx.fillRect(xa, top, xb - xa, mapH); ctx.strokeStyle = 'rgba(180,65,47,0.5)'; ctx.lineWidth = 1; for (let xx = xa; xx < xb; xx += 5) { ctx.beginPath(); ctx.moveTo(xx, top + mapH); ctx.lineTo(Math.min(xb, xx + 5), top); ctx.stroke(); } this.hit.push({ kind: 'silence', x: xa, y: top, w: Math.max(4, xb - xa), h: mapH, label: `Silence of ${s.beats.toFixed(1)} beats at ${FO.fmtTime(s.startSec)}` }); }
      // boundaries
      for (const b of st.boundaries) { const x = X(b.sec); ctx.strokeStyle = V.rgba(P.amber, 0.35 + 0.5 * b.strength); ctx.lineWidth = 1 + 1.8 * b.strength; ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, top + mapH); ctx.stroke(); }
      // repeated-section arcs
      ctx.fillStyle = P.ash; ctx.font = `10px ${mono}`; ctx.fillText('repeats', 14, arcTop + 12);
      const arcBase = arcTop + 4, arcMax = h - arcBase - 28;
      st.repeated.forEach((rp, i) => {
        const xa = (X(rp.aSec) + X(rp.aEnd)) / 2, xb = (X(rp.bSec) + X(rp.bEnd)) / 2, r = (xb - xa) / 2, ry = Math.min(arcMax, r * 0.7), hot = this.hover && this.hover.kind === 'arc' && this.hover.rp === rp;
        ctx.strokeStyle = V.rgba(hot ? P.amber : P.gold, hot ? 0.95 : 0.25 + 0.35 * rp.similarity); ctx.lineWidth = Math.max(1.5, Math.min(7, rp.bins * 0.9)); ctx.beginPath(); ctx.ellipse((xa + xb) / 2, arcBase, r, ry, 0, Math.PI, 0); ctx.stroke();
        ctx.fillStyle = V.rgba(P.gold, 0.35); ctx.fillRect(X(rp.aSec), arcBase - 3, X(rp.aEnd) - X(rp.aSec), 3); ctx.fillRect(X(rp.bSec), arcBase - 3, X(rp.bEnd) - X(rp.bSec), 3);
        this.hit.push({ kind: 'arc', rp, x: (xa + xb) / 2 - 8, y: arcBase - ry, w: 16, h: ry, label: `Similar material: ${FO.fmtTime(rp.aSec)}–${FO.fmtTime(rp.aEnd)} resembles ${FO.fmtTime(rp.bSec)}–${FO.fmtTime(rp.bEnd)} (similarity ${rp.similarity.toFixed(2)}, ${rp.bins} bins)` });
      });
      // playhead
      const pos = eng ? eng.position : 0; const px = X(Math.min(pos, dur)); ctx.fillStyle = P.amber; ctx.fillRect(px, 8, 1.5, top + mapH - 8); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createLinearGradient(px - 10, 0, px + 10, 0); g.addColorStop(0, 'rgba(240,197,106,0)'); g.addColorStop(0.5, 'rgba(240,197,106,0.18)'); g.addColorStop(1, 'rgba(240,197,106,0)'); ctx.fillStyle = g; ctx.fillRect(px - 10, 8, 20, top + mapH - 8); ctx.globalCompositeOperation = 'source-over';
      // scope region
      const rg = state.scope && state.scope.region; if (rg) { ctx.fillStyle = 'rgba(240,197,106,0.10)'; ctx.fillRect(X(rg.a), 8, X(rg.b) - X(rg.a), top + mapH - 8); }
      ctx.fillStyle = P.ash; ctx.font = `10px ${mono}`; ctx.fillText('MIDI-DERIVED · brightness = notes per ' + (st.binKind === 'bar' ? 'bar' : 'time slice') + ' per track · gold lines = estimated section boundaries (not verified verse/chorus labels) · hatched red = silence', 14, h - 10);
    }
  }

  FO.Anatomy = Anatomy; FO.Rose = Rose; FO.Terrain = Terrain; FO.ArrMap = ArrMap;
})();
