/* Frequency Oasis — MIDI DNA
 * piano-roll.js : the functional arrangement view. Canvas piano roll with ruler, tempo/measure markers, zoom/scroll,
 * click-to-inspect, region selection, mute/solo-aware dimming, scale-fit marking, playhead + note pulses and a minimap.
 */
(function () {
  'use strict';
  const FO = (globalThis.FO = globalThis.FO || {});
  const V = FO.viz, P = V.PAL, T = FO.theory;
  const KEYW = 58, RULER = 30;
  const BLACK = new Set([1, 3, 6, 8, 10]);

  class PianoRoll {
    constructor(o) {
      this.canvas = o.canvas; this.mini = o.mini; this.cb = o.callbacks || {}; this.seq = null; this.selId = null; this.hoverId = null;
      this.view = { t0: 0, pps: 60, top: 84, pph: 14 }; this.region = null; this.follow = true; this.showScale = true; this.showRelations = true;
      this.pulses = []; this.lastPos = 0; this.drag = null; this.maxDur = 0; this.miniCache = null; this.activePitches = new Set();
      this.canvas.tabIndex = 0; this.canvas.setAttribute('role', 'application'); this.canvas.setAttribute('aria-label', 'Piano roll. Arrow keys move between notes, Enter auditions, plus and minus zoom.');
      this.bind(); V.register(this); V.observe(this);
      if (this.mini) { this.miniDrag = false; this.bindMini(); const ro = new ResizeObserver(() => { this.miniCache = null; this.dirty = true; }); ro.observe(this.mini); }
    }
    setSeq(seq) {
      this.seq = seq; this.selId = null; this.region = null; this.maxDur = 0; this.miniCache = null; this.pulses = [];
      if (seq) for (const n of seq.notes) if (n.durSec > this.maxDur) this.maxDur = n.durSec;
      this.fitAll(); this.dirty = true;
    }
    get st() { return FO.state || {}; }
    fitAll() {
      if (!this.seq || !this.seq.notes.length) return;
      const ns = this.seq.notes; let lo = 127, hi = 0; for (const n of ns) { if (n.pitch < lo) lo = n.pitch; if (n.pitch > hi) hi = n.pitch; }
      const rect = this.canvas.getBoundingClientRect(); const W = Math.max(300, rect.width - KEYW), H = Math.max(200, rect.height - RULER);
      const span = Math.max(24, hi - lo + 6);
      this.view.pph = Math.max(6, Math.min(26, H / span)); this.view.top = Math.min(127, hi + 3 + Math.max(0, (H / this.view.pph - span) / 2));
      const dur = Math.max(2, this.seq.musicalEndSec); this.view.pps = Math.max(2, W / (dur * 1.02)); this.view.t0 = -dur * 0.01; this.dirty = true;
    }
    spanSec() { const r = this.canvas.getBoundingClientRect(); return Math.max(0.1, (r.width - KEYW) / this.view.pps); }
    clampView() {
      const v = this.view, dur = this.seq ? this.seq.musicalEndSec : 10, span = this.spanSec();
      v.t0 = Math.max(-span * 0.1, Math.min(v.t0, Math.max(0, dur - span * 0.9)));
      const r = this.canvas.getBoundingClientRect(), rows = (r.height - RULER) / v.pph;
      v.top = Math.max(Math.min(127, rows - 1 + 0), Math.min(v.top, 127 + 1)); if (v.top < rows - 3) v.top = rows - 3;
      if (v.top - rows > 0 === false && false) v.top = rows;
    }
    zoomX(f, anchorSec) {
      const v = this.view, r = this.canvas.getBoundingClientRect(); const a = anchorSec !== undefined ? anchorSec : v.t0 + (r.width - KEYW) / v.pps / 2;
      const rel = (a - v.t0) * v.pps; v.pps = Math.max(1.5, Math.min(900, v.pps * f)); v.t0 = a - rel / v.pps; this.clampView(); this.dirty = true;
    }
    zoomY(f, anchorPitch) {
      const v = this.view, r = this.canvas.getBoundingClientRect(); const a = anchorPitch !== undefined ? anchorPitch : v.top - (r.height - RULER) / v.pph / 2;
      const rel = (v.top - a) * v.pph; v.pph = Math.max(4, Math.min(40, v.pph * f)); v.top = a + rel / v.pph; this.clampView(); this.dirty = true;
    }
    centerOn(sec) { this.view.t0 = sec - this.spanSec() / 2; this.clampView(); this.dirty = true; }
    selectNote(id, center) {
      this.selId = id; this.dirty = true;
      if (id !== null && center && this.seq) { const n = this.seq.notes[this.idxOf(id)]; if (n) { const v = this.view, span = this.spanSec(); if (n.startSec < v.t0 || n.startSec > v.t0 + span * 0.92) this.centerOn(n.startSec + n.durSec / 2); const rows = (this.canvas.getBoundingClientRect().height - RULER) / v.pph; if (n.pitch > v.top - 1 || n.pitch < v.top - rows + 1) { v.top = n.pitch + rows / 2; this.clampView(); } } }
    }
    idxOf(id) { const ns = this.seq.notes; if (ns[id] && ns[id].id === id) return id; return ns.findIndex(n => n.id === id); }
    setRegion(r) { this.region = r; this.dirty = true; }

    /* ---- geometry ---- */
    xOf(sec) { return KEYW + (sec - this.view.t0) * this.view.pps; }
    secOf(x) { return this.view.t0 + (x - KEYW) / this.view.pps; }
    yOf(pitch) { return RULER + (this.view.top - pitch) * this.view.pph; }
    pitchOf(y) { return this.view.top - (y - RULER) / this.view.pph; }

    /* ---- hit testing ---- */
    noteAt(x, y) {
      if (!this.seq || x < KEYW || y < RULER) return null;
      const t = this.secOf(x), p = Math.floor(this.pitchOf(y)), ns = this.seq.notes, v = this.view;
      const pad = 2 / v.pps; let best = null, bestScore = 1e9;
      for (let i = this.lowerBound(t - this.maxDur - pad); i < ns.length; i++) {
        const n = ns[i]; if (n.startSec > t + pad) break;
        if (n.pitch !== p) continue;
        if (!this.visibleTrack(n.track)) continue;
        if (t >= n.startSec - pad && t <= n.endSec + pad) { const sc = Math.abs((n.startSec + n.endSec) / 2 - t); if (sc < bestScore) { best = n; bestScore = sc; } }
      }
      return best;
    }
    lowerBound(sec) { const ns = this.seq.notes; let lo = 0, hi = ns.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ns[m].startSec < sec) lo = m + 1; else hi = m; } return lo; }
    visibleTrack(i) { const e = this.st.engine; if (!e || !e.settings[i]) return true; return !this.st.hidden || !this.st.hidden.has(i); }
    dimmed(i) { const e = this.st.engine; if (!e || !e.settings[i]) return false; return !e.audible(i); }

    /* ---- input ---- */
    bind() {
      const c = this.canvas;
      c.addEventListener('wheel', (e) => {
        if (!this.seq) return; e.preventDefault();
        const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, d = Math.sign(e.deltaY) * Math.min(1, Math.abs(e.deltaY) / 100 + 0.2);
        if (e.ctrlKey || e.metaKey) this.zoomX(Math.exp(-d * 0.25), this.secOf(x));
        else if (e.altKey) this.zoomY(Math.exp(-d * 0.2), this.pitchOf(y));
        else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { this.view.t0 += (e.deltaX || e.deltaY) / this.view.pps; this.clampView(); this.dirty = true; }
        else { this.view.top += (e.deltaY / this.view.pph) * 0.6; this.clampView(); this.dirty = true; }
      }, { passive: false });
      c.addEventListener('pointerdown', (e) => {
        if (!this.seq) return; c.focus({ preventScroll: true }); c.setPointerCapture(e.pointerId);
        const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        if (x < KEYW && y >= RULER) { const p = Math.floor(this.pitchOf(y)); this.drag = { kind: 'key', p }; if (this.cb.onAudition) this.cb.onAudition(p); return; }
        if (y < RULER) { this.drag = { kind: 'ruler', x0: x, t0: this.secOf(x), moved: false }; return; }
        this.drag = { kind: 'pan', x0: x, y0: y, vt0: this.view.t0, vtop: this.view.top, moved: false };
      });
      c.addEventListener('pointermove', (e) => {
        const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, d = this.drag;
        if (d) {
          if (d.kind === 'pan') { const dx = x - d.x0, dy = y - d.y0; if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true; if (d.moved) { this.view.t0 = d.vt0 - dx / this.view.pps; this.view.top = d.vtop + dy / this.view.pph; this.clampView(); this.dirty = true; c.style.cursor = 'grabbing'; } }
          else if (d.kind === 'ruler') { if (Math.abs(x - d.x0) > 4) d.moved = true; if (d.moved) { const a = Math.max(0, Math.min(d.t0, this.secOf(x))), b = Math.min(this.seq.musicalEndSec, Math.max(d.t0, this.secOf(x))); this.region = { a, b, live: true }; this.dirty = true; } }
          return;
        }
        const n = this.noteAt(x, y); const id = n ? n.id : null;
        if (id !== this.hoverId) { this.hoverId = id; this.dirty = true; c.style.cursor = n ? 'pointer' : (y < RULER ? 'col-resize' : x < KEYW ? 'pointer' : 'grab'); }
        if (this.cb.onHover) this.cb.onHover(n, e.clientX, e.clientY);
      });
      const end = (e) => {
        const d = this.drag; this.drag = null; c.style.cursor = '';
        if (!d || !this.seq) return;
        const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        if (d.kind === 'pan' && !d.moved) { const n = this.noteAt(x, y); this.selId = n ? n.id : null; this.dirty = true; if (this.cb.onSelect) this.cb.onSelect(n ? n.id : null); }
        else if (d.kind === 'ruler') {
          if (d.moved && this.region) { const rg = { a: this.region.a, b: this.region.b }; if (rg.b - rg.a < 0.05) { this.region = null; if (this.cb.onRegion) this.cb.onRegion(null); } else { this.region = rg; if (this.cb.onRegion) this.cb.onRegion(rg); } }
          else { if (this.cb.onSeek) this.cb.onSeek(Math.max(0, d.t0)); }
          this.dirty = true;
        }
      };
      c.addEventListener('pointerup', end); c.addEventListener('pointercancel', () => { this.drag = null; });
      c.addEventListener('pointerleave', () => { if (this.hoverId !== null) { this.hoverId = null; this.dirty = true; if (this.cb.onHover) this.cb.onHover(null); } });
      c.addEventListener('dblclick', (e) => { const r = c.getBoundingClientRect(); if (e.clientY - r.top < RULER) { this.region = null; this.dirty = true; if (this.cb.onRegion) this.cb.onRegion(null); } });
      c.addEventListener('keydown', (e) => {
        if (!this.seq) return; const ns = this.seq.notes; if (!ns.length) return;
        let cur = this.selId !== null ? ns[this.idxOf(this.selId)] : null, next = null;
        const vis = (n) => this.visibleTrack(n.track);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          const dir = e.key === 'ArrowRight' ? 1 : -1; let i = cur ? this.idxOf(cur.id) : this.lowerBound(this.view.t0);
          for (i += cur ? dir : 0; i >= 0 && i < ns.length; i += dir) if (vis(ns[i]) && (!cur || ns[i].startTick !== cur.startTick || ns[i].pitch !== cur.pitch)) { if (cur && dir === 1 && ns[i].startTick === cur.startTick && ns[i].pitch < cur.pitch) continue; next = ns[i]; break; }
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          if (!cur) next = ns.find(vis); else { const dir = e.key === 'ArrowUp' ? 1 : -1; let bestD = 99; for (const n of ns) { if (!vis(n)) continue; if (n.startSec > cur.endSec || n.endSec < cur.startSec) continue; const d = (n.pitch - cur.pitch) * dir; if (d > 0 && d < bestD) { bestD = d; next = n; } } }
        } else if (e.key === 'Enter' && cur) { if (this.cb.onAudition) this.cb.onAudition(cur.pitch, cur); return; }
        else if (e.key === '+' || e.key === '=') { this.zoomX(1.25); return; } else if (e.key === '-' || e.key === '_') { this.zoomX(0.8); return; }
        else if (e.key === 'Escape') { this.selId = null; this.dirty = true; if (this.cb.onSelect) this.cb.onSelect(null); return; }
        else return;
        e.preventDefault(); if (next) { this.selectNote(next.id, true); if (this.cb.onSelect) this.cb.onSelect(next.id); }
      });
    }
    bindMini() {
      const m = this.mini, set = (e) => { if (!this.seq) return; const r = m.getBoundingClientRect(); const sec = (e.clientX - r.left) / r.width * this.seq.musicalEndSec; this.centerOn(sec); };
      m.addEventListener('pointerdown', (e) => { this.miniDrag = true; m.setPointerCapture(e.pointerId); set(e); });
      m.addEventListener('pointermove', (e) => { if (this.miniDrag) set(e); });
      m.addEventListener('pointerup', () => { this.miniDrag = false; });
    }

    /* ---- grid ---- */
    gridLines(t0, t1) {
      const s = this.seq, out = [], tk0 = Math.max(0, Math.floor(s.secToTick(Math.max(0, t0)))), tk1 = Math.ceil(s.secToTick(t1));
      const E = s.meter.entries; const pxBeat = this.view.pps * (60 / (s.tempoMap.entries[0].bpm || 120));
      for (let i = 0; i < E.length; i++) {
        const e = E[i], nextT = i + 1 < E.length ? E[i + 1].tick : Infinity; if (nextT < tk0) continue; if (e.tick > tk1) break;
        const sub = e.beatTicks / 4; let startK = Math.max(0, Math.floor((tk0 - e.tick) / sub)); const guard = 6000;
        for (let k = startK, c = 0; c < guard; k++, c++) {
          const tick = e.tick + k * sub; if (tick > tk1 || tick >= nextT) break;
          const inMeas = (tick - e.tick) % e.measTicks, isMeasure = Math.abs(inMeas) < 1e-6 || Math.abs(inMeas - e.measTicks) < 1e-6, isBeat = Math.abs(((tick - e.tick) % e.beatTicks)) < 1e-6;
          out.push({ tick, sec: s.tickToSec(tick), kind: isMeasure ? 'bar' : isBeat ? 'beat' : 'sub', e });
        }
      }
      return out;
    }

    /* ---- draw ---- */
    draw(now, dt, state) {
      const { ctx, w, h } = V.fit(this.canvas); const v = this.view;
      ctx.fillStyle = P.obsidian; ctx.fillRect(0, 0, w, h);
      const eng = state && state.engine, pos = eng ? eng.position : 0, playing = eng && eng.playing;
      if (!this.seq) { ctx.fillStyle = P.ash; ctx.font = '13px ui-monospace, monospace'; ctx.fillText('Import a MIDI file to open the arrangement.', KEYW + 20, 70); return; }
      const s = this.seq;
      if (playing && this.follow && !this.drag) { const span = this.spanSec(); if (pos > v.t0 + span * 0.88 || pos < v.t0) { v.t0 = pos - span * 0.12; this.clampView(); } }
      const t0 = v.t0, t1 = t0 + (w - KEYW) / v.pps, rows = (h - RULER) / v.pph;
      const pTop = Math.ceil(v.top), pBot = Math.floor(v.top - rows);
      const sel = state && state.analysis && state.analysis.selected, inSet = sel ? sel.inSet : null;

      // lanes
      for (let p = Math.min(127, pTop); p >= Math.max(0, pBot); p--) {
        const y = this.yOf(p + 1), pc = p % 12;
        ctx.fillStyle = BLACK.has(pc) ? 'rgba(255,255,255,0.016)' : 'rgba(255,255,255,0.004)'; ctx.fillRect(KEYW, y, w - KEYW, v.pph);
        if (this.showScale && inSet) { if (inSet.has(pc)) { ctx.fillStyle = pc === sel.root ? 'rgba(212,166,74,0.085)' : 'rgba(212,166,74,0.035)'; ctx.fillRect(KEYW, y, w - KEYW, v.pph); } }
        if (pc === 0) { ctx.fillStyle = 'rgba(236,230,212,0.10)'; ctx.fillRect(KEYW, y + v.pph - 1, w - KEYW, 1); }
      }
      // grid
      const lines = this.gridLines(t0, t1);
      const barPx = (() => { const m0 = s.meter.entries[0]; return v.pps * (s.tickToSec(m0.measTicks) - s.tickToSec(0)); })();
      ctx.lineWidth = 1;
      for (const L of lines) {
        const x = Math.round(this.xOf(L.sec)) + 0.5; if (x < KEYW || x > w) continue;
        if (L.kind === 'sub') { if (barPx < 380) continue; ctx.strokeStyle = 'rgba(236,230,212,0.035)'; }
        else if (L.kind === 'beat') { if (barPx < 90) continue; ctx.strokeStyle = 'rgba(236,230,212,0.07)'; }
        else ctx.strokeStyle = 'rgba(212,166,74,0.22)';
        ctx.beginPath(); ctx.moveTo(x, RULER); ctx.lineTo(x, h); ctx.stroke();
      }
      // region
      const rg = this.region || (state && state.scope && state.scope.region);
      if (rg) { const xa = this.xOf(rg.a), xb = this.xOf(rg.b); ctx.fillStyle = 'rgba(212,166,74,0.07)'; ctx.fillRect(xa, RULER, xb - xa, h - RULER); ctx.fillStyle = 'rgba(212,166,74,0.55)'; ctx.fillRect(xa, RULER, 1, h - RULER); ctx.fillRect(xb - 1, RULER, 1, h - RULER); }

      // notes
      const ns = s.notes, start = this.lowerBound(t0 - this.maxDur - 0.01); const selNote = this.selId !== null ? ns[this.idxOf(this.selId)] : null;
      const chordSeg = state && state.activeChord;
      const active = []; const hasSolo = eng && Object.values(eng.settings).some(x => x.solo);
      const drawNote = (n, outline) => {
        const x = this.xOf(n.startSec), wd = Math.max(2, n.durSec * v.pps), y = this.yOf(n.pitch + 1);
        if (x + wd < KEYW || x > w || y + v.pph < RULER || y > h) return;
        const dim = this.dimmed(n.track), col = V.trackColor(n.track), a = (0.28 + 0.72 * n.velocity / 127) * (dim ? 0.2 : 1);
        const cx = Math.max(x, KEYW), cw = Math.min(x + wd, w) - cx; if (cw <= 0) return;
        if (n.channel === 9) { const r = Math.max(2.5, v.pph * 0.32); ctx.save(); ctx.translate(x + 2, y + v.pph / 2); ctx.rotate(Math.PI / 4); ctx.fillStyle = V.rgba(col, a); ctx.fillRect(-r / 1.4, -r / 1.4, r * 1.4, r * 1.4); ctx.restore(); return; }
        ctx.fillStyle = V.rgba(col, a); ctx.fillRect(cx, y + 1, cw, Math.max(2, v.pph - 2));
        if (wd > 6 && v.pph >= 7) { ctx.fillStyle = V.rgba('#000000', dim ? 0.1 : 0.22); ctx.fillRect(cx, y + Math.max(2, v.pph - 2) - 1 + 1, cw, 1); }
        if (this.showScale && inSet && !inSet.has(n.pitch % 12) && !dim) { ctx.fillStyle = P.oxide; ctx.fillRect(cx, y + 1, Math.min(3, cw), Math.max(2, v.pph - 2)); }
        if (n.id === this.hoverId || outline) { ctx.strokeStyle = outline ? P.bone : 'rgba(236,230,212,0.7)'; ctx.lineWidth = outline ? 1.5 : 1; ctx.strokeRect(cx + 0.5, y + 1.5, cw - 1, Math.max(2, v.pph - 2) - 1); }
        if (pos >= n.startSec && pos < n.soundEndSec && !dim) active.push([n, x, y, wd]);
      };
      for (let i = start; i < ns.length; i++) { const n = ns[i]; if (n.startSec > t1) break; if (n.endSec < t0 - 0.01) continue; if (!this.visibleTrack(n.track)) continue; if (selNote && n.id === selNote.id) continue; drawNote(n, false); }
      if (selNote) drawNote(selNote, true);

      // relations of the selected note
      if (selNote && this.showRelations) {
        const cx = this.xOf(selNote.startSec) + Math.max(2, selNote.durSec * v.pps) / 2, cy = this.yOf(selNote.pitch + 1) + v.pph / 2; let shown = 0;
        ctx.save(); ctx.lineWidth = 1; ctx.font = '10px ui-monospace, monospace';
        for (let i = this.lowerBound(selNote.startSec - this.maxDur); i < ns.length && ns[i].startSec < selNote.endSec; i++) {
          const o = ns[i]; if (o.id === selNote.id || o.endSec <= selNote.startSec || !this.visibleTrack(o.track) || o.channel === 9) continue;
          const ox = this.xOf(Math.max(o.startSec, selNote.startSec)) + 2, oy = this.yOf(o.pitch + 1) + v.pph / 2; if (ox > w + 50 || ox < KEYW - 50) continue;
          ctx.strokeStyle = 'rgba(236,230,212,0.28)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ox, oy); ctx.stroke();
          if (shown < 7) { ctx.setLineDash([]); ctx.fillStyle = 'rgba(236,230,212,0.85)'; ctx.fillText(T.intervalName(o.pitch - selNote.pitch), (cx + ox) / 2 + 4, (cy + oy) / 2 - 3); shown++; }
        }
        // next note in same track
        let nx = null; for (let i = this.idxOf(selNote.id) + 1; i < ns.length; i++) if (ns[i].track === selNote.track && ns[i].startTick > selNote.startTick) { nx = ns[i]; break; }
        if (nx) { const ox = this.xOf(nx.startSec) + 2, oy = this.yOf(nx.pitch + 1) + v.pph / 2; ctx.setLineDash([]); ctx.strokeStyle = 'rgba(212,166,74,0.8)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ox, oy); ctx.stroke(); ctx.fillStyle = P.amber; ctx.fillText((nx.pitch - selNote.pitch >= 0 ? '+' : '') + (nx.pitch - selNote.pitch) + ' st', (cx + ox) / 2 + 4, (cy + oy) / 2 + 12); }
        ctx.restore();
      }

      // pulses + active glow
      if (playing) {
        const from = this.lastPos, to = pos;
        if (to > from && to - from < 0.5) for (let i = this.lowerBound(from); i < ns.length && ns[i].startSec <= to; i++) { const n = ns[i]; if (n.startSec > from && this.visibleTrack(n.track) && !this.dimmed(n.track)) this.pulses.push({ t: now, n }); }
        this.lastPos = to;
      } else this.lastPos = pos;
      this.activePitches.clear();
      ctx.globalCompositeOperation = 'lighter';
      for (const [n, x, y, wd] of active) { this.activePitches.add(n.pitch); ctx.fillStyle = V.rgba(V.trackColor(n.track), 0.28); ctx.fillRect(Math.max(KEYW, x) - 1, y - 1, Math.min(wd, w) + 2, v.pph + 2); }
      if (this.pulses.length) {
        this.pulses = this.pulses.filter(p => now - p.t < 0.8 && this.pulses.length < 400);
        for (const p of this.pulses) { const k = (now - p.t) / 0.8, n = p.n, col = V.trackColor(n.track); const x = this.xOf(pos), y = this.yOf(n.pitch + 1) + v.pph / 2; ctx.strokeStyle = V.rgba(col, (1 - k) * 0.8 * (0.4 + 0.6 * n.velocity / 127)); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 3 + k * (14 + n.velocity / 8), 0, 6.283); ctx.stroke(); }
      }
      ctx.globalCompositeOperation = 'source-over';

      // playhead
      const px = this.xOf(pos);
      if (px >= KEYW && px <= w) { const g = ctx.createLinearGradient(px - 14, 0, px + 14, 0); g.addColorStop(0, 'rgba(240,197,106,0)'); g.addColorStop(0.5, playing ? 'rgba(240,197,106,0.22)' : 'rgba(240,197,106,0.12)'); g.addColorStop(1, 'rgba(240,197,106,0)'); ctx.fillStyle = g; ctx.fillRect(px - 14, RULER, 28, h - RULER); ctx.fillStyle = P.amber; ctx.fillRect(Math.round(px), RULER, 1.5, h - RULER); }

      // ruler
      ctx.fillStyle = P.ink; ctx.fillRect(0, 0, w, RULER); ctx.fillStyle = 'rgba(212,166,74,0.25)'; ctx.fillRect(0, RULER - 1, w, 1);
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textBaseline = 'middle';
      let lastLabelX = -99;
      for (const L of lines) {
        const x = Math.round(this.xOf(L.sec)) + 0.5; if (x < KEYW || x > w) continue;
        if (L.kind === 'bar') { ctx.fillStyle = 'rgba(212,166,74,0.8)'; ctx.fillRect(x, RULER - 9, 1, 9); if (x - lastLabelX > 34) { const pos2 = s.meter.position(L.tick); ctx.fillStyle = P.bone; ctx.fillText(String(pos2.measure), x + 4, RULER - 17); lastLabelX = x; } }
        else if (L.kind === 'beat' && barPx > 90) { ctx.fillStyle = 'rgba(236,230,212,0.4)'; ctx.fillRect(x, RULER - 5, 1, 5); }
      }
      // time stamps
      ctx.fillStyle = P.ash; ctx.textAlign = 'right';
      const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300][[0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].findIndex(q => q * v.pps >= 90)] || 300;
      for (let tt = Math.ceil(Math.max(0, t0) / step) * step; tt < t1; tt += step) { const x = this.xOf(tt); if (x > KEYW + 30) ctx.fillText(fmtTime(tt), x - 3, RULER - 6 > 0 ? 8 : 8); }
      ctx.textAlign = 'left';
      // tempo markers
      const te = s.tempoMap.entries;
      for (let i = 0; i < te.length; i++) { const e = te[i]; if (e.implicit && te.length === 1) { ctx.fillStyle = P.ash; ctx.fillText('♩=120 (default)', KEYW + 6, 8); continue; } const x = this.xOf(e.sec); if (x < KEYW - 60 || x > w) continue; ctx.fillStyle = P.amber; ctx.beginPath(); ctx.moveTo(x, RULER - 1); ctx.lineTo(x - 4, RULER - 8); ctx.lineTo(x + 4, RULER - 8); ctx.closePath(); ctx.fill(); ctx.fillText('♩=' + e.bpm.toFixed(0), Math.max(KEYW + 2, x + 6), 8); }
      const ms = s.meter.entries; if (ms.length > 1 || !ms[0].implicit) for (const m of ms) { const x = this.xOf(s.tickToSec(m.tick)); if (x < KEYW - 30 || x > w) continue; ctx.fillStyle = P.bone; ctx.fillText(m.num + '/' + m.den, Math.max(KEYW + 2, x + 3), RULER - 24 < 0 ? 22 : 22); }
      if (rg) { const xa = Math.max(KEYW, this.xOf(rg.a)), xb = Math.min(w, this.xOf(rg.b)); ctx.fillStyle = 'rgba(212,166,74,0.35)'; ctx.fillRect(xa, RULER - 5, xb - xa, 4); }

      // piano keys
      ctx.fillStyle = P.void; ctx.fillRect(0, RULER, KEYW, h - RULER); ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left';
      for (let p = Math.min(127, pTop); p >= Math.max(0, pBot); p--) {
        const y = this.yOf(p + 1), pc = p % 12, black = BLACK.has(pc), lit = this.activePitches.has(p);
        ctx.fillStyle = lit ? P.amber : black ? '#16161c' : '#cfc9b8'; ctx.fillRect(black ? 0 : 0, y + 0.5, black ? KEYW * 0.62 : KEYW - 1, v.pph - 1);
        if (!black && lit) { ctx.fillStyle = P.amber; ctx.fillRect(0, y + 0.5, KEYW - 1, v.pph - 1); }
        if (inSet && inSet.has(pc) && !lit) { ctx.fillStyle = 'rgba(212,166,74,0.55)'; ctx.fillRect(KEYW - 4, y + 1, 3, v.pph - 2); }
        if (pc === 0 || (v.pph >= 15 && !black)) { ctx.fillStyle = lit ? '#000' : (black ? P.bone : '#222'); ctx.fillText(T.noteName(p, sel ? sel.flats : false), 4, y + v.pph / 2 + 1); }
      }
      ctx.fillStyle = 'rgba(212,166,74,0.25)'; ctx.fillRect(KEYW - 1, RULER, 1, h - RULER);
      this.drawMini(state, pos);
    }
    drawMini(state, pos) {
      const m = this.mini; if (!m || !this.seq) return; const dpr = Math.min(devicePixelRatio || 1, 2), r = m.getBoundingClientRect(); const W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
      if (!this.miniCache || this.miniCache.w !== W || this.miniCache.h !== H || this.miniCache.seq !== this.seq || this.miniCache.stamp !== (state.mixStamp || 0)) {
        const oc = document.createElement('canvas'); oc.width = W; oc.height = H; const x = oc.getContext('2d'); x.fillStyle = P.ink; x.fillRect(0, 0, W, H);
        const dur = Math.max(0.1, this.seq.musicalEndSec); let lo = 127, hi = 0; for (const n of this.seq.notes) { if (n.channel === 9) continue; if (n.pitch < lo) lo = n.pitch; if (n.pitch > hi) hi = n.pitch; } if (hi <= lo) { lo = 40; hi = 90; }
        for (const n of this.seq.notes) { if (!this.visibleTrack(n.track)) continue; const xx = n.startSec / dur * W, ww = Math.max(1, n.durSec / dur * W), yy = H - 3 - (n.channel === 9 ? 0.05 : (n.pitch - lo) / (hi - lo)) * (H - 6); x.fillStyle = V.rgba(V.trackColor(n.track), this.dimmed(n.track) ? 0.12 : 0.7); x.fillRect(xx, yy, ww, 1.5); }
        this.miniCache = { canvas: oc, w: W, h: H, seq: this.seq, stamp: state.mixStamp || 0 };
      }
      if (m.width !== Math.round(W * dpr)) { m.width = Math.round(W * dpr); m.height = Math.round(H * dpr); }
      const ctx = m.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.drawImage(this.miniCache.canvas, 0, 0, W, H);
      const dur = Math.max(0.1, this.seq.musicalEndSec), span = this.spanSec(), a = Math.max(0, this.view.t0) / dur * W, b = Math.min(1, (this.view.t0 + span) / dur) * W;
      ctx.fillStyle = 'rgba(212,166,74,0.10)'; ctx.fillRect(a, 0, Math.max(3, b - a), H); ctx.strokeStyle = 'rgba(212,166,74,0.7)'; ctx.strokeRect(a + 0.5, 0.5, Math.max(3, b - a) - 1, H - 1);
      const rg = state.scope && state.scope.region; if (rg) { ctx.fillStyle = 'rgba(240,197,106,0.18)'; ctx.fillRect(rg.a / dur * W, 0, (rg.b - rg.a) / dur * W, H); }
      ctx.fillStyle = P.amber; ctx.fillRect(pos / dur * W, 0, 1.5, H);
    }
  }
  function fmtTime(s) { const m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(r % 1 ? 1 : 0); }

  FO.PianoRoll = PianoRoll; FO.fmtTime = fmtTime;
})();
