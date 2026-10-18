/* Frequency Oasis — MIDI DNA
 * views.js : shared view helpers + Overview, Arrangement and Notes views.
 * (views2.js: Key, Chords, Rhythm · views3.js: Mood, Track Intelligence, Playback, Export, About)
 */
(function () {
  'use strict';
  const FO = (globalThis.FO = globalThis.FO || {});
  const V = FO.viz, T = FO.theory, U = FO.util;
  FO.views = FO.views || {};
  const A = () => FO.app, S = () => FO.state;
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';
  const f1 = (x, d = 1) => (x === null || x === undefined || isNaN(x) ? '–' : Number(x).toFixed(d));

  /* ---------- helpers shared by all views ---------- */
  const H = FO.H = {
    esc, pct, f1,
    conf(c) { const k = c >= 0.66 ? 'hi' : c >= 0.33 ? 'mid' : 'lo'; return `<span class="badge ${k}" title="Heuristic confidence ${c.toFixed(2)} — see the formula in Key &amp; Scale">${c >= 0.66 ? 'High' : c >= 0.33 ? 'Moderate' : 'Low'} · ${c.toFixed(2)}</span>`; },
    panel(title, idx, body, o) { o = o || {}; return `<section class="panel ${o.cls || ''}" ${o.id ? `id="${o.id}"` : ''}><div class="ph"><span class="idx">${idx || ''}</span><h2>${title}</h2>${o.aside ? `<span class="aside">${o.aside}</span>` : ''}</div>${body}</section>`; },
    head(title, em, sub) { return `<div class="view-head"><h1>${title} <em>${em || ''}</em></h1>${sub ? `<p>${sub}</p>` : ''}</div>`; },
    bars(vals, o) {
      o = o || {}; const W = o.w || 360, Hh = o.h || 120, padB = o.labels ? 18 : 4, n = vals.length, mx = o.max || Math.max(1e-9, ...vals), bw = W / n;
      let s = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(o.label || 'chart')}" style="width:100%;height:auto;display:block;overflow:visible">`;
      s += `<line x1="0" x2="${W}" y1="${Hh - padB + .5}" y2="${Hh - padB + .5}" stroke="rgba(236,230,212,.15)"/>`;
      vals.forEach((v, i) => { const bh = (v / mx) * (Hh - padB - 6), x = i * bw; const col = (o.colors && o.colors[i]) || o.color || '#d4a64a'; s += `<rect x="${x + 1}" y="${Hh - padB - bh}" width="${Math.max(1, bw - 2)}" height="${Math.max(0, bh)}" fill="${col}" opacity="${o.op ? o.op[i] : .88}"><title>${esc(o.titles ? o.titles[i] : (o.labels ? o.labels[i] + ': ' : '') + (o.fmt ? o.fmt(v) : v))}</title></rect>`; if (o.labels && (!o.every || i % o.every === 0)) s += `<text x="${x + bw / 2}" y="${Hh - 4}" text-anchor="middle" font-size="9" fill="#7c7e8d" font-family="ui-monospace,monospace">${esc(o.labels[i])}</text>`; });
      return s + '</svg>';
    },
    spark(vals, o) { o = o || {}; const W = o.w || 220, Hh = o.h || 36, mx = Math.max(1e-9, ...vals), n = vals.length; if (!n) return ''; let d = vals.map((v, i) => `${(i / Math.max(1, n - 1) * W).toFixed(1)},${(Hh - 2 - (v / mx) * (Hh - 6)).toFixed(1)}`).join(' L'); return `<svg viewBox="0 0 ${W} ${Hh}" style="width:100%;height:${Hh}px;display:block" aria-hidden="true"><path d="M${d} L${W},${Hh} L0,${Hh} Z" fill="${o.fill || 'rgba(212,166,74,.14)'}"/><path d="M${d}" fill="none" stroke="${o.color || '#d4a64a'}" stroke-width="1.2"/></svg>`; },
    posStr(tick) { const p = S().seq.meter.position(tick); return `${p.measure}.${p.beat}`; },
    posLong(tick) { const p = S().seq.meter.position(tick); return `bar ${p.measure}, beat ${p.beat}${p.tickInBeat > 1 ? ' + ' + Math.round(p.tickInBeat) + ' ticks' : ''}`; },
    nn(p) { return FO.app.nName(p); },
    trackBadge(i) { const t = S().info.tracks[i]; return `<span style="display:inline-block;width:8px;height:8px;background:${V.trackColor(i)};margin-right:6px"></span>${esc(FO.app.trackName(i))}`; },
    scopedNotes() { const s = S(), set = s.scope.tracks ? new Set(s.scope.tracks) : null, r = s.scope.region; return s.seq.notes.filter(n => (!set || set.has(n.track)) && (!r || (n.startSec >= r.a && n.startSec < r.b))); },
    wait(msg) { return `<div class="empty">${esc(msg || 'Analysing…')}</div>`; },
    noData(msg) { return `<div class="empty">${esc(msg)}</div>`; },
    delegate(root, evt, fn) { root.addEventListener(evt, (e) => fn(e)); }
  };

  /* ============================================================ OVERVIEW */
  FO.views.overview = {
    mount(el) {
      const s = S(), I = s.info;
      el.innerHTML = H.head('Evidence', `board · ${esc(I.fileName.replace(/\.(mid|midi)$/i, ''))}`, 'A first look at what the file contains. Measured facts come first; interpretations are marked as hypotheses.') +
        `<div class="grid g-wide"><section class="panel flush"><canvas id="ovHelix" class="viz" style="height:min(56vh,480px);border:0" aria-label="MIDI DNA helix of the loaded file" role="img"></canvas></section><div class="grid" style="align-content:start"><div id="ovFacts"></div><div id="ovTraits"></div></div></div>` +
        `<div class="grid g3" style="margin-top:var(--gut)" id="ovCards"></div><div id="ovWarn" style="margin-top:var(--gut)"></div>`;
      s.helix = new FO.Helix(el.querySelector('#ovHelix'), { onSeek: (t) => A().seek(t) }); s.helix.setSeq(s.seq, s.analysis);
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) A().go(b.dataset.go); const q = e.target.closest('[data-seq]'); if (q) A().setSequence(+q.dataset.seq); });
    },
    unmount() { const s = S(); if (s.helix) { V.unregister(s.helix); if (s.helix._ro) s.helix._ro.disconnect(); s.helix = null; } },
    update() {
      const s = S(), I = s.info, a = s.analysis, el = document.getElementById('ovFacts'); if (!el) return;
      const tempo = I.tempo, tsTxt = I.timeSigs.map(t => t.num + '/' + t.den + (t.implicit ? '*' : '')).join(' → ');
      const seqSel = I.sequences.length > 1 ? `<div class="notice warn">MIDI format 2 file with <b>${I.sequences.length} independent sequences</b>. They are different pieces, not one composition — pick one: ${I.sequences.map(q => `<button class="btn sm ${q.id === I.seqIndex ? '' : 'ghost'}" data-seq="${q.id}">${esc(q.label)} · ${q.notes} notes</button>`).join(' ')}</div>` : '';
      el.innerHTML = seqSel + H.panel('File', '01', `<div class="tiles"><div class="tile"><span>Tracks</span><b>${I.musicalTrackCount}</b><small>${I.trackCount} chunks incl. meta</small></div><div class="tile"><span>Notes</span><b>${I.noteCount.toLocaleString()}</b><small>${a && a.stats && a.stats.count ? 'range ' + H.nn(s.byId[a.stats.lowest].pitch) + '–' + H.nn(s.byId[a.stats.highest].pitch) : ''}</small></div><div class="tile"><span>Duration</span><b>${FO.fmtTime(I.musicalEndSec)}</b><small>to last note</small></div><div class="tile"><span>Tempo</span><b>${tempo.changes ? f1(tempo.minBpm, 0) + '–' + f1(tempo.maxBpm, 0) : f1(tempo.meanBpm, tempo.meanBpm % 1 ? 1 : 0)}</b><small>BPM${tempo.implicit ? ' · default' : ''}</small></div><div class="tile"><span>Meter</span><b>${tsTxt}</b><small>${I.timeSigs[0].implicit ? '* assumed' : 'from file'}</small></div><div class="tile"><span>Format</span><b>${I.format}</b><small>${I.ppq} PPQ · ${(I.bytes / 1024).toFixed(1)} KB</small></div></div>`);
      document.getElementById('ovTraits').innerHTML = H.panel('Detected structural characteristics', '02', I.traits.length ? `<ul class="list tight">${I.traits.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="note">Nothing unusual detected: a plain, conventional file.</p>');
      const cards = document.getElementById('ovCards'); if (!cards) return;
      if (!a) { cards.innerHTML = H.panel('Analysis', '03', H.wait('Analysing the notes…')); return; }
      if (a.empty && !a.scope.noteCount) { cards.innerHTML = H.panel('Scope', '03', H.noData('The current scope contains no notes. Clear the region or add tracks to the scope.')); return; }
      const k = a.key, c = a.chords, r = a.rhythm, m = a.mood, st = a.structure;
      const keyCard = k ? H.panel('Key & scale', '03', `<p class="h-serif">${esc(k.best.rootName)} ${esc(k.best.scaleName.split(' (')[0])}</p><p>${H.conf(k.centreConfidence)} <span class="dim mono" style="font-size:11px">tonal centre</span> ${H.conf(k.scaleConfidence)} <span class="dim mono" style="font-size:11px">scale</span></p><p class="note"><b>${esc(k.verdict)}.</b> ${esc(k.verdictText)}</p><button class="btn sm ghost" data-go="key">Open evidence →</button>`) : '';
      const chordCard = c ? H.panel('Harmony', '04', `<p class="h-serif">${c.chordCount} chord events <small>${c.vocabulary.length} distinct</small></p><p>${c.vocabulary.slice(0, 12).map(x => `<span class="pill">${esc(x)}</span>`).join('')}</p>${c.progressions[0] ? `<p class="note"><b>Most repeated:</b> ${esc(c.progressions[0].labels.join(' → '))} ×${c.progressions[0].count}</p>` : '<p class="note">No repeated chord progression found.</p>'}<button class="btn sm ghost" data-go="chords">Open chords →</button>`) : '';
      const rhCard = r && r.grid ? H.panel('Rhythm', '05', `<p class="h-serif">${esc(r.swing.verdict)}</p><p class="note">${r.deviation.within10 >= 0.9 ? 'Onsets lie within 10 ms of the grid.' : `Mean timing deviation ${f1(r.deviation.meanAbsMs, 1)} ms.`} Off-beat share ${pct(r.syncopation.offbeatShare)}; syncopated onsets ${pct(r.syncopation.syncopatedShare)}.</p><p class="note">Pulse candidates: ${r.tempo.inferred.slice(0, 3).map(x => f1(x.bpm, 0) + ' BPM').join(', ') || 'n/a'}.</p><button class="btn sm ghost" data-go="rhythm">Open rhythm →</button>`) : '';
      const moodCard = m ? H.panel('Character (hypothesis)', '06', `<p class="note" style="margin-top:0">${esc(m.summary)}</p>${m.dims.slice(0, 4).map(d => `<div class="dimrow"><div class="ends"><span>${d.left}</span><span>${d.right}</span></div><div class="gauge"><i style="left:${(d.value * 100).toFixed(1)}%"></i></div></div>`).join('')}<button class="btn sm ghost" data-go="mood">Open mood terrain →</button>`) : '';
      const stCard = st && st.regions ? H.panel('Structure (estimated)', '07', `<p class="h-serif">${st.regions.length} region${st.regions.length === 1 ? '' : 's'}</p><p class="note">${st.silences.length} silence${st.silences.length === 1 ? '' : 's'} · ${st.abrupt.length} abrupt change${st.abrupt.length === 1 ? '' : 's'} · ${st.repeated.length} repeated span pair${st.repeated.length === 1 ? '' : 's'}.</p>${st.regions.slice(0, 6).map((rg, i) => `<span class="pill">${String.fromCharCode(65 + i % 26)} · bars ${rg.startMeasure}–${rg.endMeasure} · ${rg.character}</span>`).join('')}<br><button class="btn sm ghost" data-go="arrangement">Open arrangement →</button>`) : '';
      const roleCard = a.roles && a.roles.length ? H.panel('Tracks (roles are hypotheses)', '08', `<ul class="list tight">${a.roles.map(t => `<li><b>${H.trackBadge(t.index)}</b> — ${esc(t.role)} ${t.role !== 'ambiguous' ? H.conf(t.roleConfidence) : ''}</li>`).join('')}</ul><button class="btn sm ghost" data-go="tracks">Open track intelligence →</button>`) : '';
      cards.innerHTML = keyCard + chordCard + rhCard + moodCard + stCard + roleCard;
      const w = document.getElementById('ovWarn'); w.innerHTML = I.warnings.length ? H.panel('Parser notes', '09', `<ul class="list tight">${I.warnings.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p class="note">Nothing was silently discarded: every repair or skip is listed here.</p>`) : '';
    }
  };

  /* ============================================================ ARRANGEMENT */
  FO.views.arrangement = {
    mount(el) {
      const s = S();
      el.innerHTML = H.head('Arrangement', '', 'The living piano roll. Click a note to inspect it, drag the ruler to choose a region to analyse, click the ruler to seek. Wheel scrolls pitch · Shift+wheel scrolls time · Ctrl+wheel zooms time · Alt+wheel zooms pitch.') +
        `<div class="toolbar"><span class="seg"><button data-a="zx-" aria-label="Zoom out time">−</button><button data-a="zx+" aria-label="Zoom in time">+</button><button data-a="fit">Fit</button></span><span class="seg"><button data-a="zy-" aria-label="Narrower pitch rows">▁</button><button data-a="zy+" aria-label="Taller pitch rows">█</button></span>
<button class="btn ghost sm" data-a="follow" aria-pressed="true">Follow playhead</button><button class="btn ghost sm" data-a="scale" aria-pressed="true" title="Tint scale tones and mark out-of-scale notes in red">Scale fit</button><button class="btn ghost sm" data-a="rel" aria-pressed="true" title="Show interval relationships of the selected note">Relations</button><span class="grow"></span><span id="rollHint" class="dim"></span></div>
<div class="grid g-side"><div><div class="roll-wrap"><canvas id="rollCanvas"></canvas><canvas id="rollMini" aria-label="Minimap. Click to move the view." role="img"></canvas></div><div class="legend"><span><i style="background:#d4a64a"></i>note colour = track</span><span><i style="background:#b4412f"></i>red edge = outside the selected scale</span><span><i style="background:rgba(212,166,74,.35)"></i>gold tint = scale tones</span><span>◆ = percussion</span></div></div><div id="inspector"></div></div>
<div class="grid g-wide" style="margin-top:var(--gut)"><div id="trackList"></div><div id="regionTools"></div></div>
<div id="armapPanel" style="margin-top:var(--gut)"></div>`;
      const roll = s.roll = new FO.PianoRoll({ canvas: el.querySelector('#rollCanvas'), mini: el.querySelector('#rollMini'), callbacks: {
        onSelect: (id) => A().selectNote(id), onSeek: (t) => A().seek(t), onRegion: (r) => A().setScope({ region: r }),
        onHover: (n, x, y) => { if (!n) { A().tip(null); return; } const a = s.analysis, sel = a && a.selected; const inS = sel ? (sel.inSet.has(n.pitch % 12) ? 'in scale' : 'outside scale') : ''; A().tip(`<b>${H.nn(n.pitch)}${T.octave(n.pitch)}</b> · MIDI ${n.pitch}${n.channel === 9 ? ' · ' + esc(FO.midi.gmDrumName(n.pitch)) : ''}<br>${H.posStr(n.startTick)} · ${f1(n.durSec, 2)} s · vel ${n.velocity}<br>${H.trackBadge(n.track)} · ch ${n.channel + 1}${inS ? '<br>' + inS : ''}`, x, y); },
        onAudition: (p, n) => { const tr = n ? n.track : (s.selNoteId !== null && s.byId[s.selNoteId] ? s.byId[s.selNoteId].track : s.seq.musicalTracks[0].index); s.engine.audition(tr, p, 0.8); A().excite([{ pitch: p, velocity: 100 }], 'key ' + H.nn(p)); } } });
      roll.setSeq(s.seq); roll.setRegion(s.scope.region); if (s.selNoteId !== null) roll.selectNote(s.selNoteId, true);
      el.addEventListener('click', (e) => this.click(e)); el.addEventListener('input', (e) => this.input(e));
      this.arm = new FO.ArrMap(document.createElement('canvas'), {});
      this.renderStatic();
    },
    unmount() { const s = S(); if (s.roll) { V.unregister(s.roll); if (s.roll._ro) s.roll._ro.disconnect(); s.roll = null; } if (this.arm) { V.unregister(this.arm); if (this.arm._ro) this.arm._ro.disconnect(); this.arm = null; } A().tip(null); },
    click(e) {
      const s = S(), roll = s.roll, t = e.target.closest('[data-a]'); if (!t) { const r = e.target.closest('[data-tr]'); return this.trackClick(e); }
      const a = t.dataset.a;
      if (a === 'zx-') roll.zoomX(0.7); else if (a === 'zx+') roll.zoomX(1.4); else if (a === 'fit') roll.fitAll(); else if (a === 'zy-') roll.zoomY(0.8); else if (a === 'zy+') roll.zoomY(1.25);
      else if (a === 'follow') { roll.follow = !roll.follow; t.setAttribute('aria-pressed', roll.follow); } else if (a === 'scale') { roll.showScale = !roll.showScale; t.setAttribute('aria-pressed', roll.showScale); roll.dirty = true; } else if (a === 'rel') { roll.showRelations = !roll.showRelations; t.setAttribute('aria-pressed', roll.showRelations); roll.dirty = true; }
      else this.trackClick(e);
    },
    input(e) {},
    trackClick(e) {
      const s = S(), b = e.target.closest('button[data-tr]'); if (b) {
        const i = +b.dataset.i, act = b.dataset.tr, eng = s.engine;
        if (act === 'm') eng.setTrack(i, { mute: !eng.settings[i].mute }); else if (act === 's') eng.setTrack(i, { solo: !eng.settings[i].solo }); else if (act === 'iso') eng.isolate(i);
        else if (act === 'scope') A().toggleScopeTrack(i); else if (act === 'hide') { if (s.hidden.has(i)) s.hidden.delete(i); else s.hidden.add(i); if (s.roll) { s.roll.miniCache = null; s.roll.dirty = true; } if (s.helix) s.helix.build(); }
        s.mixStamp++; this.renderTracks(); if (s.roll) s.roll.dirty = true; return;
      }
      const r = e.target.closest('button[data-reg]'); if (r) {
        const st = s.analysis && s.analysis.structure; const rg = st && st.regions[+r.dataset.i]; if (!rg) return; const act = r.dataset.reg;
        if (act === 'scope') { A().setScope({ region: { a: rg.startSec, b: rg.endSec } }); if (s.roll) s.roll.setRegion(s.scope.region); }
        else if (act === 'A' || act === 'B') { s.compare[act] = { startSec: rg.startSec, endSec: rg.endSec, id: rg.id }; A().recompute(0); this.renderRegions(); }
        else if (act === 'play') { s.engine.seek(rg.startSec); if (!s.engine.playing) A().togglePlay(); }
        return;
      }
      if (e.target.closest('[data-cmp="clear"]')) { s.compare = { A: null, B: null }; A().recompute(0); this.renderRegions(); }
    },
    renderStatic() { this.renderTracks(); this.renderInspector(); this.renderRegions(); },
    renderTracks() {
      const s = S(), el = document.getElementById('trackList'); if (!el) return; const a = s.analysis, eng = s.engine;
      el.innerHTML = H.panel('Tracks', '02', `<div class="tracklist">${s.seq.musicalTracks.map(t => {
        const st = eng.settings[t.index], role = a && a.roles ? a.roles.find(r => r.index === t.index) : null, inS = s.scope.tracks ? s.scope.tracks.includes(t.index) : false, prog = t.programs[0];
        return `<div class="trow"><span class="sw" style="background:${V.trackColor(t.index)};opacity:${s.hidden.has(t.index) ? .25 : 1}"></span><div><div class="nm">${esc(A().trackName(t.index))}</div><small>ch ${t.channels.map(c => c + 1).join(',')} · ${t.noteCount} notes · ${H.nn(t.notes.reduce((m, n) => Math.min(m, n.pitch), 127))}–${H.nn(t.notes.reduce((m, n) => Math.max(m, n.pitch), 0))}</small></div><div><small>${role ? esc(role.role) + (role.role !== 'ambiguous' ? ' (hyp.)' : '') : '…'}</small><small>${prog ? esc(FO.midi.gmProgramName(prog.program)) : t.isPercussion ? 'percussion' : 'no program'}</small></div><div class="mini"><button class="m" data-tr="m" data-i="${t.index}" aria-pressed="${st.mute}" title="Mute">M</button><button data-tr="s" data-i="${t.index}" aria-pressed="${st.solo}" title="Solo">S</button><button data-tr="iso" data-i="${t.index}" title="Isolate: solo this track only">ISO</button><button data-tr="scope" data-i="${t.index}" aria-pressed="${inS}" title="Analyse only this track">AN</button><button data-tr="hide" data-i="${t.index}" aria-pressed="${s.hidden.has(t.index)}" title="Hide from the roll">${s.hidden.has(t.index) ? '◌' : '●'}</button></div></div>`; }).join('')}</div><p class="note"><b>M</b> mute · <b>S</b> solo · <b>ISO</b> isolate for listening · <b>AN</b> analyse only this track · <b>●</b> show/hide on the roll. A role is a hypothesis; a General MIDI program name is not proof of the sound used in a DAW.</p>`);
    },
    renderInspector() {
      const s = S(), el = document.getElementById('inspector'); if (!el) return; const a = s.analysis, n = s.selNoteId !== null ? s.byId[s.selNoteId] : null;
      if (!n) { el.innerHTML = H.panel('Inspector', '01', `<p class="empty" style="border:0;padding:12px 0;text-align:left">Select a note to see its pitch, timing, relationships, chord and scale role.</p><p class="note"><span class="kbd">←</span> <span class="kbd">→</span> next/previous note · <span class="kbd">↑</span> <span class="kbd">↓</span> notes sounding together · <span class="kbd">Enter</span> audition · <span class="kbd">Esc</span> clear · piano keys on the left play the selected track's instrument.</p>`); return; }
      const sel = a && a.selected, pc = n.pitch % 12, flats = sel ? sel.flats : false, ns = s.seq.notes;
      const sim = []; for (let i = 0; i < ns.length; i++) { const o = ns[i]; if (o.startSec >= n.endSec) break; if (o.id === n.id || o.endSec <= n.startSec || o.channel === 9) continue; sim.push(o); }
      const trackNotes = ns.filter(o => o.track === n.track && o.channel === n.channel); const idx = trackNotes.findIndex(o => o.id === n.id); const prev = idx > 0 ? trackNotes[idx - 1] : null, next = idx < trackNotes.length - 1 ? trackNotes[idx + 1] : null;
      let chordTxt = '–'; if (a && a.chords && a.chords.noteMap) { const segIdx = (a.chords.noteMap.get(n.id) || []).slice(0, 3); chordTxt = segIdx.map(i => { const sg = a.chords.segments[i]; if (!sg) return ''; let role = ''; if (sg.kind === 'chord') { const tn = sg.tones.find(t => t.pc === pc); const ct = sg.nct.find(x => x.noteId === n.id); role = tn ? tn.role : ct ? ct.type : 'non-chord tone'; } return `<b>${esc(sg.label)}</b>${role ? ' (' + esc(role) + ')' : ''}`; }).filter(Boolean).join(', ') || 'not part of a labelled chord'; }
      let motif = ''; if (a && a.motifs) { const m = a.motifs.list.find(m => m.occurrences.some(o => o.noteIds.includes(n.id))); if (m) motif = `part of repeated motif #${m.id + 1} (${m.notes} notes, ×${m.count}${m.transposed ? ', transposed' : ''})`; }
      const flags = []; if (n.durBeat >= 4) flags.push('long-held'); if (n.durSec < 0.06) flags.push('very short'); if (n.unclosed) flags.push('no note-off in file'); if (n.soundEndTick > n.endTick) flags.push('sustained by pedal to ' + f1(n.soundEndSec, 2) + ' s');
      const iv = (o) => o ? `${T.intervalName(o.pitch - n.pitch)} ${o.pitch > n.pitch ? '↑' : o.pitch < n.pitch ? '↓' : '='} (${o.pitch - n.pitch >= 0 ? '+' : ''}${o.pitch - n.pitch} st) → ${H.nn(o.pitch)}${T.octave(o.pitch)}` : '–';
      el.innerHTML = H.panel('Inspector', '01', `<p class="h-serif">${n.channel === 9 ? esc(FO.midi.gmDrumName(n.pitch)) : H.nn(n.pitch) + T.octave(n.pitch)} <small>MIDI ${n.pitch}</small></p>
<dl class="kv"><dt>Start</dt><dd>${f1(n.startSec, 3)} s · ${H.posLong(n.startTick)}</dd><dt>Duration</dt><dd>${f1(n.durSec, 3)} s · ${f1(n.durBeat, 2)} beats · ${n.durTick} ticks</dd><dt>Velocity</dt><dd>${n.velocity}${n.offVelocity ? ' (release ' + n.offVelocity + ')' : ''}</dd><dt>Track</dt><dd>${H.trackBadge(n.track)} · channel ${n.channel + 1}</dd>
${n.channel === 9 ? '' : `<dt>Frequency</dt><dd>${f1(T.freq(n.pitch), 2)} Hz <span class="dim">(theoretical 12-TET, A4 = 440)</span></dd>`}
${sel && n.channel !== 9 ? `<dt>Scale</dt><dd>${esc(sel.name)}: degree <b>${T.degreeLabel(pc - sel.root)}</b> — <span class="${sel.inSet.has(pc) ? 'in' : 'out'}">${sel.inSet.has(pc) ? 'inside' : 'outside (may be intentional chromaticism)'}</span></dd>` : ''}
<dt>Chord</dt><dd>${chordTxt}</dd><dt>Previous</dt><dd>${prev ? iv(prev) : '–'}</dd><dt>Next</dt><dd>${next ? iv(next) : '–'}</dd>
<dt>Sounding with</dt><dd>${sim.length ? sim.slice(0, 8).map(o => `${H.nn(o.pitch)}${T.octave(o.pitch)} <span class="dim">${T.intervalName(o.pitch - n.pitch)}</span>`).join(' · ') + (sim.length > 8 ? ` · +${sim.length - 8}` : '') : 'nothing else'}</dd>${motif ? `<dt>Motif</dt><dd>${motif}</dd>` : ''}${flags.length ? `<dt>Flags</dt><dd>${flags.join(', ')}</dd>` : ''}</dl>
<p style="margin-top:12px"><button class="btn sm" id="insAud">Audition</button> <button class="btn sm ghost" id="insSeek">Play from here</button> <button class="btn sm ghost" id="insNotes">Find in Notes</button></p>`);
      document.getElementById('insAud').onclick = () => A().auditionNote(n);
      document.getElementById('insSeek').onclick = () => { s.engine.seek(n.startSec); if (!s.engine.playing) A().togglePlay(); };
      document.getElementById('insNotes').onclick = () => { s.notesFocus = n.id; A().go('notes'); };
    },
    renderRegions() {
      const s = S(), el = document.getElementById('regionTools'), pn = document.getElementById('armapPanel'); if (!el) return; const a = s.analysis, st = a && a.structure;
      if (!st || !st.regions.length) { el.innerHTML = H.panel('Regions', '03', H.wait(a ? 'No regions in this scope.' : 'Analysing…')); pn.innerHTML = ''; return; }
      const cmp = a.compare;
      el.innerHTML = H.panel('Estimated regions', '03', `<p class="note" style="margin-top:0">Boundaries come from changes in density, register, track activity and pitch-class content. They are estimates, not verified section labels.</p><div class="tracklist">${st.regions.map((rg, i) => `<div class="trow" style="grid-template-columns:24px 1fr auto"><b class="mono" style="color:var(--amber)">${String.fromCharCode(65 + i % 26)}</b><div><div class="nm">bars ${rg.startMeasure}–${rg.endMeasure} · ${rg.character}</div><small>${FO.fmtTime(rg.startSec)}–${FO.fmtTime(rg.endSec)} · ${rg.noteCount} notes · ${rg.activeTracks} tracks · mean ${H.nn(Math.round(rg.meanPitch || 60))}</small></div><div class="mini"><button data-reg="play" data-i="${i}" title="Play from here">▶</button><button data-reg="scope" data-i="${i}" title="Analyse only this region">AN</button><button data-reg="A" data-i="${i}" aria-pressed="${s.compare.A && s.compare.A.id === rg.id}">A</button><button data-reg="B" data-i="${i}" aria-pressed="${s.compare.B && s.compare.B.id === rg.id}">B</button></div></div>`).join('')}</div>` +
        (cmp && !cmp.a.empty && !cmp.b.empty ? `<h3 class="ph" style="margin-top:14px"><span class="mono" style="color:var(--gold);font-size:11px;letter-spacing:.18em">COMPARE A ↔ B</span> <button class="btn sm ghost" data-cmp="clear" style="margin-left:auto">clear</button></h3><table><thead><tr><th></th><th>A</th><th>B</th></tr></thead><tbody>${cmp.rows.map(r => `<tr><td>${r.label}</td><td>${r.a}</td><td>${r.b}</td></tr>`).join('')}</tbody></table><p class="note">${esc(cmp.verdict)}</p>` : '<p class="note">Mark two regions as <b>A</b> and <b>B</b> to compare their measured characteristics.</p>'));
      pn.innerHTML = H.panel('Arrangement map — activity, boundaries, repeats', '04', `<canvas id="armap" class="viz" style="height:${Math.max(300, 150 + s.seq.musicalTracks.length * 26)}px" aria-label="Arrangement activity map" role="img"></canvas>`);
      if (this.arm && this.arm.canvas.isConnected === false) { V.unregister(this.arm); }
      const cv = document.getElementById('armap'); if (this.arm) { V.unregister(this.arm); if (this.arm._ro) this.arm._ro.disconnect(); }
      this.arm = new FO.ArrMap(cv, { onSeek: (t) => A().seek(t), onRegion: (rg) => { A().setScope({ region: { a: rg.startSec, b: rg.endSec } }); if (s.roll) s.roll.setRegion(s.scope.region); }, onHover: (h, x, y) => A().tip(h ? esc(h.label) : null, x, y) });
      this.arm.setData(s.seq, st, s.info.tracks);
    },
    update(why) {
      const s = S(); if (why === 'selection') { this.renderInspector(); return; } if (why === 'active') return;
      if (why === 'scope') { if (s.roll) s.roll.setRegion(s.scope.region); }
      if (s.roll && s.analysis) s.roll.dirty = true; this.renderTracks(); this.renderInspector(); if (why === 'analysis' || why === 'mount') this.renderRegions();
    }
  };

  /* ============================================================ NOTES */
  const NF = { q: '', track: 'all', pc: 'all', fit: 'all', vmin: 0, vmax: 127, dmin: 0, only: 'all' };
  FO.views.notes = {
    mount(el) {
      const s = S();
      el.innerHTML = H.head('Note', 'intelligence', 'Every note, searchable and filterable. Raw measurements (time, duration, velocity, frequency) are separated from interpretation (scale degree, chord role, motif membership), which depends on the scale reading chosen in Key &amp; Scale.') +
        `<div class="toolbar" id="nfBar"><label class="field">Search <input type="search" id="nfQ" placeholder="C#4 · 60 · c# · bass …" value="${esc(NF.q)}" size="16"></label>
<label class="field">Track <select id="nfTrack"><option value="all">all</option>${s.seq.musicalTracks.map(t => `<option value="${t.index}" ${NF.track == t.index ? 'selected' : ''}>${esc(A().trackName(t.index))}</option>`).join('')}</select></label>
<label class="field">Pitch class <select id="nfPc"><option value="all">any</option>${T.SHARP.map((n, i) => `<option value="${i}" ${NF.pc == i ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
<label class="field">Scale fit <select id="nfFit"><option value="all">any</option><option value="in">inside</option><option value="out">outside</option></select></label>
<label class="field">Velocity <input type="number" id="nfVmin" min="0" max="127" value="${NF.vmin}" style="width:56px"> – <input type="number" id="nfVmax" min="0" max="127" value="${NF.vmax}" style="width:56px"></label>
<label class="field">Min length (beats) <input type="number" id="nfD" min="0" step="0.25" value="${NF.dmin}" style="width:64px"></label>
<label class="field">Show <select id="nfOnly"><option value="all">all notes</option><option value="long">long-held (≥4 beats)</option><option value="short">very short (&lt;60 ms)</option><option value="chord">in a labelled chord</option><option value="motif">in a repeated motif</option></select></label>
<span class="grow"></span><output id="nfCount" class="dim"></output></div>
<div class="grid g-side"><div class="vtable" id="ntWrap"><div class="vsp"><table><thead><tr><th>#</th><th>Note</th><th class="num">MIDI</th><th>Bar.beat</th><th class="num">Start s</th><th class="num">Beats</th><th class="num">Vel</th><th>Track · ch</th><th class="num">Hz*</th><th>Degree</th><th>Scale</th><th>From prev.</th><th>Chord role</th></tr></thead><tbody id="ntBody"></tbody></table></div></div><div id="nStats"></div></div>`;
      document.getElementById('nfFit').value = NF.fit; document.getElementById('nfOnly').value = NF.only;
      const on = () => { NF.q = el.querySelector('#nfQ').value; NF.track = el.querySelector('#nfTrack').value; NF.pc = el.querySelector('#nfPc').value; NF.fit = el.querySelector('#nfFit').value; NF.vmin = +el.querySelector('#nfVmin').value; NF.vmax = +el.querySelector('#nfVmax').value; NF.dmin = +el.querySelector('#nfD').value; NF.only = el.querySelector('#nfOnly').value; this.filter(); };
      el.querySelector('#nfBar').addEventListener('input', on);
      const wrap = el.querySelector('#ntWrap'); wrap.addEventListener('scroll', () => this.rows()); this.wrap = wrap;
      el.querySelector('#ntBody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (!tr) return; A().selectNote(+tr.dataset.id, { audition: true }); this.rows(); });
      el.querySelector('#ntBody').addEventListener('dblclick', (e) => { const tr = e.target.closest('tr[data-id]'); if (!tr) return; S().selNoteId = +tr.dataset.id; A().go('arrangement'); if (S().roll) S().roll.selectNote(+tr.dataset.id, true); });
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-nf]'); if (!b) return; if (b.dataset.nf === 'out') { NF.fit = 'out'; el.querySelector('#nfFit').value = 'out'; this.filter(); } else if (b.dataset.nf === 'loc') { s.notesFocus = +b.dataset.id; this.focus(); } });
      this.prev = null; this.filter();
    },
    unmount() { this.list = null; },
    buildPrev() { const s = S(); if (this.prevFor === s.seq) return; this.prevFor = s.seq; this.prev = new Map(); const last = new Map(); for (const n of s.seq.notes) { const k = n.track * 16 + n.channel; const p = last.get(k); if (p && p.startTick < n.startTick) this.prev.set(n.id, p); if (!p || p.startTick < n.startTick) last.set(k, n); else this.prev.set(n.id, this.prev.get(p.id) || null); } },
    filter() {
      const s = S(), a = s.analysis, sel = a && a.selected, inSet = sel ? sel.inSet : null; this.buildPrev();
      const q = NF.q.trim().toLowerCase(); let qPitch = null, qPc = null, qOut = false, qText = q;
      if (q === 'outside' || q === 'out') { qOut = true; qText = ''; } else if (/^[a-g][#b♯♭]?-?\d$/.test(q)) { qPitch = q; } else if (/^\d{1,3}$/.test(q)) { qPitch = +q; } else if (/^[a-g][#b♯♭]?$/.test(q)) { qPc = q; }
      const normName = (p) => (T.SHARP[p % 12] + T.octave(p)).toLowerCase().replace('♯', '#'), normFlat = (p) => (T.FLAT[p % 12] + T.octave(p)).toLowerCase().replace('♭', 'b'), pcNames = (p) => [T.SHARP[p % 12].toLowerCase().replace('♯', '#'), T.FLAT[p % 12].toLowerCase().replace('♭', 'b')];
      const chordMap = a && a.chords ? a.chords.noteMap : null, cov = a && a.motifs ? new Set(a.motifs.coveredNoteIds) : null;
      this.list = s.seq.notes.filter(n => {
        if (NF.track !== 'all' && n.track !== +NF.track) return false; if (NF.pc !== 'all' && n.pitch % 12 !== +NF.pc) return false; if (n.velocity < NF.vmin || n.velocity > NF.vmax) return false; if (n.durBeat < NF.dmin) return false;
        if (NF.fit !== 'all' && inSet && n.channel !== 9) { const i = inSet.has(n.pitch % 12); if (NF.fit === 'in' ? !i : i) return false; }
        if (qOut && inSet && (inSet.has(n.pitch % 12) || n.channel === 9)) return false;
        if (qPitch !== null) { if (typeof qPitch === 'number') { if (n.pitch !== qPitch) return false; } else { const k = qPitch.replace('♯', '#'); if (normName(n.pitch) !== k && normFlat(n.pitch) !== k) return false; } }
        if (qPc !== null && !pcNames(n.pitch).includes(qPc.replace('♯', '#').replace('♭', 'b'))) return false;
        if (qText && !qOut && qPitch === null && qPc === null) { const nm = (A().trackName(n.track) || '').toLowerCase(); const role = a && a.roles ? (a.roles.find(r => r.index === n.track) || {}).role || '' : ''; if (!nm.includes(qText) && !role.includes(qText)) return false; }
        if (NF.only === 'long' && n.durBeat < 4) return false; if (NF.only === 'short' && n.durSec >= 0.06) return false; if (NF.only === 'chord' && !(chordMap && chordMap.get(n.id) && chordMap.get(n.id).some(i => a.chords.segments[i].kind === 'chord'))) return false; if (NF.only === 'motif' && !(cov && cov.has(n.id))) return false;
        return true;
      });
      document.getElementById('nfCount').textContent = `${this.list.length.toLocaleString()} of ${s.seq.notes.length.toLocaleString()} notes`;
      if (this.wrap) this.wrap.scrollTop = 0; this.rows(); this.stats();
      if (s.notesFocus !== undefined && s.notesFocus !== null) this.focus();
    },
    focus() { const s = S(), id = s.notesFocus; s.notesFocus = null; if (id === null || id === undefined || !this.list) return; const i = this.list.findIndex(n => n.id === id); if (i < 0) { NF.q = ''; NF.track = 'all'; NF.pc = 'all'; NF.fit = 'all'; NF.only = 'all'; NF.vmin = 0; NF.vmax = 127; NF.dmin = 0; document.getElementById('viewbody').innerHTML = ''; s.notesFocus = id; this.mount(document.getElementById('viewbody')); return; } this.wrap.scrollTop = Math.max(0, i * 27 - 100); s.selNoteId = id; this.rows(); },
    rows() {
      const s = S(), a = s.analysis, sel = a && a.selected, list = this.list, wrap = this.wrap; if (!list || !wrap) return; const rowH = 27, first = Math.max(0, Math.floor(wrap.scrollTop / rowH) - 6), vis = Math.ceil(wrap.clientHeight / rowH) + 14, slice = list.slice(first, first + vis);
      const cm = a && a.chords ? a.chords.noteMap : null, flats = sel ? sel.flats : false;
      const html = slice.map(n => {
        const pc = n.pitch % 12, p = this.prev && this.prev.get(n.id), segI = cm && cm.get(n.id), sg = segI && a.chords.segments[segI[0]]; let role = '';
        if (sg && sg.kind === 'chord') { const tn = sg.tones.find(t => t.pc === pc); const ct = sg.nct.find(x => x.noteId === n.id); role = esc(sg.label) + ' · ' + esc(tn ? tn.role : ct ? ct.type : 'non-chord'); }
        const inS = sel && n.channel !== 9 ? sel.inSet.has(pc) : null;
        return `<tr data-id="${n.id}" class="${n.id === s.selNoteId ? 'sel' : ''}" style="height:${rowH}px"><td>${n.id}</td><td>${n.channel === 9 ? esc(FO.midi.gmDrumName(n.pitch)) : '<b>' + T.noteName(n.pitch, flats) + '</b>'}</td><td class="num">${n.pitch}</td><td>${H.posStr(n.startTick)}</td><td class="num">${f1(n.startSec, 3)}</td><td class="num">${f1(n.durBeat, 2)}</td><td class="num">${n.velocity}</td><td>${H.trackBadge(n.track)} · ${n.channel + 1}</td><td class="num">${n.channel === 9 ? '–' : f1(T.freq(n.pitch), 1)}</td><td>${sel && n.channel !== 9 ? T.degreeLabel(pc - sel.root) : '–'}</td><td class="${inS === false ? 'out' : 'in'}">${inS === null ? '–' : inS ? 'in' : 'outside'}</td><td>${p && n.channel !== 9 ? T.intervalName(n.pitch - p.pitch) + (n.pitch >= p.pitch ? ' ↑' : ' ↓') : '–'}</td><td>${role || '–'}</td></tr>`;
      }).join('');
      document.getElementById('ntBody').innerHTML = `<tr style="height:${first * rowH}px"><td colspan="13" style="border:0;padding:0"></td></tr>${html}<tr style="height:${Math.max(0, (list.length - first - slice.length) * rowH)}px"><td colspan="13" style="border:0;padding:0"></td></tr>`;
    },
    stats() {
      const s = S(), a = s.analysis, el = document.getElementById('nStats'); if (!el) return; const st = a && (a.stats || a.statsAll); if (!st || !st.count) { el.innerHTML = H.panel('Statistics', '02', H.noData(a ? 'No notes in scope.' : 'Analysing…')); return; }
      const sel = a.selected, flats = sel ? sel.flats : false, octs = []; for (let o = -1; o <= 9; o++) octs.push(st.octCount[o] || 0);
      el.innerHTML = H.panel('Statistics · scope', '02', `<p class="note" style="margin:0 0 6px"><b>Measured.</b> ${st.count.toLocaleString()} notes · lowest ${H.nn(s.byId[st.lowest].pitch)}${T.octave(s.byId[st.lowest].pitch)} · highest ${H.nn(s.byId[st.highest].pitch)}${T.octave(s.byId[st.highest].pitch)} · polyphony avg ${f1(st.polyphony.avg, 2)} (max ${st.polyphony.max})</p>
<h3 class="ph"><span class="mono" style="font-size:10px;color:var(--ash);letter-spacing:.14em">PITCH CLASS (weighted share)</span></h3>${H.bars(U.normalize(st.pcMass), { labels: T.SHARP.map((n, i) => T.pcName(i, flats)), colors: T.SHARP.map((_, i) => (sel ? (sel.inSet.has(i) ? '#d4a64a' : '#b4412f') : '#d4a64a')), fmt: v => pct(v, 1), h: 100 })}
<h3 class="ph" style="margin-top:12px"><span class="mono" style="font-size:10px;color:var(--ash);letter-spacing:.14em">REGISTER (notes per octave)</span></h3>${H.bars(octs, { labels: octs.map((_, i) => 'C' + (i - 1)), every: 1, h: 90, color: '#a9823a' })}
<h3 class="ph" style="margin-top:12px"><span class="mono" style="font-size:10px;color:var(--ash);letter-spacing:.14em">VELOCITY (mean ${f1(st.velocity.mean, 0)}, σ ${f1(st.velocity.std, 1)})</span></h3>${H.bars(st.velocity.hist, { labels: ['0', '16', '32', '48', '64', '80', '96', '112'], h: 84, color: '#6fa095' })}
<h3 class="ph" style="margin-top:12px"><span class="mono" style="font-size:10px;color:var(--ash);letter-spacing:.14em">NOTE LENGTH (beats) · median ${f1(st.duration.medianBeat, 2)}</span></h3>${H.bars(st.duration.hist, { labels: st.duration.labels, h: 84, color: '#9a8fb3' })}
<h3 class="ph" style="margin-top:12px"><span class="mono" style="font-size:10px;color:var(--ash);letter-spacing:.14em">DENSITY OVER TIME (onsets / ${st.density.binSec}s)</span></h3>${H.spark(st.density.onsets, { h: 44 })}
<dl class="kv" style="margin-top:12px"><dt>Most used</dt><dd>${st.topPitches.slice(0, 6).map(p => `${H.nn(p.pitch)}${T.octave(p.pitch)}×${p.count}`).join(' · ')}</dd><dt>Long-held</dt><dd>${st.longHeld.length ? st.longHeld.length + ' notes ≥ 4 beats (longest ' + f1(s.byId[st.longHeld[0]].durBeat, 1) + ')' : 'none'}</dd><dt>Very short</dt><dd>${st.veryShort.count} events under 60 ms</dd><dt>Repeats</dt><dd>${st.repeatRuns} runs of ≥3 repeated pitches${st.longestRepeat.len ? ' (longest ' + st.longestRepeat.len + '× ' + H.nn(st.longestRepeat.pitch) + ')' : ''}</dd>${a.line ? `<dt>Unusual intervals</dt><dd>${a.line.analysis.unusual.length} rare leaps in ${esc(A().trackName(a.line.track))}</dd>` : ''}${sel ? `<dt>Outside ${esc(sel.rootName)}</dt><dd>${sel.outsideNoteCount} notes <button class="btn sm ghost" data-nf="out">show</button></dd>` : ''}</dl><p class="note">*Hz is the theoretical 12-tone equal-tempered frequency of the pitch (A4 = 440 Hz) — a label, not a measurement of any sound.</p>`);
    },
    update(why) { if (why === 'active' || why === 'selection') { this.rows(); return; } if (this.list !== undefined && document.getElementById('ntBody')) { if (why === 'analysis' || why === 'scope') this.filter(); } }
  };
})();
