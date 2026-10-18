/* Frequency Oasis — MIDI DNA
 * app.js : application core — shared state, worker-backed analysis client, file import, navigation, scope, transport.
 * Views live in views.js and read/write the same state object (FO.state), so a change of track, region or scale
 * reading updates every view.
 */
(function () {
  'use strict';
  const FO = (globalThis.FO = globalThis.FO || {});
  const V = FO.viz, T = FO.theory;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const NAV = [['overview', 'Overview'], ['arrangement', 'Arrangement'], ['notes', 'Notes'], ['key', 'Key & Scale'], ['chords', 'Chords'], ['rhythm', 'Rhythm'], ['mood', 'Mood'], ['tracks', 'Track Intelligence'], ['playback', 'Playback']];

  const S = FO.state = {
    engine: new FO.audio.Engine(), parsed: null, seq: null, info: null, analysis: null, byId: [], seqIndex: 0,
    scope: { tracks: null, region: null }, readKey: null, chordWindow: 'auto', rhythmGrid: null, lineTrack: null, lineMode: 'top', pair: null, compare: { A: null, B: null },
    selNoteId: null, selChordIdx: null, activeChordIndex: null, view: 'overview', hidden: new Set(), mixStamp: 0, maxDur: 0,
    exciteNotes: null, exciteUntil: 0, exciteLabel: '', busy: 0, analysisToken: 0
  };

  /* ---------------- small UI helpers ---------------- */
  let toastTimer = 0;
  function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, err ? 7000 : 3600); }
  function tip(html, x, y) { const t = $('#tip'); if (!html) { t.hidden = true; return; } t.innerHTML = html; t.hidden = false; const w = t.offsetWidth, h = t.offsetHeight; t.style.left = Math.min(innerWidth - w - 8, x + 14) + 'px'; t.style.top = Math.min(innerHeight - h - 8, Math.max(8, y + 14)) + 'px'; }
  function busy(on, text) { S.busy = Math.max(0, S.busy + (on ? 1 : -1)); const b = $('#busy'); b.hidden = S.busy === 0; if (text) $('#busyText').textContent = text; }
  const flatsNow = () => (S.analysis && S.analysis.selected ? S.analysis.selected.flats : false);
  const nName = (p) => T.noteName(p, flatsNow());
  const fmtT = FO.fmtTime;

  /* ---------------- analysis client (worker, with main-thread fallback) ---------------- */
  const SRC = ['theory.js', 'midi-parser.js', 'analysis-tonal.js', 'analysis-motion.js', 'analysis-character.js', 'analysis-session.js'];
  const GLUE = `let session=null;onmessage=(e)=>{const m=e.data;try{
if(m.type==='open'){session=new FO.AnalysisSession(m.buffer,m.fileName);postMessage({id:m.id,ok:true,result:session.setSequence(m.seqIndex||0)});}
else if(m.type==='sequence'){postMessage({id:m.id,ok:true,result:session.setSequence(m.seqIndex)});}
else if(m.type==='compute'){postMessage({id:m.id,ok:true,result:session.compute(m.req)});}
}catch(err){postMessage({id:m.id,ok:false,error:{message:err.message,name:err.name,detail:err.detail||null}});}};`;
  class Analyzer {
    constructor() { this.worker = null; this.pending = new Map(); this.n = 0; this.session = null; this.ready = this.init(); }
    async init() {
      try {
        if (typeof Worker === 'undefined' || location.protocol === 'file:') throw new Error('no worker');
        const texts = await Promise.all(SRC.map(f => fetch(f).then(r => { if (!r.ok) throw new Error(f); return r.text(); })));
        const blob = new Blob(['globalThis.FO=globalThis.FO||{};\n' + texts.join('\n;\n') + '\n;' + GLUE], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob); this.worker = new Worker(url); URL.revokeObjectURL(url);
        this.worker.onmessage = (e) => { const m = e.data, p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); if (m.ok) p.res(m.result); else { const er = new Error(m.error.message); er.name = m.error.name; er.detail = m.error.detail; p.rej(er); } };
        this.worker.onerror = (e) => { console.warn('analysis worker failed, using main thread', e.message); this.worker = null; for (const p of this.pending.values()) p.rej(new Error('Analysis worker crashed.')); this.pending.clear(); };
        this.mode = 'worker';
      } catch (e) { this.worker = null; this.mode = 'main'; }
    }
    call(type, payload, transfer) {
      return this.ready.then(() => new Promise((res, rej) => {
        const id = ++this.n;
        if (this.worker) { this.pending.set(id, { res, rej }); this.worker.postMessage(Object.assign({ type, id }, payload), transfer || []); return; }
        setTimeout(() => { try {
          if (type === 'open') { this.session = new FO.AnalysisSession(payload.buffer, payload.fileName); res(this.session.setSequence(payload.seqIndex || 0)); }
          else if (type === 'sequence') res(this.session.setSequence(payload.seqIndex));
          else res(this.session.compute(payload.req));
        } catch (err) { rej(err); } }, 0);
      }));
    }
    open(buffer, fileName, seqIndex) { return this.call('open', { buffer, fileName, seqIndex }, this.mode === 'worker' ? [buffer] : []); }
    sequence(seqIndex) { return this.call('sequence', { seqIndex }); }
    compute(req) { return this.call('compute', { req }); }
  }
  const analyzer = new Analyzer();

  function reqFromState() {
    const sc = S.scope;
    return { tracks: sc.tracks ? [...sc.tracks] : null, region: sc.region ? { a: sc.region.a, b: sc.region.b } : null, key: S.readKey, chordWindow: S.chordWindow, rhythmGrid: S.rhythmGrid, lineTrack: S.lineTrack, lineMode: S.lineMode, pair: S.pair, compare: (S.compare.A && S.compare.B) ? { A: S.compare.A, B: S.compare.B } : null };
  }
  let recTimer = 0;
  function recompute(delay) {
    if (!S.seq) return Promise.resolve();
    clearTimeout(recTimer);
    return new Promise((resolve) => { recTimer = setTimeout(async () => {
      const token = ++S.analysisToken; busy(true, 'Analysing…');
      try { const res = await analyzer.compute(reqFromState()); if (token !== S.analysisToken) return resolve(); S.analysis = res; afterAnalysis(); }
      catch (e) { console.error(e); toast('Analysis failed: ' + e.message, true); }
      finally { busy(false); resolve(); }
    }, delay === undefined ? 70 : delay); });
  }
  function afterAnalysis() {
    const A = S.analysis; S.activeChordIndex = null;
    if (A && A.line && S.lineTrack === null) S.lineTrack = A.line.track;
    if (A && A.selected && !S.readKey) { /* following the best reading */ }
    S.mixStamp++; computeActive();
    const v = FO.views[S.view]; if (v && v.update) v.update('analysis');
    FO.heroHelix && FO.heroHelix.setSeq && null;
    if (S.helix) S.helix.setSeq(S.seq, A);
    V.invalidate();
  }

  /* ---------------- file import ---------------- */
  function showLoadError(e) {
    const msg = (e && e.message) || String(e);
    const el = $('#loadError'); el.hidden = false; el.innerHTML = `<strong>That file could not be read.</strong><br>${esc(msg)}<br><small>Standard MIDI Files (.mid / .midi) are expected. If it plays in your DAW, try re-exporting it as a Type 1 MIDI file.</small>`;
    toast(msg, true);
  }
  async function loadFile(file) {
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) { showLoadError(new Error('This file is over 40 MB, which is unusually large for a MIDI file. It was not opened.')); return; }
    try { const buf = await file.arrayBuffer(); await loadBuffer(buf, file.name); } catch (e) { showLoadError(e); }
  }
  async function loadBuffer(buf, name, seqIndex) {
    seqIndex = seqIndex || 0; busy(true, 'Reading MIDI…'); $('#loadError').hidden = true;
    try {
      const parsed = FO.midi.parse(buf.slice(0), name); // fast, main thread: playback + piano roll need it
      const seqI = Math.min(seqIndex, parsed.sequences.length - 1);
      const info = await analyzer.open(buf.slice(0), name, seqI);
      commit(parsed, info, seqI);
      if (parsed.warnings.length) setTimeout(() => toast(`Opened with ${parsed.warnings.length} parser note${parsed.warnings.length > 1 ? 's' : ''} — see Overview.`), 400);
      return true;
    } catch (e) { if (S.seq) toast('Could not open: ' + e.message, true); showLoadError(e); return false; }
    finally { busy(false); }
  }
  function commit(parsed, info, seqI) {
    S.engine.stop(); S.parsed = parsed; S.info = info; S.seqIndex = seqI; S.seq = parsed.sequences[seqI];
    S.byId = []; for (const n of S.seq.notes) S.byId[n.id] = n; S.maxDur = 0; for (const n of S.seq.notes) if (n.durSec > S.maxDur) S.maxDur = n.durSec;
    S.scope = { tracks: null, region: null }; S.readKey = null; S.chordWindow = 'auto'; S.rhythmGrid = null; S.lineTrack = null; S.lineMode = 'top'; S.pair = null; S.compare = { A: null, B: null }; S.selNoteId = null; S.selChordIdx = null; S.analysis = null; S.hidden = new Set();
    S.engine.load(S.seq); S.engine.setMasterVolume(+$('#tVol').value / 100); S.engine.setRate(+$('#tRate').value);
    document.body.classList.remove('no-file'); $('#landing').hidden = true; $('#app').hidden = false; $('#transport').hidden = false; $('#scopeBar').hidden = false; $('#btnExport').disabled = false;
    const chip = $('#fileChip'); chip.hidden = false; chip.textContent = info.fileName; chip.title = info.fileName;
    $('#tDur').textContent = fmtT(S.seq.musicalEndSec); renderNav(); renderScope();
    if (!S.helix) S.helix = null;
    go(S.view && S.view !== 'landing' ? (location.hash.startsWith('#v=') ? location.hash.slice(3) : 'overview') : 'overview', true);
    recompute(0);
  }
  async function setSequence(i) { if (!S.parsed || i === S.seqIndex) return; busy(true, 'Switching sequence…'); try { const info = await analyzer.sequence(i); commit(S.parsed, info, i); } catch (e) { toast(e.message, true); } finally { busy(false); } }

  /* ---------------- scope (tracks + region) ---------------- */
  function setScope(patch) { Object.assign(S.scope, patch); renderScope(); if (S.roll) S.roll.setRegion(S.scope.region); recompute(); const v = FO.views[S.view]; if (v && v.update) v.update('scope'); }
  function effectiveTracks() { return S.scope.tracks ? new Set(S.scope.tracks) : new Set(S.seq.musicalTracks.map(t => t.index)); }
  function toggleScopeTrack(i) {
    const all = S.seq.musicalTracks.map(t => t.index); const cur = effectiveTracks(); let next;
    if (cur.size === all.length) next = new Set([i]); else { next = new Set(cur); if (next.has(i)) next.delete(i); else next.add(i); }
    if (next.size === 0 || next.size === all.length) setScope({ tracks: null }); else setScope({ tracks: [...next].sort((a, b) => a - b) });
  }
  function renderScope() {
    const el = $('#scopeBar'); if (!S.seq) return; const cur = effectiveTracks(), all = S.seq.musicalTracks;
    el.innerHTML = `<b>Analysis scope</b><button class="tchip" data-sc="all" aria-pressed="${!S.scope.tracks}">All tracks</button>` +
      all.map(t => `<button class="tchip" data-sc="${t.index}" aria-pressed="${S.scope.tracks ? cur.has(t.index) : false}" title="Click to analyse only this track; click others to add or remove"><i style="background:${V.trackColor(t.index)}"></i>${esc(trackName(t.index))}</button>`).join('') +
      `<span class="sep"></span>` + (S.scope.region ? `<span>Region <b>${fmtT(S.scope.region.a)}–${fmtT(S.scope.region.b)}</b> (bars ${S.seq.meter.position(S.seq.secToTick(S.scope.region.a)).measure}–${S.seq.meter.position(Math.max(0, S.seq.secToTick(S.scope.region.b) - 1)).measure})</span><button class="tchip" data-sc="clearregion">Clear region</button>` : `<span class="dim">Drag on the arrangement ruler to analyse a region</span>`);
  }
  function trackName(i) { const t = S.info.tracks[i]; return (t && t.name) || (t && t.virtual ? 'Ch ' + (t.channels[0] + 1) : 'Track ' + (i + 1)); }

  /* ---------------- navigation ---------------- */
  function renderNav() {
    $('#nav').innerHTML = NAV.map(([k, label], i) => `<button type="button" role="tab" data-v="${k}" aria-selected="${k === S.view}" ${S.seq ? '' : 'disabled'}><i>${String(i + 1).padStart(2, '0')}</i>${label}</button>`).join('');
  }
  function go(name, force) {
    if (!S.seq) return; if (!FO.views[name]) name = 'overview';
    if (name === S.view && !force && S.mounted === name) return;
    const prev = FO.views[S.mounted]; if (prev && prev.unmount) prev.unmount();
    S.view = name; S.mounted = name; const body = $('#viewbody'); body.innerHTML = ''; FO.views[name].mount(body); if (FO.views[name].update) FO.views[name].update('mount');
    document.querySelectorAll('#nav button').forEach(b => b.setAttribute('aria-selected', b.dataset.v === name ? 'true' : 'false'));
    try { history.replaceState(null, '', '#v=' + name); } catch (e) {}
    body.scrollIntoView && window.scrollTo({ top: 0 }); V.invalidate();
  }

  /* ---------------- selection ---------------- */
  function excite(notes, label) { S.exciteNotes = notes; S.exciteUntil = performance.now() / 1000 + 1.5; S.exciteLabel = label || 'selection'; }
  function selectNote(id, opts) {
    opts = opts || {}; S.selNoteId = id; if (S.roll) S.roll.selectNote(id, opts.center);
    if (id !== null) { const n = S.byId[id]; if (n && n.channel !== 9) excite([{ pitch: n.pitch, velocity: n.velocity }], 'selected note'); if (opts.audition && n) auditionNote(n); if (opts.seek && n) S.engine.seek(n.startSec); }
    const v = FO.views[S.view]; if (v && v.update) v.update('selection');
  }
  function auditionNote(n) { if (n.channel === 9) { S.engine.audition(n.track, n.pitch, n.velocity / 127); return; } S.engine.audition(n.track, n.pitch, n.velocity / 127); }
  function selectChord(idx, opts) {
    opts = opts || {}; S.selChordIdx = idx; const A = S.analysis; const seg = A && A.chords ? A.chords.segments[idx] : null;
    if (seg && seg.kind === 'chord') {
      const ps = new Map(); for (const id of seg.noteIds) { const n = S.byId[id]; if (n && n.channel !== 9 && n.startSec < seg.endSec) ps.set(n.pitch, n); }
      const notes = [...ps.values()].sort((a, b) => a.pitch - b.pitch).slice(0, 8); excite(notes.map(n => ({ pitch: n.pitch, velocity: n.velocity })), 'chord ' + seg.label);
      if (opts.audition && notes.length) { const tr = notes[0].track; notes.forEach((n, i) => setTimeout(() => S.engine.audition(tr, n.pitch, 0.7), i * 40)); }
      if (opts.seek) S.engine.seek(seg.startSec);
    }
    computeActive(); const v = FO.views[S.view]; if (v && v.update) v.update('chord');
  }
  function computeActive() {
    const A = S.analysis; let idx = null;
    if (A && A.chords && A.chords.segments.length) {
      if (!S.engine.playing && S.selChordIdx !== null && S.selChordIdx !== undefined) idx = S.selChordIdx;
      else { const seg = FO.tonal.chordAt(A.chords, S.engine.position); idx = seg ? seg.idx : (S.selChordIdx !== null ? S.selChordIdx : null); }
    }
    const changed = idx !== S.activeChordIndex; S.activeChordIndex = idx; return changed;
  }
  function seek(sec) { S.engine.seek(sec); }

  /* ---------------- transport ---------------- */
  const playPath = 'M8 5v14l11-7z', pausePath = 'M7 5h4v14H7zM13 5h4v14h-4z';
  async function togglePlay() {
    if (!S.seq) return; const e = S.engine;
    try { if (e.playing) e.pause(); else await e.play(); } catch (err) { toast('Audio could not start: ' + err.message, true); }
    syncPlayButton();
  }
  function syncPlayButton() { const p = S.engine.playing; $('#tPlay').setAttribute('aria-label', p ? 'Pause' : 'Play'); $('#tPlayIcon').innerHTML = `<path d="${p ? pausePath : playPath}"/>`; }
  function bindTransport() {
    $('#tPlay').onclick = togglePlay; $('#tStop').onclick = () => { S.engine.stop(); syncPlayButton(); };
    $('#tStart').onclick = () => S.engine.seek(0);
    $('#tLoop').onclick = (e) => { const b = e.currentTarget, on = b.getAttribute('aria-pressed') !== 'true'; if (on && !S.scope.region) { toast('Drag on the arrangement ruler first to choose a region to loop.'); return; } b.setAttribute('aria-pressed', on); S.engine.setLoop(on ? S.scope.region.a : null, on ? S.scope.region.b : null); if (on) S.engine.seek(S.scope.region.a); };
    const seekEl = $('#tSeek'); let dragging = false;
    seekEl.addEventListener('input', () => { dragging = true; S.engine.seek(seekEl.value / 1000 * S.seq.musicalEndSec); }); seekEl.addEventListener('change', () => { dragging = false; });
    $('#tRate').onchange = (e) => S.engine.setRate(+e.target.value); $('#tVol').oninput = (e) => S.engine.setMasterVolume(e.target.value / 100);
    S.engine.on('state', syncPlayButton); S.engine.on('ended', () => { syncPlayButton(); });
    const meter = $('#tMeter'); const mctx = meter.getContext('2d'); let lastUi = 0;
    function ui(now) {
      requestAnimationFrame(ui); if (now - lastUi < 33) return; lastUi = now;
      if (!S.seq) return; const e = S.engine, pos = e.position, dur = S.seq.musicalEndSec;
      $('#tTime').textContent = fmtT(Math.min(pos, dur)); if (!dragging) seekEl.value = Math.round(Math.min(1, pos / Math.max(0.001, dur)) * 1000);
      const p = S.seq.meter.position(Math.round(S.seq.secToTick(pos))); $('#tBar').textContent = p.measure + '.' + p.beat;
      const te = S.seq.tempoMap.entries; let bi = 0; for (let i = 0; i < te.length; i++) if (te[i].sec <= pos) bi = i; $('#tBpm').textContent = (te[bi].bpm * e.rate).toFixed(te[bi].bpm % 1 ? 1 : 0);
      if (computeActive()) { const v = FO.views[S.view]; if (v && v.update) v.update('active'); }
      mctx.clearRect(0, 0, 60, 22); const lvl = e.playing ? Math.min(1, e.level * 3) : 0; for (let i = 0; i < 12; i++) { const on = lvl * 12 > i; mctx.fillStyle = on ? (i > 9 ? '#e0703f' : '#d4a64a') : '#23242e'; mctx.fillRect(i * 5, 22 - (4 + i * 1.5), 3.4, 4 + i * 1.5); }
      if (S.engine.loop && !S.scope.region) { S.engine.setLoop(null); $('#tLoop').setAttribute('aria-pressed', 'false'); }
    }
    requestAnimationFrame(ui);
  }

  /* ---------------- dialogs ---------------- */
  function openExport() { if (!S.seq) return; $('#exportBody').innerHTML = FO.views.exportPanel(); $('#dlgExport').showModal(); FO.views.bindExport($('#exportBody')); }
  function openAbout() { $('#aboutBody').innerHTML = FO.views.aboutPanel(); $('#dlgAbout').showModal(); }

  /* ---------------- boot ---------------- */
  function boot() {
    V.perf.init(); document.body.classList.add('no-file');
    $('#btnLite').setAttribute('aria-pressed', V.perf.lite); $('#btnMotion').setAttribute('aria-pressed', V.perf.reduced); document.body.classList.toggle('calm', V.perf.reduced);
    $('#btnLite').onclick = (e) => { V.perf.lite = !V.perf.lite; V.perf.save(); e.currentTarget.setAttribute('aria-pressed', V.perf.lite); V.invalidate(); toast(V.perf.lite ? 'Performance mode on — fewer particles, 30 fps.' : 'Full visuals on.'); };
    $('#btnMotion').onclick = (e) => { V.perf.reduced = !V.perf.reduced; V.perf.save(); document.body.classList.toggle('calm', V.perf.reduced); e.currentTarget.setAttribute('aria-pressed', V.perf.reduced); V.invalidate(); toast(V.perf.reduced ? 'Calm mode: animation reduced.' : 'Motion restored.'); };
    const pick = () => $('#file').click(); $('#btnOpen').onclick = pick; $('#btnOpen2').onclick = pick;
    $('#file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; loadFile(f); };
    const demo = async () => { const b = FO.demo.build(); await loadBuffer(b.buffer.slice(0), FO.demo.fileName); }; $('#btnDemo').onclick = demo; $('#btnDemo2').onclick = demo;
    $('#btnExport').onclick = openExport; $('#btnAbout').onclick = openAbout;
    $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b && !b.disabled) go(b.dataset.v); });
    $('#scopeBar').addEventListener('click', (e) => { const b = e.target.closest('button[data-sc]'); if (!b) return; const k = b.dataset.sc; if (k === 'all') setScope({ tracks: null }); else if (k === 'clearregion') setScope({ region: null }); else toggleScopeTrack(+k); });
    // drag & drop
    let dc = 0; const veil = $('#dropVeil');
    addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dc++; veil.hidden = false; } });
    addEventListener('dragleave', () => { dc = Math.max(0, dc - 1); if (!dc) veil.hidden = true; });
    addEventListener('dragover', (e) => { e.preventDefault(); });
    addEventListener('drop', (e) => { e.preventDefault(); dc = 0; veil.hidden = true; const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadFile(f); });
    addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase(); if (['input', 'select', 'textarea'].includes(tag) || e.target.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!S.seq) return;
      if (e.code === 'Space' && tag !== 'button') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'Home') { S.engine.seek(0); } else if (/^[1-9]$/.test(e.key) && tag !== 'canvas') go(NAV[+e.key - 1][0]);
    });
    window.addEventListener('beforeunload', () => { try { S.engine.destroy(); } catch (e) {} });
    bindTransport();
    // hero helix (dormant until a file is loaded)
    FO.heroHelix = new FO.Helix($('#heroHelix'), {}); new FO.Ambient($('#ambient'));
    if ('launchQueue' in window) launchQueue.setConsumer(async (p) => { if (p.files && p.files.length) { const f = await p.files[0].getFile(); loadFile(f); } });
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) navigator.serviceWorker.register('sw.js').catch(() => {});
    FO.app.ready = true;
  }

  FO.app = { S, $, esc, toast, tip, busy, nName, fmtT, analyzer, recompute, loadFile, loadBuffer, setSequence, setScope, toggleScopeTrack, effectiveTracks, trackName, go, selectNote, selectChord, auditionNote, seek, excite, togglePlay, openExport, openAbout, renderScope, flatsNow, NAV, ready: false };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
