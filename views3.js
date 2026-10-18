/* Frequency Oasis — MIDI DNA
 * views3.js : Mood, Track Intelligence, Playback views + Export and About panels. */
(function () {
  'use strict';
  const FO = globalThis.FO, V = FO.viz, T = FO.theory, U = FO.util, H = FO.H;
  const { esc, pct, f1 } = H;
  const A = () => FO.app, S = () => FO.state;
  const killViz = (...vs) => vs.forEach(v => { if (v) { V.unregister(v); if (v._ro) v._ro.disconnect(); } });
  const sub = (t) => `<h3 class="ph" style="margin-top:12px"><span class="mono" style="font-size:10px;color:var(--ash);letter-spacing:.14em">${t}</span></h3>`;

  /* ============================================================ MOOD */
  FO.views.mood = {
    mount(el) {
      el.innerHTML = H.head('Mood &amp;', 'character', 'A description of the written musical structure — not of how it will feel to any one listener, and not of the sound a DAW would make. Each axis is a blend of named measurements; open one to see what pushed it and how much the measurements agree.') +
        `<div class="grid g-wide"><section class="panel flush"><canvas id="terrCv" class="viz" style="height:min(60vh,520px);border:0" aria-label="Mood terrain: height is note activity, depth is register, colour is chord tension. Drag to rotate, double-click to reset." role="img"></canvas></section><div id="moodSum"></div></div><div id="moodDims" style="margin-top:var(--gut)"></div>`;
      this.terr = new FO.Terrain(el.querySelector('#terrCv'));
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-dim]'); if (b) { this.open = this.open === b.dataset.dim ? null : b.dataset.dim; this.dims(); } });
    },
    unmount() { killViz(this.terr); this.terr = null; },
    update(why) {
      if (why === 'active' || why === 'selection' || why === 'chord') return;
      const s = S(), a = s.analysis, el = document.getElementById('moodSum'); if (!el) return;
      if (!a) { el.innerHTML = H.panel('Summary', '01', H.wait()); return; }
      if (this.terr) this.terr.setData(s.seq, H.scopedNotes(), a);
      const m = a.mood; if (!m) { el.innerHTML = H.panel('Summary', '01', H.noData('Not enough pitched notes in this scope to describe a character.')); document.getElementById('moodDims').innerHTML = ''; return; }
      el.innerHTML = H.panel('Summary (hypothesis)', '01', `<p class="h-serif" style="font-size:20px">${esc(m.summary)}</p><p class="note">${esc(m.caveat)}</p><p class="note"><b>Reading the terrain.</b> Left to right is time. Height is how much is sounding, depth is register (low notes at the front), and colour is chord tension — cool is settled, warm is tense. Drag to rotate; the bright line is the playhead.</p>`);
      this.dims();
    },
    dims() {
      const s = S(), a = s.analysis, el = document.getElementById('moodDims'); if (!el || !a || !a.mood) return; const m = a.mood;
      el.innerHTML = H.panel('Nine axes', '02', m.dims.map(d => {
        const open = this.open === d.id;
        const lean = Math.abs(d.signed) < 0.12 ? 'balanced' : d.signed > 0 ? d.right.toLowerCase() : d.left.toLowerCase();
        return `<div class="dimrow"><button class="dimhead" data-dim="${d.id}" aria-expanded="${open}"><span class="ends"><span>${esc(d.left)}</span><b>${esc(lean)}</b><span>${esc(d.right)}</span></span><span class="gauge"><i style="left:${(d.value * 100).toFixed(1)}%"></i></span><span class="conf">${H.conf(d.confidence)}</span></button>${open ? `<div class="dimdetail"><p>${esc(d.text)}</p>${d.alternative ? `<p class="note"><b>Alternative reading.</b> ${esc(d.alternative)}</p>` : ''}<table><thead><tr><th>Measurement</th><th>Detail</th><th class="num">Push</th><th class="num">Weight</th></tr></thead><tbody>${d.components.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.detail)}</td><td class="num ${c.signed >= 0 ? 'in' : 'out'}">${c.signed >= 0 ? '→ ' + esc(d.right.toLowerCase()) : '← ' + esc(d.left.toLowerCase())} ${f1(Math.abs(c.signed), 2)}</td><td class="num">${c.weight}</td></tr>`).join('')}</tbody></table><p class="note">Confidence = (amount of evidence) × (agreement between measurements) = ${f1(d.evidence, 2)} × ${f1(d.agreement, 2)}.</p></div>` : ''}</div>`;
      }).join('') + '<p class="note">Click an axis for its evidence. Axes with low agreement are shown as such: a piece can be bright in key and dark in register at the same time.</p>');
    }
  };

  /* ============================================================ TRACK INTELLIGENCE */
  FO.views.tracks = {
    mount(el) {
      el.innerHTML = H.head('Track', 'intelligence', 'What each track appears to do, how its melodic line moves, and how two lines relate. Roles are hypotheses from measured behaviour (register, overlap, rhythm regularity) — never from the instrument name alone.') + `<div id="trRoles"></div><div id="trLine" style="margin-top:var(--gut)"></div><div id="trPair" style="margin-top:var(--gut)"></div><div id="trMotif" style="margin-top:var(--gut)"></div>`;
      el.addEventListener('change', (e) => {
        const s = S(), id = e.target.id;
        if (id === 'lnTrack') { s.lineTrack = +e.target.value; A().recompute(0); } else if (id === 'lnMode') { s.lineMode = e.target.value; A().recompute(0); }
        else if (id === 'prUp' || id === 'prLo') { const u = +document.getElementById('prUp').value, l = +document.getElementById('prLo').value; s.pair = { upper: u, lower: l }; A().recompute(0); }
      });
      el.addEventListener('click', (e) => {
        const n = e.target.closest('[data-note]'); if (n) { A().selectNote(+n.dataset.note, { center: true, seek: true }); A().go('arrangement'); return; }
        const m = e.target.closest('[data-motif]'); if (m) { const a = S().analysis, mo = a.motifs.list[+m.dataset.motif]; if (mo) { const oc = mo.occurrences[+m.dataset.occ || 0]; const nn = S().byId[oc.noteIds[0]]; if (nn) { S().engine.seek(nn.startSec); if (!S().engine.playing) A().togglePlay(); } } }
      });
    },
    unmount() {},
    update(why) {
      if (why === 'active' || why === 'selection' || why === 'chord') return;
      const s = S(), a = s.analysis; const roles = document.getElementById('trRoles'); if (!roles) return;
      if (!a) { roles.innerHTML = H.panel('Roles', '01', H.wait()); return; }
      if (!a.roles || !a.roles.length) { roles.innerHTML = H.panel('Roles', '01', H.noData('No tracks with notes in this scope.')); ['trLine', 'trPair', 'trMotif'].forEach(i => { document.getElementById(i).innerHTML = ''; }); return; }
      roles.innerHTML = H.panel('Track roles (hypotheses)', '01', `<div class="xscroll"><table><thead><tr><th>Track</th><th>Program</th><th class="num">Notes</th><th>Range</th><th class="num">Poly</th><th class="num">Vel μ</th><th>Role</th><th>Why</th></tr></thead><tbody>${a.roles.map(r => `<tr><td>${H.trackBadge(r.index)}</td><td>${r.percussion ? 'percussion' : r.programs[0] ? esc(r.programs[0].name) : '<span class="dim">none</span>'}</td><td class="num">${r.n}</td><td>${r.percussion ? '–' : H.nn(r.stats.lowest) + T.octave(r.stats.lowest) + '–' + H.nn(r.stats.highest) + T.octave(r.stats.highest)}</td><td class="num">${f1(r.avgPoly, 1)}</td><td class="num">${f1(r.vel.mean, 0)}</td><td><b>${esc(r.role)}</b> ${r.role !== 'ambiguous' ? H.conf(r.roleConfidence) : ''}${r.roleAlternatives && r.roleAlternatives.length ? `<br><span class="dim mono" style="font-size:10px">or ${r.roleAlternatives.map(x => esc(x.role)).join(', ')}</span>` : ''}</td><td style="max-width:360px;font-size:12px">${esc(r.roleWhy)}</td></tr>`).join('')}</tbody></table></div><p class="note">A General MIDI program number names a <i>family of sounds</i>. It is not evidence of the exact patch or plugin used in the original project, and many files leave every track on program 0.</p>`);
      // line analysis
      const pitchedTracks = a.roles.filter(r => !r.percussion), ln = a.line;
      const trackOpts = (sel) => pitchedTracks.map(r => `<option value="${r.index}" ${r.index === sel ? 'selected' : ''}>${esc(A().trackName(r.index))}</option>`).join('');
      if (!pitchedTracks.length) { document.getElementById('trLine').innerHTML = ''; document.getElementById('trPair').innerHTML = ''; }
      else if (!ln || !ln.analysis || !ln.analysis.count) {
        document.getElementById('trLine').innerHTML = H.panel('Melodic line &amp; intervals', '02', `<div class="toolbar"><label class="field">Track <select id="lnTrack">${trackOpts(s.lineTrack)}</select></label><label class="field">Line <select id="lnMode"><option value="top" ${s.lineMode === 'top' ? 'selected' : ''}>top voice</option><option value="bottom" ${s.lineMode === 'bottom' ? 'selected' : ''}>bottom voice</option></select></label></div>` + H.noData('This track has too few notes in scope to describe a line.'));
      } else {
        const L = ln.analysis, kinds = ['repeat', 'step', 'skip', 'leap', 'large leap'], hist = [];
        for (let i = -12; i <= 12; i++) hist.push(L.hist[i] || 0);
        document.getElementById('trLine').innerHTML = H.panel('Melodic line &amp; intervals', '02', `<div class="toolbar"><label class="field">Track <select id="lnTrack">${trackOpts(ln.track)}</select></label><label class="field">Line <select id="lnMode"><option value="top" ${ln.mode === 'top' ? 'selected' : ''}>top voice</option><option value="bottom" ${ln.mode === 'bottom' ? 'selected' : ''}>bottom voice</option></select></label></div>
<p class="note" style="margin-top:0">A single track can hold several voices at once. This extracts the <b>${ln.mode === 'top' ? 'highest' : 'lowest'}</b> sounding note at each onset, which approximates the line but can mis-assign voices in dense passages.</p>
<div class="grid g2"><div>${sub('MOTION TYPES')}${H.bars(kinds.map(k => L.kinds[k] || 0), { labels: kinds, h: 100, color: '#d4a64a' })}${sub('INTERVAL HISTOGRAM (semitones, − down · + up)')}${H.bars(hist, { labels: hist.map((_, i) => i - 12), every: 4, h: 100, colors: hist.map((_, i) => i === 12 ? '#7c7e8d' : i < 12 ? '#9a8fb3' : '#d4a64a'), titles: hist.map((v, i) => `${i - 12} st: ${v}`) })}</div>
<div><dl class="kv"><dt>Intervals</dt><dd>${L.intervals.length}</dd><dt>Direction</dt><dd>${L.up} up · ${L.down} down · mean size ${f1(L.meanAbs, 2)} st</dd><dt>Contour</dt><dd class="mono" style="word-break:break-all">${esc((L.contour || '').slice(0, 80))}</dd><dt>Chromatic runs</dt><dd>${L.chromaticRuns.length}</dd><dt>Rare leaps</dt><dd>${L.unusual.length}</dd></dl>${L.unresolved.length ? `<ul class="list tight">${L.unresolved.map(u => `<li>${esc(u.type)}</li>`).join('')}</ul>` : ''}${sub('LARGEST LEAPS (click to inspect the note)')}<ul class="list tight">${L.largest.slice(0, 6).map(x => `<li><button class="btn sm ghost" data-note="${x.to}">${esc(T.intervalName(x.abs))} ${x.dir > 0 ? '↑' : '↓'} ${x.semis > 0 ? '+' : ''}${x.semis} st</button> <span class="dim mono">at ${FO.fmtTime(x.startSec)}</span></li>`).join('')}</ul></div></div>`);
        // pair
        const pr = a.pair;
        const pOpts = (sel) => pitchedTracks.map(r => `<option value="${r.index}" ${r.index === sel ? 'selected' : ''}>${esc(A().trackName(r.index))}</option>`).join('');
        const pairHead = `<div class="toolbar"><label class="field">Upper <select id="prUp">${pOpts(pr ? pr.upper : null)}</select></label><label class="field">Lower <select id="prLo">${pOpts(pr ? pr.lower : null)}</select></label></div>`;
        if (!pr || !pr.result || !pr.result.samples) document.getElementById('trPair').innerHTML = H.panel('Voice leading between two tracks', '03', pairHead + H.noData(pitchedTracks.length < 2 ? 'Voice-leading analysis needs two pitched tracks.' : 'These two lines never sound together in the current scope.'));
        else {
          const R = pr.result, ic = R.intervalClass, mt = R.motion, mtt = Math.max(1, U.sum(Object.values(mt)));
          document.getElementById('trPair').innerHTML = H.panel('Voice leading between two tracks', '03', pairHead + `<p class="note" style="margin-top:0">Compares the upper track's top line with the lower track's bottom line at every onset of either. ${R.samples} simultaneous pairs measured.</p>
<div class="grid g2"><div>${sub('INTERVAL CLASS (between the two lines)')}${H.bars(ic, { labels: ic.map((_, i) => i), h: 100, colors: ic.map((_, i) => [0, 3, 4, 7, 8, 9].includes(i) ? '#d4a64a' : i === 5 ? '#6fa095' : '#b4412f'), titles: ic.map((v, i) => `${T.intervalName(i)}: ${v}`) })}<p class="note" style="margin:6px 0 0">gold consonant · teal perfect 4th · red dissonant — ${pct(R.consonant / R.samples)} consonant, ${pct(R.dissonant / R.samples)} dissonant, mean spacing ${f1(R.mean, 1)} st</p></div>
<div>${sub('MOTION')}${H.bars(['parallel', 'similar', 'contrary', 'oblique', 'static'].map(k => mt[k]), { labels: ['par', 'sim', 'con', 'obl', 'sta'], h: 100, color: '#9a8fb3', fmt: v => v })}<p class="note" style="margin:6px 0 0">contrary ${pct(mt.contrary / mtt)} · similar+parallel ${pct((mt.similar + mt.parallel) / mtt)} · oblique ${pct(mt.oblique / mtt)}</p></div></div>
<dl class="kv"><dt>Parallel 5ths / 8ves</dt><dd>${R.parallels.length ? R.parallels.slice(0, 6).map(p => `<button class="btn sm ghost" data-note="${p.noteIds[1]}">${esc(p.kind)} @ ${FO.fmtTime(p.sec)}</button>`).join(' ') : 'none found'}</dd><dt>Voice crossings</dt><dd>${R.crossings.length ? R.crossings.length + ' (upper line dips below lower)' : 'none'}</dd><dt>Overlaps</dt><dd>${R.overlaps.length ? R.overlaps.length : 'none'}</dd></dl><p class="note">Parallel fifths and octaves are only “errors” in some traditions; in rock, pop and organum they are idiomatic. The tool reports them without judging.</p>`);
        }
      }
      // motifs
      const mo = a.motifs;
      document.getElementById('trMotif').innerHTML = H.panel('Repeated motifs', '04', mo && mo.list.length ? `<p class="note" style="margin-top:0">Shapes of 4+ notes that recur within a track, transposition-invariant (matched by interval pattern). ${pct(mo.coverage)} of notes belong to at least one motif.</p><div class="xscroll"><table><thead><tr><th>#</th><th>Track</th><th class="num">Notes</th><th class="num">Times</th><th>Shape</th><th>Kind</th><th></th></tr></thead><tbody>${mo.list.slice(0, 14).map((m, i) => `<tr><td>${m.id + 1}</td><td>${H.trackBadge(m.track)}</td><td class="num">${m.notes}</td><td class="num">${m.count}</td><td class="mono" style="font-size:11px">${m.intervals.slice(0, 14).map(x => (x > 0 ? '+' : '') + x).join(' ')}${m.intervals.length > 14 ? ' …' : ''}</td><td>${m.transposed ? 'transposed' : m.exactPitch ? 'exact repeat' : 'varied'}</td><td><button class="btn sm ghost" data-motif="${i}" title="Play from the first occurrence">▶</button></td></tr>`).join('')}</tbody></table></div>` : H.noData('No repeated melodic shape of four or more notes was found in the current scope.'));
    }
  };

  /* ============================================================ PLAYBACK */
  FO.views.playback = {
    mount(el) {
      const s = S(), eng = s.engine;
      el.innerHTML = H.head('Play', 'back', 'Hear the file. Sound comes from a small built-in synthesiser — a MIDI file stores notes, not timbre, so what you hear is a sketch of the music, not the original instrument sounds.') +
        `<div class="grid g-wide"><section class="panel flush" style="position:relative"><canvas id="plateCv" class="viz" style="height:min(62vh,540px);border:0" aria-label="Chladni resonance plate: sounding pitches excite vibration modes and sand settles on the nodal lines" role="img"></canvas><div class="vizctl"><span class="seg" id="symSeg"><button data-sym="1" aria-pressed="false">free</button><button data-sym="2" aria-pressed="false">mirror</button><button data-sym="4" aria-pressed="true">quad</button><button data-sym="8" aria-pressed="false">kaleido</button></span></div></section>
<div><section class="panel"><div class="ph"><span class="idx">01</span><h2>Live spectrum</h2></div><canvas id="specCv" class="viz" style="height:120px" aria-label="Live spectrum of the synthesiser output" role="img"></canvas><p class="note">Measured with an FFT of the real synth output. It is silent when nothing plays.</p></section><div id="pbInfo" style="margin-top:var(--gut)"></div></div></div>
<div id="pbMixer" style="margin-top:var(--gut)"></div><div id="pbWav" style="margin-top:var(--gut)"></div>`;
      this.plate = new FO.Plate(el.querySelector('#plateCv'), { sym: 4 });
      this.spec = new FO.Spectrum(el.querySelector('#specCv'));
      el.querySelector('#symSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; this.plate.sym = +b.dataset.sym; this.plate.cleared = true; el.querySelectorAll('#symSeg button').forEach(x => x.setAttribute('aria-pressed', x === b)); });
      el.addEventListener('input', (e) => {
        const t = e.target; if (!t.dataset.tv) return; const i = +t.dataset.i, eng2 = S().engine;
        if (t.dataset.tv === 'vol') eng2.setTrack(i, { volume: +t.value / 100 }); else if (t.dataset.tv === 'pan') eng2.setTrack(i, { pan: +t.value / 100 });
      });
      el.addEventListener('change', (e) => { const t = e.target; if (t.dataset.tv === 'ins') { S().engine.setTrack(+t.dataset.i, { instrument: t.value }); const tr = S().seq.musicalTracks.find(x => x.index === +t.dataset.i); const n = tr && tr.notes.find(x => x.channel !== 9); S().engine.audition(+t.dataset.i, n ? n.pitch : 60, 0.8); } });
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-tv]'); if (b) { const i = +b.dataset.i, eng2 = S().engine; if (b.dataset.tv === 'm') eng2.setTrack(i, { mute: !eng2.settings[i].mute }); else if (b.dataset.tv === 's') eng2.setTrack(i, { solo: !eng2.settings[i].solo }); else if (b.dataset.tv === 'iso') eng2.isolate(i); S().mixStamp++; this.mixer(); return; }
        if (e.target.closest('#wavBtn')) this.renderWav(e.target.closest('#wavBtn'));
      });
      this.mixer(); this.wav(); this.info();
    },
    unmount() { killViz(this.plate, this.spec); this.plate = this.spec = null; },
    update(why) { if (why === 'analysis' || why === 'scope') this.info(); },
    info() {
      const el = document.getElementById('pbInfo'); if (!el) return; const s = S(), a = s.analysis;
      el.innerHTML = H.panel('What you are hearing', '02', `<ul class="list tight"><li><b>Synth voices</b>: 13 built-in voices (additive, FM and subtractive). Each track is mapped to the nearest voice from its General MIDI program; change it below.</li><li><b>Honest limits</b>: no sampled instruments, no DAW plugins, no reverb or effects from the original project. Pitch bend (±2 semitones), volume (CC7), expression (CC11) and sustain pedal are honoured.</li><li><b>Plate</b>: each sounding pitch excites a vibration mode of a plate, and sand drifts to the nodal lines. Low notes draw few, broad lines; high notes draw dense lattices. It is a visualisation of the notes, not of the audio.</li></ul>${a && a.scope && a.scope.region ? '<p class="note">Loop and analysis follow your selected region.</p>' : ''}`);
    },
    mixer() {
      const el = document.getElementById('pbMixer'); if (!el) return; const s = S(), eng = s.engine, A2 = FO.audio;
      el.innerHTML = H.panel('Mixer &amp; instruments', '03', `<div class="xscroll"><table><thead><tr><th>Track</th><th>Voice</th><th>Volume</th><th>Pan</th><th></th></tr></thead><tbody>${s.seq.musicalTracks.map(t => { const st = eng.settings[t.index]; const cur = st.instrument === 'auto' ? 'auto' : st.instrument; return `<tr><td>${H.trackBadge(t.index)}</td><td><select data-tv="ins" data-i="${t.index}" aria-label="Voice for ${esc(A().trackName(t.index))}"><option value="auto" ${cur === 'auto' ? 'selected' : ''}>auto → ${esc((A2.INSTR_BY_ID[st.autoInstrument] || {}).name || st.autoInstrument)}</option>${A2.INSTRUMENTS.map(i => `<option value="${i.id}" ${cur === i.id ? 'selected' : ''} title="${esc(i.note)}">${esc(i.name)}</option>`).join('')}</select></td><td><input type="range" min="0" max="100" value="${Math.round(st.volume * 100)}" data-tv="vol" data-i="${t.index}" aria-label="Volume"></td><td><input type="range" min="-100" max="100" value="${Math.round(st.pan * 100)}" data-tv="pan" data-i="${t.index}" aria-label="Pan"></td><td class="mini"><button data-tv="m" data-i="${t.index}" aria-pressed="${st.mute}">M</button><button data-tv="s" data-i="${t.index}" aria-pressed="${st.solo}">S</button><button data-tv="iso" data-i="${t.index}">ISO</button></td></tr>`; }).join('')}</tbody></table></div><p class="note">The General MIDI program on a track is only a hint. “auto” picks a voice from it; choosing a voice yourself overrides it for both playback and WAV export.</p>`);
    },
    wav() {
      const el = document.getElementById('pbWav'); if (!el) return;
      el.innerHTML = H.panel('Export audio', '04', `<p class="note" style="margin-top:0">Renders the whole file (or your looped region is ignored — the full piece) through the same synth, with your mixer settings, to a 16-bit stereo WAV. If the render comes out silent the export is refused instead of saving an empty file.</p><p><button class="btn" id="wavBtn">Render WAV</button> <span id="wavStat" class="dim" role="status"></span></p><progress id="wavProg" max="1" value="0" hidden style="width:100%"></progress>`);
    },
    async renderWav(btn) {
      const s = S(), st = document.getElementById('wavStat'), pg = document.getElementById('wavProg'); btn.disabled = true; pg.hidden = false; pg.value = 0; st.textContent = 'Rendering…';
      try {
        const r = await FO.audio.renderWav(s.engine, { sampleRate: 44100, onProgress: (p) => { pg.value = p; } });
        FO.exports.wav(r.bytes, s); st.textContent = `Saved · ${f1(r.seconds, 1)} s · ${r.notes} notes · peak ${f1(20 * Math.log10(Math.max(r.peak, 1e-6)), 1)} dBFS · ${(r.bytes.length / 1048576).toFixed(1)} MB`; A().toast('WAV rendered and saved');
      } catch (err) { st.textContent = 'Could not render: ' + (err && err.message ? err.message : err); A().toast('WAV export failed: ' + (err && err.message ? err.message : err)); }
      btn.disabled = false; pg.hidden = true;
    }
  };

  /* ============================================================ EXPORT + ABOUT */
  FO.views.exportPanel = function () {
    const s = S(), a = s.analysis, sc = a && a.scope;
    return `<p class="note" style="margin-top:0">${sc && (sc.region || sc.tracks) ? '<b>Scope applied.</b> Analysis exports use your current track/region scope. ' : 'Analysis exports cover the whole file. '}The original MIDI is always saved byte-for-byte unchanged.</p>
<div class="xgrid2">
<section><h3>MIDI</h3><button class="btn" data-ex="original">Original MIDI (unchanged)</button><div class="row"><label class="field">Transpose <input type="number" id="exSemi" value="0" min="-24" max="24" style="width:60px"> semitones</label><button class="btn ghost" data-ex="transposed">Save transposed copy</button></div><p class="note">The copy is labelled in its file name; the original is never modified. Percussion is not transposed.</p></section>
<section><h3>Data</h3><div class="btnrow"><button class="btn ghost" data-ex="notesCSV">Notes CSV</button><button class="btn ghost" data-ex="notesJSON">Notes JSON</button><button class="btn ghost" data-ex="chordsCSV">Chords CSV</button><button class="btn ghost" data-ex="chordsJSON">Chords JSON</button><button class="btn ghost" data-ex="keyJSON">Key &amp; scale JSON</button><button class="btn ghost" data-ex="tracksCSV">Tracks CSV</button><button class="btn ghost" data-ex="tracksJSON">Tracks JSON</button></div></section>
<section><h3>Report</h3><div class="btnrow"><button class="btn ghost" data-ex="reportMD">Readable report (.md)</button><button class="btn ghost" data-ex="reportJSON">Full report (.json)</button></div><p class="note">Includes measured facts, interpretations (marked as such), confidence formulas and limitations.</p></section>
<section><h3>Audio</h3><button class="btn ghost" data-ex="wav">Render WAV…</button><p class="note">Synth rendering, not the original sounds. Opens Playback so you can set the mixer first.</p></section></div><p id="exMsg" class="note" role="status"></p>`;
  };
  FO.views.bindExport = function (el) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ex]'); if (!b) return; e.preventDefault(); const k = b.dataset.ex, s = S(), msg = el.querySelector('#exMsg');
      try {
        if (k === 'wav') { document.getElementById('dlgExport').close(); A().go('playback'); A().toast('Set the mixer, then press “Render WAV”.'); return; }
        if (k === 'transposed') { const n = +el.querySelector('#exSemi').value; if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 24) throw new Error('Choose a whole number of semitones between −24 and 24 (not 0).'); FO.exports.transposed(s, n); msg.textContent = `Saved a copy transposed by ${n > 0 ? '+' : ''}${n} semitones.`; return; }
        const r = FO.exports[k](s); msg.textContent = 'Saved ' + (r && r.name ? r.name : k) + '.';
      } catch (err) { msg.textContent = 'Could not export: ' + (err && err.message ? err.message : err); }
    });
  };
  FO.views.aboutPanel = function () {
    return `<div class="about"><p><b>Frequency Oasis · MIDI DNA</b> is a local musical-intelligence instrument. Open a Standard MIDI File and it measures the notes, estimates key and chords, analyses rhythm and structure, and plays it back.</p>
<h3>Privacy</h3><p>Everything runs in your browser. Your file is never uploaded, and no analytics or external services are used. After the first visit the app works offline.</p>
<h3>What is measured, and what is estimated</h3><ul><li><b>Measured</b>: note pitch, start, length, velocity, tempo and meter events, controller data.</li><li><b>Estimated</b>: key and scale, chords, mood axes, structure regions, track roles, motifs. Each shows its evidence, alternatives and a heuristic confidence, which is <i>not</i> a probability.</li></ul>
<h3>Honest limits</h3><ul><li>MIDI carries no timbre. Playback uses a built-in synthesiser and cannot reproduce the sounds of any DAW, plugin or hardware.</li><li>Modes share notes with major/minor keys; the key view shows the ambiguity instead of hiding it.</li><li>Chord labels come from pitch classes in fixed windows; arpeggios and ornaments can disguise intent. Dyads and clusters stay unlabelled.</li><li>Voice separation inside one track is ambiguous; line analysis uses the top or bottom voice.</li><li>Mood describes written structure, not a listener's feeling.</li><li>Not supported: audio-file import, MPE/MIDI 2.0 per-note expression, SysEx synth patches, editing and re-saving MIDI beyond the labelled transposed copy.</li><li>Frequencies are theoretical 12-tone equal temperament, A4 = 440 Hz.</li></ul>
<h3>Keyboard</h3><p><span class="kbd">Space</span> play/pause · <span class="kbd">Home</span> start · <span class="kbd">1</span>–<span class="kbd">9</span> switch views · on the piano roll: arrows move between notes, <span class="kbd">Enter</span> auditions, <span class="kbd">Esc</span> clears.</p>
<h3>Display</h3><p><b>Lite</b> halves particles and caps the frame rate; <b>Calm</b> removes motion (it follows your system's reduced-motion setting by default).</p></div>`;
  };
})();
