/* Frequency Oasis — MIDI DNA
 * exports.js : real, verified exports. The original MIDI is always returned byte-for-byte; modified copies are labelled.
 */
(function () {
  'use strict';
  const FO = (globalThis.FO = globalThis.FO || {});
  const T = FO.theory;

  const baseName = (n) => String(n || 'untitled').replace(/\.(mid|midi)$/i, '').replace(/[^\w\-.() ]+/g, '_');
  function download(name, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { name, bytes: blob.size };
  }
  const csvCell = (v) => { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const toCSV = (rows, cols) => [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
  const r3 = (x) => (x === null || x === undefined ? null : Math.round(x * 1000) / 1000);

  function noteRows(S) {
    const seq = S.seq, A = S.analysis, sel = A && A.selected, inSet = sel ? sel.inSet : null, flats = sel ? sel.flats : false;
    const tracks = S.info.tracks; const chordMap = A && A.chords ? A.chords.noteMap : null;
    return seq.notes.map(n => {
      const pos = seq.meter.position(n.startTick), pc = n.pitch % 12;
      return {
        id: n.id, track: n.track, track_name: (tracks[n.track] && tracks[n.track].name) || '', channel: n.channel + 1, midi_pitch: n.pitch, note: T.noteName(n.pitch, flats), octave: T.octave(n.pitch),
        start_sec: r3(n.startSec), duration_sec: r3(n.durSec), start_tick: n.startTick, duration_ticks: n.durTick, measure: pos.measure, beat: r3(pos.beatFloat + 1), velocity: n.velocity, release_velocity: n.offVelocity,
        sounding_end_sec_with_sustain_pedal: r3(n.soundEndSec), theoretical_freq_hz_12tet_a440: r3(T.freq(n.pitch)),
        scale_reading: sel ? sel.name : '', scale_degree: sel ? T.degreeLabel(pc - sel.root) : '', in_scale: inSet ? (inSet.has(pc) ? 'yes' : 'no') : '', unclosed_note_off: n.unclosed ? 'yes' : '', in_chord_segments: chordMap && chordMap.get(n.id) ? chordMap.get(n.id).join(' ') : ''
      };
    });
  }
  const NOTE_COLS = ['id', 'track', 'track_name', 'channel', 'midi_pitch', 'note', 'octave', 'start_sec', 'duration_sec', 'start_tick', 'duration_ticks', 'measure', 'beat', 'velocity', 'release_velocity', 'sounding_end_sec_with_sustain_pedal', 'theoretical_freq_hz_12tet_a440', 'scale_reading', 'scale_degree', 'in_scale', 'unclosed_note_off', 'in_chord_segments'];

  function chordRows(S) {
    const A = S.analysis; if (!A || !A.chords) return [];
    return A.chords.segments.map(s => ({
      index: s.idx, start_sec: r3(s.startSec), end_sec: r3(s.endSec), measure: s.measure, beat: s.beat, kind: s.kind, label: s.label, roman: s.roman || '', inversion: s.inversionText || '', confidence: s.kind === 'chord' ? r3(s.confidence) : '', tension_0_1: r3(s.tension), diatonic_in_selected_scale: s.diatonic === undefined ? '' : (s.diatonic ? 'yes' : 'no'),
      alternatives: (s.alts || []).map(a => a.label + ' (' + r3(a.score) + ')').join(' | '), explanation: s.support || ''
    }));
  }
  const CHORD_COLS = ['index', 'start_sec', 'end_sec', 'measure', 'beat', 'kind', 'label', 'roman', 'inversion', 'confidence', 'tension_0_1', 'diatonic_in_selected_scale', 'alternatives', 'explanation'];

  function trackRows(S) {
    const A = S.analysis; const roles = A && A.roles ? A.roles : []; const tracks = S.info.tracks;
    return roles.map(r => ({
      track: r.index, name: r.name, channels: r.channel.map(c => c + 1).join(' '), program: r.programs.map(p => p.name).join(' | '), notes: r.n, lowest: T.noteName(r.stats.lowest), highest: T.noteName(r.stats.highest), mean_pitch: r3(r.stats.meanPitch),
      mean_velocity: r3(r.stats.velocity.mean), velocity_std: r3(r.stats.velocity.std), avg_polyphony: r3(r.avgPoly), notes_per_sec: r3(r.rate), inferred_role_hypothesis: r.role, role_confidence: r3(r.roleConfidence), role_reason: r.roleWhy, in_scale_share: r.inMass === null ? '' : r3(r.inMass)
    }));
  }
  const TRACK_COLS = ['track', 'name', 'channels', 'program', 'notes', 'lowest', 'highest', 'mean_pitch', 'mean_velocity', 'velocity_std', 'avg_polyphony', 'notes_per_sec', 'inferred_role_hypothesis', 'role_confidence', 'role_reason', 'in_scale_share'];

  function keyObject(S) {
    const A = S.analysis; if (!A || !A.key) return { note: 'No pitched notes in the analysis scope.' };
    const k = A.key, sel = A.selected;
    return {
      verdict: k.verdict, verdict_text: k.verdictText, note_count: k.noteCount,
      best: { tonic: k.best.rootName, scale: k.best.scaleName, score: r3(k.best.score), in_scale_mass: r3(k.best.inMass) },
      confidence: { tonal_centre: r3(k.centreConfidence), centre_label: k.centreLabel, scale: r3(k.scaleConfidence), scale_label: k.scaleLabel, formulas: k.formula },
      selected_reading: sel ? { tonic: sel.rootName, scale: sel.scale.name, notes: sel.scaleNotes, in_scale_mass: r3(sel.inMass), outside_pitch_classes: sel.outPcs.map(p => T.pcName(p, sel.flats)), evidence: sel.evidence, outside_notes: sel.outsideList.map(o => ({ pitch_class: o.name, degree: o.degree, count: o.count, mass_share: r3(o.massShare), verdict: o.verdict })) } : null,
      pitch_class_distribution: k.pcw.map((v, i) => ({ pitch_class: T.pcName(i, sel ? sel.flats : false), share: r3(v) })),
      candidates: k.candidates.slice(0, 16).map(c => ({ tonic: c.rootName, scale: c.scaleName, score: r3(c.score), in_scale_mass: r3(c.inMass) })),
      caveat: 'Key and scale are statistical readings of pitch content. Several scales can share the same notes; chromatic notes can be intentional.'
    };
  }

  function reportMD(S) {
    const A = S.analysis, I = S.info, L = [], P = (s) => L.push(s || '');
    const f = (x, d = 2) => (x === null || x === undefined ? '–' : Number(x).toFixed(d));
    P(`# MIDI DNA analysis — ${I.fileName}`); P(`*Frequency Oasis · every note leaves evidence · generated ${new Date().toISOString().slice(0, 10)} · computed locally in the browser*`); P();
    P('> Measured facts and interpretations are separated below. Interpretations are hypotheses with stated confidence, not verdicts. A MIDI file contains performance instructions, not sound, so nothing here describes timbre, mix or listener emotion.'); P();
    P('## File'); P(`- Format ${I.format}, ${I.ppq} ticks per quarter note${I.smpte ? ' (SMPTE timing)' : ''}, ${I.bytes} bytes`);
    P(`- ${I.musicalTrackCount} musical track(s) of ${I.trackCount}, ${I.noteCount} notes, duration ${f(I.musicalEndSec, 1)} s (to last note), ${f(I.durationSec, 1)} s (to end of file)`);
    P(`- Tempo: ${I.tempo.entries.map(e => f(e.bpm, 1) + ' BPM' + (e.implicit ? ' (default, none in file)' : '')).join(' → ')}; time signature ${I.timeSigs.map(t => t.num + '/' + t.den + (t.implicit ? ' (assumed)' : '')).join(' → ')}`);
    if (I.traits.length) { P('- Structural characteristics:'); I.traits.forEach(t => P(`  - ${t}`)); }
    if (I.warnings.length) { P('- Parser notes:'); I.warnings.forEach(t => P(`  - ${t}`)); }
    P(); P(`## Analysis scope`); P(A && A.scope ? `${A.scope.noteCount} notes (${A.scope.pitchedCount} pitched)${A.scope.tracks ? ' · tracks ' + A.scope.tracks.join(', ') : ' · all tracks'}${A.scope.region ? ' · region ' + f(A.scope.region.a, 1) + '–' + f(A.scope.region.b, 1) + ' s' : ' · whole piece'}` : 'n/a'); P();
    if (A && A.key) {
      const k = A.key, s = A.selected; P('## Key, scale and mode'); P(`**Verdict: ${k.verdict}.** ${k.verdictText}`); P();
      P(`- Best reading: **${k.best.rootName} ${k.best.scaleName}** — tonal-centre confidence ${f(k.centreConfidence)} (${k.centreLabel}), scale confidence ${f(k.scaleConfidence)} (${k.scaleLabel})`);
      if (s && !A.selectedIsBest) P(`- Reading currently selected by the user: **${s.name}**`);
      P('- Alternatives:'); k.candidates.slice(0, 6).forEach(c => P(`  - ${c.rootName} ${c.scaleName}: score ${f(c.score, 3)}, ${f(c.inMass * 100, 1)}% of weighted pitch mass inside`));
      if (s) { P(`- Evidence for ${s.name}:`); s.evidence.forEach(e => P(`  - ${e}`)); if (s.outsideList.length) { P('- Notes outside the scale (not necessarily wrong — chromatic notes can be intentional):'); s.outsideList.forEach(o => P(`  - ${o.name} (${o.degree}): ${o.count} notes, ${f(o.massShare * 100, 1)}% of mass — ${o.verdict}`)); } }
      P(`- Pitch-class distribution: ${k.pcw.map((v, i) => T.pcName(i, s ? s.flats : false) + ' ' + f(v * 100, 1) + '%').join(', ')}`); P(); P(`*Confidence formulas:* ${k.formula.centre} ${k.formula.scale}`); P();
    }
    if (A && A.chords) {
      const c = A.chords; P('## Chords and harmony'); P(`${c.chordCount} chord events, ${c.nonChordCount} non-chord clusters/dyads left unlabelled on purpose. Vocabulary: ${c.vocabulary.join(', ') || 'none'}.`); P();
      if (c.progressions.length) { P('Repeated progressions:'); c.progressions.forEach(p => P(`- ${p.labels.join(' → ')} ×${p.count}${p.roman ? ' (' + p.roman + ')' : ''}`)); P(); }
      if (c.unresolved && c.unresolved.length) { P('Possibly unresolved tension:'); c.unresolved.forEach(u => P(`- chord #${u.idx}: ${u.why}`)); P(); }
      P('| # | time | bar.beat | label | roman | confidence | tension | alternatives |'); P('|---|---|---|---|---|---|---|---|');
      c.segments.slice(0, 200).forEach(s => P(`| ${s.idx} | ${FO.fmtTime(s.startSec)} | ${s.measure}.${s.beat} | ${s.label} | ${s.roman || ''} | ${s.kind === 'chord' ? f(s.confidence) : '–'} | ${f(s.tension)} | ${(s.alts || []).map(a => a.label).join(', ')} |`)); if (c.segments.length > 200) P(`…and ${c.segments.length - 200} more (see the chord export).`); P();
    }
    if (A && A.rhythm && A.rhythm.grid) {
      const r = A.rhythm; P('## Rhythm and groove'); P(`- Grid: ${r.grid.note}`); P(`- Timing deviation from grid (measured): mean ${f(r.deviation.meanAbsMs, 1)} ms; ${f(r.deviation.within10 * 100, 0)}% of onsets within 10 ms. ${r.deviation.verdict}`);
      P(`- Swing: ${r.swing.verdict}. ${r.swing.note}`); P(`- Off-beat share ${f(r.syncopation.offbeatShare * 100, 0)}%, syncopated onsets ${f(r.syncopation.syncopatedShare * 100, 0)}%`);
      P(`- Tempo: declared ${r.tempo.declared.entries.map(e => f(e.bpm, 1)).join(' → ')} BPM; inferred pulse candidates ${r.tempo.inferred.map(c => f(c.bpm, 1) + ' BPM' + (c.relation ? ' (' + c.relation + ')' : '')).join(', ') || 'n/a'}`); P();
    }
    if (A && A.mood) {
      P('## Musical character (structure-derived, not listener emotion)'); P(A.mood.summary); P();
      A.mood.dims.forEach(d => { P(`- **${d.left} ↔ ${d.right}** — ${f(d.value)} (0 = ${d.left.toLowerCase()}, 1 = ${d.right.toLowerCase()}), confidence ${f(d.confidence)}. ${d.text}${d.alternative ? ' ' + d.alternative : ''}`); }); P(); P(`*${A.mood.caveat}*`); P();
    }
    if (A && A.structure && A.structure.regions.length) {
      const s = A.structure; P('## Arrangement structure (estimated regions, not verified section labels)'); s.regions.forEach((r, i) => P(`- ${String.fromCharCode(65 + i % 26)}: bars ${r.startMeasure}–${r.endMeasure} (${FO.fmtTime(r.startSec)}–${FO.fmtTime(r.endSec)}), ${r.noteCount} notes, ${r.character}, ${r.activeTracks} track(s)`));
      if (s.silences.length) P(`- Silences ≥ 1.5 beats: ${s.silences.length}`); if (s.repeated.length) P(`- Repeated material: ${s.repeated.length} similar span pair(s)`); P();
    }
    if (A && A.roles) { P('## Tracks (roles are hypotheses)'); trackRows(S).forEach(t => P(`- **${t.name}** (ch ${t.channels}, ${t.notes} notes, ${t.lowest}–${t.highest}): ${t.inferred_role_hypothesis}, confidence ${f(t.role_confidence)}. ${t.role_reason}`)); P(); }
    P('## Limitations'); P('- Chord names come from pitch-class evidence in fixed windows; arpeggios, ornaments and layered voicings can disguise intent.'); P('- Key/scale confidence is a transparent heuristic, not a probability.'); P('- Voice separation inside a single track is ambiguous; interval/voice-leading results describe the extracted top/bottom line only.'); P('- Theoretical frequencies assume 12-tone equal temperament, A4 = 440 Hz, and are labels, not measurements of any sound.');
    return L.join('\n');
  }

  function reportJSON(S) {
    const A = S.analysis, I = S.info;
    return JSON.stringify({ generator: 'Frequency Oasis — MIDI DNA', generated: new Date().toISOString(), file: { name: I.fileName, bytes: I.bytes, format: I.format, ppq: I.ppq, tempo: I.tempo, time_signatures: I.timeSigs, traits: I.traits, warnings: I.warnings },
      scope: A ? A.scope : null, key: keyObject(S), chords: chordRows(S), tracks: trackRows(S), rhythm: A && A.rhythm ? { grid: A.rhythm.grid, deviation: A.rhythm.deviation, swing: A.rhythm.swing, syncopation: A.rhythm.syncopation, tempo: A.rhythm.tempo } : null,
      mood: A && A.mood ? { summary: A.mood.summary, caveat: A.mood.caveat, dimensions: A.mood.dims.map(d => ({ axis: d.left + ' ↔ ' + d.right, value: r3(d.value), confidence: r3(d.confidence), explanation: d.text, alternative: d.alternative, components: d.components.map(c => ({ feature: c.name, detail: c.detail, push: r3(c.signed), weight: c.weight })) })) } : null,
      structure: A && A.structure ? { regions: A.structure.regions, boundaries: A.structure.boundaries, silences: A.structure.silences, repeated: A.structure.repeated } : null }, null, 2);
  }

  /** Every export returns {name, bytes}. Throws with a readable message instead of producing an empty file. */
  const EX = {
    original(S) { const bytes = new Uint8Array(S.parsed.original); if (!bytes.length) throw new Error('Original file bytes are not available.'); return download(S.info.fileName, bytes, 'audio/midi'); },
    transposed(S, semis) { const r = FO.midi.transposeCopy(S.parsed, semis); return download(baseName(S.info.fileName) + `.transposed${semis >= 0 ? '+' : ''}${semis}.mid`, r.bytes, 'audio/midi'); },
    notesCSV(S) { return download(baseName(S.info.fileName) + '.notes.csv', toCSV(noteRows(S), NOTE_COLS), 'text/csv'); },
    notesJSON(S) { return download(baseName(S.info.fileName) + '.notes.json', JSON.stringify(noteRows(S), null, 1), 'application/json'); },
    chordsCSV(S) { const rows = chordRows(S); if (!rows.length) throw new Error('There is no chord data in the current scope.'); return download(baseName(S.info.fileName) + '.chords.csv', toCSV(rows, CHORD_COLS), 'text/csv'); },
    chordsJSON(S) { const rows = chordRows(S); if (!rows.length) throw new Error('There is no chord data in the current scope.'); return download(baseName(S.info.fileName) + '.chords.json', JSON.stringify(rows, null, 1), 'application/json'); },
    keyJSON(S) { if (!S.analysis || !S.analysis.key) throw new Error('There is no key analysis in the current scope.'); return download(baseName(S.info.fileName) + '.key-scale.json', JSON.stringify(keyObject(S), null, 2), 'application/json'); },
    tracksCSV(S) { return download(baseName(S.info.fileName) + '.tracks.csv', toCSV(trackRows(S), TRACK_COLS), 'text/csv'); },
    tracksJSON(S) { return download(baseName(S.info.fileName) + '.tracks.json', JSON.stringify(trackRows(S), null, 1), 'application/json'); },
    reportMD(S) { return download(baseName(S.info.fileName) + '.analysis-report.md', reportMD(S), 'text/markdown'); },
    reportJSON(S) { return download(baseName(S.info.fileName) + '.analysis-report.json', reportJSON(S), 'application/json'); },
    wav(bytes, S) { return download(baseName(S.info.fileName) + '.synth-render.wav', bytes, 'audio/wav'); }
  };
  FO.exports = EX; FO.exportData = { noteRows, chordRows, trackRows, keyObject, reportMD, reportJSON, toCSV, NOTE_COLS };
})();
