/* Frequency Oasis — MIDI DNA
 * views2.js : Key & Scale, Chords, Rhythm views. */
(function () {
  'use strict';
  const FO = globalThis.FO, V = FO.viz, T = FO.theory, U = FO.util, H = FO.H;
  const { esc, pct, f1 } = H;
  const A = () => FO.app, S = () => FO.state;
  const killViz = (...vs) => vs.forEach(v => { if (v) { V.unregister(v); if (v._ro) v._ro.disconnect(); } });

  /* ============================================================ KEY & SCALE */
  FO.views.key = {
    mount(el) {
      el.innerHTML = H.head('Key &amp;', 'scale', 'Ranked readings with the evidence behind them. Modes share their notes with major and minor keys, so a confident-looking top result is not always the only sensible answer — compare the alternatives and choose a reading to re-analyse everything else against it.') +
        `<div class="grid g-wide"><section class="panel flush"><canvas id="roseCv" class="viz" style="height:min(52vh,440px);border:0" aria-label="Pitch rose: how much each pitch class is used, tinted by whether it is inside the selected scale" role="img"></canvas></section><div id="keyMain"></div></div><div class="grid g2" style="margin-top:var(--gut)" id="keyLow"></div>`;
      this.rose = new FO.Rose(el.querySelector('#roseCv'), { onPc: (pc) => { const s = S(); A().excite([{ pitch: 60 + pc, velocity: 90 }], T.SHARP[pc]); const tr = s.seq.musicalTracks.find(t => !t.isPercussion); if (tr) s.engine.audition(tr.index, 60 + pc, 0.7); } });
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-read]'); if (!b) return; const s = S();
        if (b.dataset.read === 'best') s.readKey = null; else { const [r, id] = b.dataset.read.split(':'); s.readKey = { root: +r, scaleId: id }; }
        A().recompute(0); this.update('analysis');
      });
    },
    unmount() { killViz(this.rose); this.rose = null; },
    update() {
      const s = S(), a = s.analysis, main = document.getElementById('keyMain'), low = document.getElementById('keyLow'); if (!main) return;
      if (!a) { main.innerHTML = H.panel('Reading', '01', H.wait()); low.innerHTML = ''; return; }
      const k = a.key, sel = a.selected;
      if (!k || !k.best || !sel) { main.innerHTML = H.panel('Reading', '01', H.noData(k && k.verdictText ? k.verdictText : 'Not enough pitched notes in this scope to read a key.')); low.innerHTML = ''; return; }
      const flats = sel.flats, best = k.best;
      const verdictCls = { tonal: 'hi', modal: 'mid', 'centre-only': 'mid', ambiguous: 'lo', chromatic: 'lo', insufficient: 'lo' }[k.verdict] || 'mid';
      main.innerHTML = H.panel('Current reading', '01', `<p class="h-serif">${esc(sel.name)} ${a.selectedIsBest ? '' : '<small>your choice</small>'}</p>
<p><span class="badge ${verdictCls}">${esc(k.verdict)}</span> ${esc(k.verdictText)}</p>
<dl class="kv"><dt>Tonal centre</dt><dd>${esc(best.rootName)} ${H.conf(k.centreConfidence)}</dd><dt>Scale / mode</dt><dd>${esc(best.scaleName)} ${H.conf(k.scaleConfidence)}</dd><dt>Notes of the scale</dt><dd>${sel.scaleNotes.map(n => esc(n)).join(' · ')}</dd><dt>Notes outside</dt><dd>${sel.outsideNoteCount} of ${k.noteCount}${sel.outsideList && sel.outsideList.length ? ' (' + sel.outsideList.slice(0, 6).map(o => esc(o.name || o)).join(', ') + ')' : ''}</dd><dt>Rank</dt><dd>${sel.rank !== null && sel.rank !== undefined ? '#' + sel.rank : '–'} of ${k.allCandidates.length}</dd></dl>
${a.selectedIsBest ? '' : '<p><button class="btn sm" data-read="best">Return to the best reading</button></p>'}
<h3 class="ph" style="margin-top:12px"><span class="mono" style="font-size:10px;color:var(--ash);letter-spacing:.14em">EVIDENCE</span></h3><ul class="list tight">${(sel.evidence || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`);
      const cands = k.candidates.slice(0, 12), top = cands[0] ? cands[0].score : 1;
      const candTable = `<table><thead><tr><th>#</th><th>Reading</th><th class="num">Score</th><th class="num">Corr.</th><th class="num">In-scale</th><th></th></tr></thead><tbody>${cands.map((c, i) => `<tr class="${c.root === sel.root && c.scaleId === sel.scaleId ? 'sel' : ''}"><td>${i + 1}</td><td><b>${esc(c.rootName)}</b> ${esc(c.scaleName.split(' (')[0])}</td><td class="num">${f1(c.score, 3)}</td><td class="num">${f1(c.corr, 2)}</td><td class="num">${pct(c.inMass)}</td><td><button class="btn sm ghost" data-read="${c.root}:${c.scaleId}">use</button></td></tr>`).join('')}</tbody></table><p class="note">Score = 0.8 × correlation with a generic scale profile + 0.2 × share of note weight inside the scale + small bonuses for ending, starting and chord-root evidence. Readings that share the same seven notes (relative modes) score close together — that is genuine musical ambiguity, not an error.</p>`;
      const related = sel.related && sel.related.length > 1 ? `<h3 class="ph" style="margin-top:12px"><span class="mono" style="font-size:10px;color:var(--ash);letter-spacing:.14em">SAME NOTES, DIFFERENT CENTRE</span></h3><p>${sel.related.map(r => `<button class="btn sm ${r.root === sel.root && r.scaleId === sel.scaleId ? '' : 'ghost'}" data-read="${r.root}:${r.scaleId}">${esc(r.name)} · ${f1(r.score, 2)}</button>`).join(' ')}</p>` : '';
      const flat = U.normalize(k.pcw);
      const centreEv = `<dl class="kv"><dt>First note</dt><dd>${T.pcName(k.firstPc, flats)}</dd><dt>Final bass</dt><dd>${k.finalBassPc === null || k.finalBassPc === undefined ? '–' : T.pcName(k.finalBassPc, flats)}</dd><dt>Final top note</dt><dd>${k.finalTopPc === null || k.finalTopPc === undefined ? '–' : T.pcName(k.finalTopPc, flats)}</dd><dt>Distinct pitch classes</dt><dd>${k.usedPcs} of 12 (flatness ${f1(k.flatness, 2)})</dd></dl>`;
      low.innerHTML = H.panel('Ranked readings', '02', candTable + related) +
        H.panel('Pitch-class weight', '03', H.bars(flat, { labels: T.SHARP.map((_, i) => T.pcName(i, flats)), colors: flat.map((_, i) => sel.inSet.has(i) ? '#d4a64a' : '#b4412f'), fmt: v => pct(v, 1), h: 130 }) + `<p class="note">Gold = inside the selected scale, red = outside. Weight = duration × velocity, so a long quiet note counts differently from a short loud one.</p>` + centreEv +
          `<h3 class="ph" style="margin-top:12px"><span class="mono" style="font-size:10px;color:var(--ash);letter-spacing:.14em">HOW CONFIDENCE IS COMPUTED</span></h3><ul class="list tight" style="font-size:12px"><li><b>Centre:</b> ${esc(k.formula.centre)}</li><li><b>Scale:</b> ${esc(k.formula.scale)}</li><li><b>Reading score:</b> ${esc(k.formula.score)}</li></ul><p class="note">These are transparent heuristics, not probabilities. Confidence falls when few notes exist, when two readings score almost equally, or when most pitch classes are used.</p>`);
    }
  };

  /* ============================================================ CHORDS */
  let chordSel = null;
  FO.views.chords = {
    mount(el) {
      const s = S();
      el.innerHTML = H.head('Chord', 'engine', 'Chords are inferred from the pitch classes sounding in each analysis window, then smoothed. A label is a hypothesis; dyads, clusters and unclear sonorities are left unlabelled on purpose. Click a chord to hear it and see its alternatives.') +
        `<div class="toolbar"><label class="field">Window <select id="cWin"><option value="auto">auto (one beat)</option><option value="beat">beat</option><option value="half-bar">half bar</option><option value="bar">bar</option></select></label><span class="grow"></span><output id="cSum" class="dim"></output></div>
<div class="grid g-wide"><section class="panel flush"><canvas id="anatCv" class="viz" style="height:min(56vh,480px);border:0" aria-label="Chord geometry on the circle of fifths: the sounding chord lights its tones, past chords leave trails" role="img"></canvas></section><div id="chordDetail"></div></div>
<div id="chordTimeline" style="margin-top:var(--gut)"></div><div class="grid g2" style="margin-top:var(--gut)" id="chordLow"></div>`;
      el.querySelector('#cWin').value = s.chordWindow;
      el.querySelector('#cWin').onchange = (e) => { s.chordWindow = e.target.value; A().recompute(0); };
      this.anat = new FO.Anatomy(el.querySelector('#anatCv'), { onNode: (pc) => { const tr = s.seq.musicalTracks.find(t => !t.isPercussion); if (tr) s.engine.audition(tr.index, 60 + pc, 0.6); A().excite([{ pitch: 60 + pc, velocity: 90 }], T.SHARP[pc]); } });
      el.addEventListener('click', (e) => {
        const c = e.target.closest('[data-ch]'); if (c) { chordSel = +c.dataset.ch; A().selectChord(chordSel, { audition: true }); this.detail(); this.timelineMark(); return; }
        const p = e.target.closest('[data-pg]'); if (p) { const a = s.analysis, pr = a.chords.progressions[+p.dataset.pg]; if (pr) { chordSel = pr.segIdx[0]; A().selectChord(chordSel, { seek: true }); this.detail(); this.timelineMark(); } }
        const r = e.target.closest('[data-seekc]'); if (r) { const sg = s.analysis.chords.segments[+r.dataset.seekc]; if (sg) { s.engine.seek(sg.startSec); if (!s.engine.playing) A().togglePlay(); } }
      });
    },
    unmount() { killViz(this.anat); this.anat = null; },
    update(why) {
      if (why === 'active') { this.timelineMark(); return; }
      const s = S(), a = s.analysis, tl = document.getElementById('chordTimeline'); if (!tl) return;
      if (!a) { tl.innerHTML = H.panel('Chord timeline', '02', H.wait()); return; }
      const c = a.chords; if (why === 'chord') { this.detail(); this.timelineMark(); return; }
      if (!c || !c.segments.length) { tl.innerHTML = H.panel('Chord timeline', '02', H.noData('No pitched notes in the current scope, so there is nothing to label.')); document.getElementById('chordDetail').innerHTML = ''; document.getElementById('chordLow').innerHTML = ''; return; }
      document.getElementById('cSum').textContent = `${c.chordCount} chord events · ${c.nonChordCount} unlabelled · ${c.vocabulary.length} distinct`;
      const maxT = Math.max(0.01, ...c.segments.map(x => x.tension || 0));
      tl.innerHTML = H.panel('Chord timeline', '02', `<div class="ctl" id="ctl">${c.segments.map(sg => {
        const lab = sg.kind === 'chord' ? sg.label : sg.kind === 'dyad' ? (sg.power ? 'power' : 'dyad') : sg.kind === 'silence' ? '·' : sg.kind === 'single' ? 'note' : sg.kind === 'cluster' ? 'cluster' : '?';
        return `<button class="cseg ${sg.kind}" data-ch="${sg.idx}" style="flex:0 0 ${Math.max(46, Math.round((sg.endSec - sg.startSec) * 26))}px" title="${esc(sg.kind === 'chord' ? sg.label + ' · ' + H.posLong(sg.startTick) : sg.kind + ' · ' + H.posLong(sg.startTick))}"><b>${esc(lab)}</b><small>${sg.roman ? esc(sg.roman) : ''}</small><i style="height:${Math.round(((sg.tension || 0) / maxT) * 100)}%"></i></button>`; }).join('')}</div><p class="note">Bar height at the bottom of each block = measured tension (dissonance, tritones and unresolved dominant motion). Dashed blocks are sonorities that were <b>not</b> forced into a chord name.</p>`);
      const prog = c.progressions.length ? `<ul class="list">${c.progressions.slice(0, 8).map((p, i) => `<li><button class="btn sm ghost" data-pg="${i}">▶ ${esc(p.labels.join(' → '))}</button> ×${p.count} <span class="dim mono">${esc(p.roman || '')}</span></li>`).join('')}</ul>` : '<p class="note">No chord progression repeats in this scope.</p>';
      const tr = c.transitions; const types = {}; tr.forEach(t => { types[t.type] = (types[t.type] || 0) + 1; });
      const tt = Object.entries(types).sort((x, y) => y[1] - x[1]);
      const b = c.bassStats;
      document.getElementById('chordLow').innerHTML = H.panel('Progressions', '03', prog + `<p class="note">Roman numerals are relative to <b>${esc(a.selected ? a.selected.name : 'the selected reading')}</b>. Change the reading in Key &amp; Scale and they update.</p><dl class="kv"><dt>Ends on tonic</dt><dd>${c.endsOnTonic ? 'yes' : 'no'}</dd><dt>Diatonic share</dt><dd>${pct(c.diatonicShare)}</dd><dt>Mean tension</dt><dd>${f1(c.tensionMean, 2)} · dissonance ${f1(c.dissonanceMean, 2)}</dd></dl>`) +
        H.panel('Voice-leading &amp; motion', '04', `<h3 class="ph"><span class="mono" style="font-size:10px;color:var(--ash);letter-spacing:.14em">ROOT MOTION</span></h3><p>${tt.slice(0, 8).map(([k2, v]) => `<span class="pill">${esc(k2)} ×${v}</span>`).join('') || '–'}</p>${b && b.total ? `<h3 class="ph" style="margin-top:10px"><span class="mono" style="font-size:10px;color:var(--ash);letter-spacing:.14em">BASS NOTE IN CHORD</span></h3><p class="note" style="margin-top:0">Root ${b.root} · 3rd ${b.first} · 5th ${b.second} · 7th ${b.third} · non-chord ${b.nonChord} (of ${b.total} labelled chords)</p>` : ''}${c.unresolved.length ? `<h3 class="ph" style="margin-top:10px"><span class="mono" style="font-size:10px;color:var(--ash);letter-spacing:.14em">TENSION THAT DID NOT RESOLVE</span></h3><ul class="list tight">${c.unresolved.slice(0, 5).map(u => `<li>${esc(c.segments[u.idx] ? c.segments[u.idx].label : '?')} — ${esc(u.why)}</li>`).join('')}</ul>` : ''}<p class="note">${c.caveats.map(esc).join(' ')}</p>`);
      if (chordSel === null || !c.segments[chordSel]) chordSel = (c.segments.find(x => x.kind === 'chord') || c.segments[0]).idx;
      this.detail(); this.timelineMark();
    },
    timelineMark() {
      const s = S(); const el = document.getElementById('ctl'); if (!el) return;
      el.querySelectorAll('.cseg').forEach(b => { const i = +b.dataset.ch; b.classList.toggle('on', i === s.activeChordIndex); b.classList.toggle('sel', i === chordSel); });
      const on = el.querySelector('.cseg.on'); if (on && s.engine.playing) { const r = on.getBoundingClientRect(), p = el.getBoundingClientRect(); if (r.left < p.left || r.right > p.right) el.scrollLeft += r.left - p.left - 40; }
    },
    detail() {
      const s = S(), a = s.analysis, el = document.getElementById('chordDetail'); if (!el || !a || !a.chords) return; const sg = a.chords.segments[chordSel]; if (!sg) { el.innerHTML = ''; return; }
      const posTxt = `${H.posLong(sg.startTick)} · ${FO.fmtTime(sg.startSec)}`;
      if (sg.kind !== 'chord') {
        const why = { dyad: sg.power ? 'Two pitch classes a fifth apart: a power-chord-style interval. No third, so major/minor is undefined.' : 'Only two pitch classes sound here. A dyad is an interval; naming a chord from it would be a guess.', single: 'A single pitch class: a melody note or unison.', silence: 'Nothing sounds in this window.', cluster: 'Several close, dissonant pitch classes that fit no chord template well. Left unlabelled instead of forcing a name.' }[sg.kind] || 'Evidence is not strong enough to name a chord.';
        el.innerHTML = H.panel(sg.kind[0].toUpperCase() + sg.kind.slice(1), '01', `<p class="h-serif">${sg.pcs ? sg.pcs.map(p => T.pcName(p, sg.flats)).join(' · ') : '–'}</p><p>${esc(why)}</p><p class="note">${posTxt}</p><p><button class="btn sm ghost" data-seekc="${sg.idx}">Play from here</button></p>`);
        return;
      }
      el.innerHTML = H.panel(esc(sg.label), '01', `<p class="h-serif">${esc(sg.label)} <small>${esc(sg.chordName)} · ${esc(sg.inversionText)}${sg.roman ? ' · ' + esc(sg.roman) : ''}</small></p>
<p>${H.conf(sg.confidence)} ${sg.diatonic === false ? '<span class="badge lo">outside the key</span>' : ''}</p><p class="note">${esc(sg.support)}</p>
<dl class="kv"><dt>Position</dt><dd>${posTxt}</dd><dt>Tones</dt><dd>${sg.tones.map(t => `<span class="pill ${t.present ? '' : 'dim'}" title="${t.present ? 'sounding' : 'missing from the window'}">${esc(t.name)} <small>${esc(t.role)}</small>${t.present ? '' : ' ✗'}</span>`).join('')}</dd><dt>Bass</dt><dd>${sg.bassPitch !== undefined && sg.bassPitch < 200 ? H.nn(sg.bassPitch) + T.octave(sg.bassPitch) : '–'}</dd><dt>Texture</dt><dd>${esc(sg.texture || '–')}</dd><dt>Tension</dt><dd>${f1(sg.tension, 2)} · dissonance ${f1(sg.dissonance, 2)}</dd>${sg.nct && sg.nct.length ? `<dt>Non-chord tones</dt><dd>${sg.nct.slice(0, 6).map(x => esc(H.nn(S().byId[x.noteId] ? S().byId[x.noteId].pitch : 0) + ' ' + x.type)).join(', ')}</dd>` : ''}</dl>
${sg.alts && sg.alts.length ? `<h3 class="ph" style="margin-top:10px"><span class="mono" style="font-size:10px;color:var(--ash);letter-spacing:.14em">ALTERNATIVE READINGS</span></h3><ul class="list tight">${sg.alts.map(x => `<li><b>${esc(x.label || x.name || '?')}</b> <span class="dim mono">score ${f1(x.score, 2)}${x.note ? ' · ' + esc(x.note) : ''}</span></li>`).join('')}</ul>` : ''}
<p style="margin-top:10px"><button class="btn sm" data-ch="${sg.idx}">Hear it</button> <button class="btn sm ghost" data-seekc="${sg.idx}">Play from here</button></p>`);
    }
  };

  /* ============================================================ RHYTHM */
  FO.views.rhythm = {
    mount(el) {
      el.innerHTML = H.head('Rhythm &amp;', 'groove', 'Timing is measured against the tempo map and time signature stored in the file. If those are default or wrong, bar-relative results are too — so you can also try an inferred pulse and compare.') + `<div id="rhBody">${H.wait()}</div>`;
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-grid]'); if (!b) return; const s = S();
        s.rhythmGrid = b.dataset.grid === 'declared' ? null : { bpm: +b.dataset.grid }; A().recompute(0); this.update('analysis');
      });
      el.addEventListener('change', (e) => { if (e.target.id === 'rhBpm') { const v = +e.target.value; if (v >= 20 && v <= 400) { S().rhythmGrid = { bpm: v }; A().recompute(0); } } });
    },
    unmount() {},
    update() {
      const s = S(), a = s.analysis, el = document.getElementById('rhBody'); if (!el) return;
      if (!a) { el.innerHTML = H.wait(); return; }
      const r = a.rhythm; if (!r || !r.grid) { el.innerHTML = H.panel('Rhythm', '01', H.noData('There are not enough notes in this scope to measure rhythm.')); return; }
      const g = r.grid, spb = g.stepsPerBeat, spm = g.stepsPerMeasure;
      const stepLab = Array.from({ length: spm }, (_, i) => (i % spb === 0 ? String(i / spb + 1) : i % spb === 2 && spb === 4 ? '&' : ''));
      const dev = r.deviation, d = dev.hist, edges = dev.edges;
      const tc = r.tempo.inferred, dec = r.tempo.declared;
      const gridCtl = `<div class="toolbar"><span class="dim">Grid:</span> <button class="btn sm ${g.kind === 'declared' ? '' : 'ghost'}" data-grid="declared">file's tempo map</button>${tc.slice(0, 4).map(t => `<button class="btn sm ${g.kind === 'inferred' && Math.abs(g.bpm - t.bpm) < 0.5 ? '' : 'ghost'}" data-grid="${t.bpm.toFixed(2)}">${f1(t.bpm, 0)} BPM</button>`).join('')}<label class="field">custom <input id="rhBpm" type="number" min="20" max="400" step="0.5" style="width:70px" placeholder="BPM"></label></div>`;
      const lanes = r.drumLanes && r.drumLanes.length ? H.panel('Drum lanes', '06', `<div class="xgrid" style="grid-template-columns:140px repeat(${spm},1fr)">${r.drumLanes.map(l => { const mx = Math.max(1, ...l.steps); return `<span class="lab">${esc(l.name)}</span>${l.steps.map(v => `<i title="${v}" style="opacity:${v ? 0.2 + 0.8 * v / mx : 0.06};background:${v ? 'var(--gold)' : 'var(--ash)'}"></i>`).join('')}`; }).join('')}</div><p class="note">How often each percussion sound lands on each 16th step of the bar, over the whole scope.</p>`) : '';
      const patt = r.trackPatterns && r.trackPatterns.length ? H.panel('Repeating patterns by track', '07', `<table><thead><tr><th>Track</th><th class="num">Bars</th><th class="num">Unique bar patterns</th><th class="num">Repeated share</th></tr></thead><tbody>${r.trackPatterns.map(t => `<tr><td>${H.trackBadge(t.track)}</td><td class="num">${t.bars}</td><td class="num">${t.uniquePatterns}</td><td class="num">${pct(t.repeatedShare)}</td></tr>`).join('')}</tbody></table><p class="note">A bar's pattern = which grid steps carry an onset. Many bars sharing a pattern means a loop; many unique patterns means variation or improvisation.</p>`) : '';
      const motifs = r.ioiMotifs && r.ioiMotifs.length ? H.panel('Recurring rhythmic cells', '08', `<ul class="list tight">${r.ioiMotifs.slice(0, 6).map(m => `<li>${H.trackBadge(m.track)}: ${m.sixteenths.map(x => `<span class="pill">${x}</span>`).join('')}<span class="dim mono"> 16ths between onsets · ×${m.count}</span></li>`).join('')}</ul>`) : '';
      el.innerHTML = H.panel('Grid', '01', gridCtl + `<p class="note" style="margin:0">${esc(g.note)}${g.kind === 'inferred' ? ' Results below assume ' + g.beatsPerMeasure + ' beats per bar.' : ''}</p>`) +
        `<div class="grid g3" style="margin-top:var(--gut)">` +
        H.panel('Feel', '02', `<p class="h-serif">${esc(r.swing.verdict)}</p><p class="note">${esc(r.swing.note)}</p><dl class="kv"><dt>Off-beat 8ths</dt><dd>${r.swing.n} measured${r.swing.ratio ? ' · ratio ≈ ' + f1(r.swing.ratio, 2) + ':1' : ''}</dd><dt>Off-beat share</dt><dd>${pct(r.syncopation.offbeatShare)}</dd><dt>Syncopated onsets</dt><dd>${pct(r.syncopation.syncopatedShare)} (${r.syncopation.syncopatedCount})</dd></dl><p class="note">${esc(r.syncopation.note)}</p>`) +
        H.panel('Timing precision', '03', `<p class="note" style="margin-top:0">${esc(dev.verdict)}</p><dl class="kv"><dt>Mean |deviation|</dt><dd>${f1(dev.meanAbsMs, 1)} ms</dd><dt>Mean signed</dt><dd>${f1(dev.meanSignedMs, 1)} ms ${dev.meanSignedMs < -3 ? '(ahead of the grid)' : dev.meanSignedMs > 3 ? '(behind the grid)' : ''}</dd><dt>Within 2 / 10 / 25 ms</dt><dd>${pct(dev.within2)} / ${pct(dev.within10)} / ${pct(dev.within25)}</dd><dt>Nearest line</dt><dd>${esc(dev.gridDescription)}</dd></dl>${H.bars(d, { h: 70, color: '#6fa095', titles: d.map((v, i) => `${edges[i]}…${edges[i + 1]} ms: ${v} onsets`) })}<p class="note" style="margin:0">Distribution of onset deviation from −${Math.abs(edges[0])} to +${edges[edges.length - 1]} ms</p>`) +
        H.panel('Tempo', '04', `<dl class="kv"><dt>Declared</dt><dd>${dec.changes ? f1(dec.minBpm, 1) + '–' + f1(dec.maxBpm, 1) + ' BPM, ' + dec.changes + ' change' + (dec.changes > 1 ? 's' : '') : f1(dec.meanBpm, 1) + ' BPM' + (dec.implicit ? ' (default — the file declares none)' : '')}</dd></dl><h3 class="ph"><span class="mono" style="font-size:10px;color:var(--ash);letter-spacing:.14em">PULSE CANDIDATES FROM ONSETS</span></h3><ul class="list tight">${tc.slice(0, 5).map(t => `<li><b>${f1(t.bpm, 1)} BPM</b> <span class="dim mono">strength ${f1(t.strength, 2)}</span> ${t.relation ? '— ' + esc(t.relation) : ''}</li>`).join('') || '<li>none</li>'}</ul>${r.tempo.caveat ? `<p class="note">${esc(r.tempo.caveat)}</p>` : ''}`) + `</div>` +
        `<div class="grid g2" style="margin-top:var(--gut)">` + H.panel(`Onsets by grid step · ${esc(g.meter || '')} bar`, '05', H.bars(U.normalize(r.onsetHist.weighted), { h: 130, labels: stepLab, colors: U.normalize(r.onsetHist.weighted).map((_, i) => i % spb === 0 ? '#d4a64a' : i % (spb / 2 || 1) === 0 ? '#a9823a' : '#6fa095'), fmt: v => pct(v, 1) }) + `<p class="note">Velocity-weighted share of onsets at each 16th of the bar. ${r.onsetHist.offGrid} onsets fell too far from any step to count. Gold = beats.</p>`) +
        H.panel('Density per bar', '05b', H.bars(r.densityPerMeasure, { h: 130, labels: r.densityPerMeasure.map((_, i) => i + 1), every: Math.ceil(r.densityPerMeasure.length / 16), color: '#9a8fb3', fmt: v => v + ' onsets' }) + `<p class="note">Onsets per bar. Pattern change between bars is highest at: ${r.patternChange.map((v, i) => ({ v, i })).sort((x, y) => y.v - x.v).slice(0, 3).filter(x => x.v > 0.25).map(x => 'bar ' + (x.i + 2)).join(', ') || 'nowhere — bar patterns are steady'}.</p>`) + `</div>` +
        `<div class="grid g2" style="margin-top:var(--gut)">${lanes}${patt}${motifs}</div><p class="note" style="margin-top:12px">${r.caveats.map(esc).join(' ')}</p>`;
    }
  };
})();
