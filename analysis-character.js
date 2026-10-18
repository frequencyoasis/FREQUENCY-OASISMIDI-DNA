/* Frequency Oasis — MIDI DNA
 * analysis-character.js : mood / character dimensions (with explanations), motifs, arrangement structure,
 * region comparison and track-role hypotheses.
 *
 * Every dimension is a weighted blend of named, measured components. Each component reports its raw value and
 * which way it pushes. Confidence = evidence (note count) × agreement between components. Nothing here claims to know
 * how the music sounds once rendered, or how any listener feels.
 */
(function () {
  'use strict';
  const FO = (globalThis.FO = globalThis.FO || {});
  const T = FO.theory || require('./theory.js');
  const TN = FO.tonal || require('./analysis-tonal.js');
  const M = FO.motion || require('./analysis-motion.js');
  const U = FO.util;
  const cl = (x, a = -1, b = 1) => U.clamp(x, a, b);

  /* ======================= MOTIFS ======================= */
  /** Transposition-invariant repeated interval patterns per track (top line). */
  function motifs(seq, notes, opts) {
    opts = opts || {};
    const minCount = opts.minCount || 3;
    const byTrack = new Map();
    for (const n of notes) { if (n.channel === 9) continue; let a = byTrack.get(n.track); if (!a) byTrack.set(n.track, a = []); a.push(n); }
    const found = [];
    for (const [ti, arr] of byTrack) {
      const line = M.extractLine(arr, 'top');
      if (line.length < 12) continue;
      const iv = []; for (let i = 1; i < line.length; i++) iv.push(Math.max(-14, Math.min(14, line[i].pitch - line[i - 1].pitch)));
      for (const L of [4, 6, 8, 12]) {
        const m = new Map();
        for (let i = 0; i + L <= iv.length; i++) {
          const slice = iv.slice(i, i + L);
          if (new Set(slice).size < 2) continue;
          const k = slice.join(',');
          let o = m.get(k); if (!o) m.set(k, o = { k, starts: [] });
          if (!o.starts.length || i >= o.starts[o.starts.length - 1] + L) o.starts.push(i);
        }
        for (const o of m.values()) if (o.starts.length >= minCount) {
          const occ = o.starts.map(s => ({ noteIds: line.slice(s, s + L + 1).map(n => n.id), startSec: line[s].startSec, startTick: line[s].startTick, firstPitch: line[s].pitch }));
          const exact = occ.every(x => x.firstPitch === occ[0].firstPitch);
          found.push({ track: ti, notes: L + 1, intervals: o.k.split(',').map(Number), count: o.starts.length, occurrences: occ, exactPitch: exact, transposed: !exact, coverage: o.starts.length * (L + 1) });
        }
      }
    }
    found.sort((a, b) => b.coverage - a.coverage || b.notes - a.notes);
    const kept = [];
    for (const f of found) {
      const ids = new Set(f.occurrences.flatMap(o => o.noteIds));
      if (kept.some(k => k.track === f.track && f.occurrences.every(o => o.noteIds.every(id => k._ids.has(id))))) continue;
      f._ids = ids; kept.push(f); if (kept.length >= 12) break;
    }
    const covered = new Set(); for (const k of kept) for (const id of k._ids) covered.add(id);
    return { list: kept.map((k, i) => { const { _ids, ...rest } = k; return Object.assign({ id: i }, rest); }), coveredNoteIds: covered, coverage: notes.length ? covered.size / notes.length : 0 };
  }

  /* ======================= MOOD ======================= */
  function feature(name, signed, weight, raw, detail) { return { name, signed: cl(signed), weight, raw, detail }; }

  function blend(id, left, right, comps, evid) {
    const W = U.sum(comps.map(c => c.weight)) || 1;
    const m = U.sum(comps.map(c => c.signed * c.weight)) / W;
    let varr = 0; for (const c of comps) varr += c.weight * (c.signed - m) * (c.signed - m); const sd = Math.sqrt(varr / W);
    const agreement = U.clamp(1 - sd / 0.8);
    const value = 0.5 + 0.5 * m;
    const sorted = comps.slice().sort((a, b) => Math.abs(b.signed * b.weight) - Math.abs(a.signed * a.weight));
    const dirWord = (c) => (c.signed >= 0 ? right : left).toLowerCase();
    const top = sorted.slice(0, 3).filter(c => Math.abs(c.signed) > 0.12);
    const leaning = Math.abs(m) < 0.12 ? 'neutral' : (m > 0 ? right : left).toLowerCase();
    let text = Math.abs(m) < 0.12 ? `Balanced between ${left.toLowerCase()} and ${right.toLowerCase()}.` : `Leans ${leaning}.`;
    if (top.length) text += ' Driven by: ' + top.map(c => `${c.detail} (pushes ${dirWord(c)})`).join('; ') + '.';
    const against = sorted.filter(c => Math.sign(c.signed) !== Math.sign(m) && Math.abs(c.signed) > 0.3);
    let alt = null;
    if (agreement < 0.55 && against.length) alt = `Mixed evidence: ${against.slice(0, 2).map(c => `${c.detail} pushes ${dirWord(c)}`).join('; ')}.`;
    return { id, left, right, value, signed: m, components: comps, confidence: evid * agreement, agreement, evidence: evid, text, alternative: alt };
  }

  function mood(seq, notes, ctx) {
    ctx = ctx || {};
    const n = notes.length;
    const out = { n, dims: [], summary: '', caveat: 'These are descriptions of the written musical structure, not measurements of how it will sound once rendered, nor claims about any listener’s feelings. Timbre, mix and performance are not in a MIDI file.', terrain: null };
    if (!n) return out;
    const stats = ctx.stats || TN.computeStats(notes, seq);
    const t0 = ctx.startSec !== undefined ? ctx.startSec : Math.min(...notes.map(x => x.startSec));
    const t1 = ctx.endSec !== undefined ? ctx.endSec : Math.max(...notes.map(x => x.endSec));
    const dur = Math.max(0.5, t1 - t0);
    const evid = Math.sqrt(U.clamp(n / 48));
    const sel = ctx.selected || null, chords = ctx.chords || null, rh = ctx.rhythm || null;
    const rate = n / dur;
    const bpm = M.tempoInfo(seq).meanBpm;
    const line = M.extractLine(notes.filter(x => x.channel !== 9), 'top');
    const la = M.lineAnalysis(line, seq, sel);
    const totalMass = U.sum(stats.pcMass) || 1;
    let high = 0, low = 0; for (let p = 0; p < 128; p++) { if (p >= 72) high += stats.pitchMass[p]; if (p < 48) low += stats.pitchMass[p]; }
    high /= totalMass; low /= totalMass;
    const wmp = stats.weightedMeanPitch;
    const pcw = U.normalize(stats.pcMass);

    // dark ↔ bright
    const dc = [feature('register', (wmp - 60) / 18, 1.0, wmp, `weighted mean pitch ${T.noteName(Math.round(wmp))}`)];
    if (sel) dc.push(feature('mode', (sel.scale.bright - 0.5) * 2, 1.3, sel.scale.bright, `${sel.name} reading`));
    else { const mj = pcw[4] + pcw[11] + pcw[9], mn = pcw[3] + pcw[8] + pcw[10]; if (mj + mn > 0.05) dc.push(feature('third/sixth/seventh colour', (mj - mn) / (mj + mn), 0.8, mj - mn, 'balance of major vs minor-type pitch classes above C')); }
    dc.push(feature('velocity', (stats.velocity.mean - 80) / 50, 0.4, stats.velocity.mean, `mean velocity ${stats.velocity.mean.toFixed(0)}`));
    // calm ↔ agitated
    const ac = [
      feature('onset rate', (Math.log2(rate) - Math.log2(3)) / 2.5, 1.2, rate, `${rate.toFixed(1)} notes per second`),
      feature('tempo', (bpm - 100) / 70, 0.7, bpm, `${bpm.toFixed(0)} BPM mean tempo`),
      feature('loudness', (stats.velocity.mean - 78) / 40, 0.6, stats.velocity.mean, `mean velocity ${stats.velocity.mean.toFixed(0)}`),
      feature('melodic motion', (la.meanAbs - 2.5) / 4, 0.8, la.meanAbs, `average melodic interval ${la.meanAbs.toFixed(1)} semitones`)
    ];
    if (rh && rh.syncopation) ac.push(feature('syncopation', (rh.syncopation.syncopatedShare - 0.1) / 0.3, 0.6, rh.syncopation.syncopatedShare, `${U.pct(rh.syncopation.syncopatedShare)} syncopated onsets`));
    // sparse ↔ dense
    const dnc = [
      feature('onset rate', (Math.log2(rate) - Math.log2(3)) / 2.2, 1.2, rate, `${rate.toFixed(1)} onsets per second`),
      feature('polyphony', (stats.polyphony.avg - 2) / 2.5, 1.0, stats.polyphony.avg, `average ${stats.polyphony.avg.toFixed(1)} simultaneous notes`),
      feature('pitch span', (stats.pitchRange - 30) / 30, 0.4, stats.pitchRange, `${stats.pitchRange}-semitone range`)
    ];
    // stable ↔ tense
    const tc = [];
    if (chords && chords.dissonanceMean !== undefined && chords.chordCount) tc.push(feature('chord dissonance', (chords.dissonanceMean - 0.25) / 0.3, 1.1, chords.dissonanceMean, `average chord dissonance ${chords.dissonanceMean.toFixed(2)}`));
    if (sel) {
      const out_ = 1 - sel.inMass; tc.push(feature('outside-scale mass', (out_ - 0.04) / 0.14, 1.0, out_, `${U.pct(out_, 1)} of notes lie outside ${sel.name}`));
      const unres = (la.unresolved.length / Math.max(1, line.length)) * 100; tc.push(feature('unresolved melodic events', (unres - 4) / 12, 0.6, unres, `${la.unresolved.length} unresolved melodic events`));
    }
    const tt = la.intervals.length ? la.intervals.filter(i => i.abs === 6).length / la.intervals.length : 0;
    tc.push(feature('tritone leaps', (tt - 0.02) / 0.08, 0.4, tt, `${U.pct(tt, 1)} melodic tritones`));
    const chromSteps = la.intervals.length ? la.intervals.filter(i => i.abs === 1).length / la.intervals.length : 0;
    tc.push(feature('semitone movement', (chromSteps - 0.1) / 0.25, 0.7, chromSteps, `${U.pct(chromSteps)} semitone steps`));
    if (chords && chords.unresolved) tc.push(feature('unresolved dominants', chords.unresolved.length ? Math.min(1, chords.unresolved.length / 3) : -0.3, 0.5, chords.unresolved.length, `${chords.unresolved.length} unresolved dominant-type chord(s)`));
    // grounded ↔ floating
    const gc = [
      feature('low register mass', -(low - 0.15) / 0.3, 1.0, low, `${U.pct(low)} of note mass below C3`),
      feature('high register mass', (high - 0.15) / 0.3, 1.0, high, `${U.pct(high)} of note mass above C5`),
      feature('note length', (stats.duration.meanBeat - 1) / 2.5, 0.6, stats.duration.meanBeat, `mean note length ${stats.duration.meanBeat.toFixed(2)} beats`)
    ];
    if (chords && chords.bassStats && chords.bassStats.total) gc.push(feature('root-position bass', -((chords.bassStats.root / chords.bassStats.total) - 0.6) / 0.4, 0.7, chords.bassStats.root / chords.bassStats.total, `${U.pct(chords.bassStats.root / chords.bassStats.total)} of chords have the root in the bass`));
    // restrained ↔ expressive
    let expr = 0; for (const t of seq.tracks) { for (const c of t.controllers) if (c.cc !== 64 && c.cc !== 0 && c.cc !== 32) expr++; expr += t.pitchBends.length; }
    const exprRate = expr / dur;
    const durs = notes.map(x => x.durBeat), dstd = U.std(durs) / (U.mean(durs) || 1);
    const ec = [
      feature('velocity variation', (stats.velocity.std - 10) / 18, 1.2, stats.velocity.std, `velocity σ ${stats.velocity.std.toFixed(1)}`),
      feature('dynamic range', ((stats.velocity.p95 - stats.velocity.p5) - 30) / 45, 0.8, stats.velocity.p95 - stats.velocity.p5, `${(stats.velocity.p95 - stats.velocity.p5).toFixed(0)} velocity range (5th–95th percentile)`),
      feature('duration variety', (dstd - 0.6) / 0.8, 0.5, dstd, `note-length variation ${dstd.toFixed(2)}`),
      feature('controller / bend activity', (Math.log10(1 + exprRate) - 0.3) / 0.9, 0.9, exprRate, `${exprRate.toFixed(1)} controller/bend events per second`)
    ];
    // repetitive ↔ evolving
    const mo = ctx.motifs || motifs(seq, notes);
    const rc = [feature('motif coverage', -(mo.coverage - 0.35) / 0.4, 1.2, mo.coverage, `${U.pct(mo.coverage)} of notes sit inside repeated motifs`)];
    if (rh && rh.trackPatterns.length) { const rs = U.mean(rh.trackPatterns.map(t => t.repeatedShare)); rc.push(feature('repeated bar rhythms', -(rs - 0.5) / 0.5, 1.0, rs, `${U.pct(rs)} of bars repeat an earlier rhythm pattern`)); }
    if (chords && chords.chordCount > 3) { const uniq = new Set(chords.segments.filter(s => s.kind === 'chord').map(s => s.label)).size / chords.chordCount; rc.push(feature('chord variety', (uniq - 0.4) / 0.4, 0.8, uniq, `${U.pct(uniq)} of chord events are distinct`)); }
    // register emphasis
    const regc = [feature('weighted mean pitch', (wmp - 60) / 16, 1.5, wmp, `weighted mean pitch ${T.noteName(Math.round(wmp))}`), feature('high vs low mass', (high - low) / 0.5, 1.0, high - low, `${U.pct(high)} above C5 vs ${U.pct(low)} below C3`)];
    // harmonic simplicity ↔ complexity
    const hc = [];
    if (chords && chords.chordCount) {
      const vocab = chords.vocabulary.length; hc.push(feature('chord vocabulary', (vocab - 5) / 8, 1.0, vocab, `${vocab} distinct chord types/roots`));
      const ext = chords.segments.filter(s => s.kind === 'chord' && !['maj', 'min', 'sus4', 'sus2'].includes(s.chordId)).length / chords.chordCount; hc.push(feature('extended / altered chords', (ext - 0.3) / 0.5, 0.9, ext, `${U.pct(ext)} chords beyond simple triads`));
      if (chords.diatonicShare !== undefined) hc.push(feature('non-diatonic chords', ((1 - chords.diatonicShare) - 0.15) / 0.4, 1.0, 1 - chords.diatonicShare, `${U.pct(1 - chords.diatonicShare)} of chords use non-scale notes`));
    }
    if (sel) hc.push(feature('chromatic pitch classes', ((10 - sel.inPcs.length) - 3) / 4, 0.4, 12 - sel.inPcs.length, `${sel.outPcs.length} pitch classes outside the scale`));
    hc.push(feature('pitch-class entropy', (U.entropyNorm(stats.pcMass) - 0.75) / 0.2, 0.7, U.entropyNorm(stats.pcMass), `pitch-class entropy ${U.entropyNorm(stats.pcMass).toFixed(2)}`));

    const defs = [
      ['brightness', 'Dark', 'Bright', dc], ['agitation', 'Calm', 'Agitated', ac], ['density', 'Sparse', 'Dense', dnc],
      ['tension', 'Stable', 'Tense', tc], ['weight', 'Grounded', 'Floating', gc], ['expression', 'Restrained', 'Expressive', ec],
      ['evolution', 'Repetitive', 'Evolving', rc], ['register', 'Low-register', 'High-register', regc], ['harmony', 'Harmonically simple', 'Harmonically complex', hc]
    ];
    for (const [id, l, r, comps] of defs) if (comps.length) out.dims.push(blend(id, l, r, comps, evid));
    const strong = out.dims.filter(d => Math.abs(d.signed) >= 0.2 && d.confidence >= 0.25).sort((a, b) => Math.abs(b.signed) * b.confidence - Math.abs(a.signed) * a.confidence).slice(0, 4);
    out.summary = strong.length ? 'Measured structure suggests: ' + strong.map(d => (d.signed > 0 ? d.right : d.left).toLowerCase()).join(', ') + '.' : 'No dimension shows a strong lean; the material sits near the middle on every measured axis.';
    out.motifs = mo;
    return out;
  }

  /** Time-resolved mood terrain: per bin, measured quantities only. */
  function terrain(seq, notes, chords, bins) {
    bins = bins || 72;
    const end = seq.musicalEndSec || 1; const step = end / bins;
    const rows = [];
    const sorted = notes.slice().sort((a, b) => a.startSec - b.startSec);
    let i0 = 0;
    for (let b = 0; b < bins; b++) {
      const a = b * step, z = a + step; const arr = [];
      while (i0 < sorted.length && sorted[i0].startSec < a - 8) i0++;
      for (let i = i0; i < sorted.length && sorted[i].startSec < z; i++) if (sorted[i].startSec >= a) arr.push(sorted[i]);
      const rate = arr.length / step;
      let wm = 0, ww = 0, vm = 0; for (const x of arr) { const w = TN.noteMass(x); wm += x.pitch * w; ww += w; vm += x.velocity; }
      const ch = chords ? TN.chordAt(chords, a + step / 2) : null;
      rows.push({ t0: a, t1: z, count: arr.length, density: arr.length ? U.clamp((Math.log2(rate + 1e-9) - Math.log2(1)) / 4) : 0, pitch: ww ? U.clamp((wm / ww - 36) / 60) : null, velocity: arr.length ? vm / arr.length / 127 : 0, tension: ch && ch.kind === 'chord' ? ch.tension : (ch ? ch.tension || 0 : null) });
    }
    return rows;
  }

  /* ======================= STRUCTURE ======================= */
  function structure(seq, notes, chords, opts) {
    opts = opts || {};
    const out = { bins: [], boundaries: [], regions: [], silences: [], abrupt: [], repeated: [], motifs: null, binSec: 0, caveat: 'Regions are estimated from changes in measured activity, register and pitch-class content. They are not verified verse/chorus/bridge labels.' };
    if (!notes.length) return out;
    const end = seq.musicalEndSec;
    // bin on bar lines when available, else fixed
    let edges = [];
    const mE = seq.meter.entries;
    const barSec = seq.tickToSec(mE[0].measTicks) - seq.tickToSec(0);
    const nBarsApprox = end / Math.max(0.2, barSec);
    if (nBarsApprox >= 4 && nBarsApprox <= 300 && mE.length === 1) {
      for (let t = 0; t < seq.endTick; t += mE[0].measTicks) edges.push(seq.tickToSec(t)); edges.push(seq.tickToSec(seq.endTick));
      out.binKind = 'bar';
    } else {
      const k = Math.max(1, Math.min(120, Math.ceil(end / 2))); for (let i = 0; i <= k; i++) edges.push(end * i / k);
      out.binKind = 'time';
    }
    const nb = edges.length - 1; const sorted = notes.slice().sort((a, b) => a.startSec - b.startSec);
    const bins = [];
    for (let b = 0; b < nb; b++) bins.push({ i: b, t0: edges[b], t1: edges[b + 1], notes: [], pcs: new Array(12).fill(0), tracks: new Set() });
    const binOf = (t) => { let lo = 0, hi = nb - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (edges[m] <= t) lo = m; else hi = m - 1; } return lo; };
    for (const x of sorted) { const b = bins[Math.min(nb - 1, binOf(x.startSec))]; b.notes.push(x); b.pcs[x.pitch % 12] += TN.noteMass(x); b.tracks.add(x.track); }
    for (const b of bins) {
      const d = Math.max(0.05, b.t1 - b.t0), c = b.notes.length;
      b.density = c / d; b.activeTracks = b.tracks.size;
      let ws = 0, w = 0, vel = 0; for (const x of b.notes) { const m = TN.noteMass(x); ws += x.pitch * m; w += m; vel += x.velocity; }
      b.meanPitch = w ? ws / w : null; b.velocity = c ? vel / c : 0;
      const lowNotes = b.notes.filter(x => x.pitch < 52 && x.channel !== 9).length, hiNotes = b.notes.filter(x => x.pitch >= 72).length;
      b.bassActive = lowNotes > 0; b.highActive = hiNotes > 0;
      b.pcsNorm = U.normalize(b.pcs);
    }
    const maxD = Math.max(...bins.map(b => b.density)) || 1;
    for (const b of bins) { b.densityNorm = b.density / maxD; }
    // feature vector + novelty
    const vec = bins.map(b => [...b.pcsNorm, b.densityNorm * 1.4, b.meanPitch === null ? 0 : (b.meanPitch - 60) / 40, b.activeTracks / (seq.musicalTracks.length || 1)]);
    const W = Math.max(2, Math.min(4, Math.floor(nb / 6)));
    const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]); return Math.sqrt(s); };
    const avgVec = (a, b) => { const o = new Array(vec[0].length).fill(0); let c = 0; for (let i = Math.max(0, a); i < Math.min(nb, b); i++) { for (let k = 0; k < o.length; k++) o[k] += vec[i][k]; c++; } return c ? o.map(x => x / c) : o; };
    const nov = new Array(nb).fill(0);
    for (let i = 1; i < nb; i++) nov[i] = dist(avgVec(i - W, i), avgVec(i, i + W));
    const mean = U.mean(nov), sd = U.std(nov);
    const bnd = [];
    for (let i = 1; i < nb - 1; i++) if (nov[i] > nov[i - 1] && nov[i] >= nov[i + 1] && nov[i] > mean + 0.9 * sd && nov[i] > 0.12) bnd.push({ bin: i, strength: nov[i], sec: bins[i].t0 });
    bnd.sort((a, b) => b.strength - a.strength);
    const picked = []; for (const b of bnd) if (picked.every(p => Math.abs(p.bin - b.bin) >= Math.max(2, W))) picked.push(b); picked.sort((a, b) => a.bin - b.bin);
    const mx = Math.max(1e-9, ...picked.map(p => p.strength));
    out.boundaries = picked.map(p => ({ bin: p.bin, sec: p.sec, tick: seq.secToTick(p.sec), strength: p.strength / mx, measure: seq.meter.position(Math.round(seq.secToTick(p.sec))).measure }));
    const cuts = [0, ...picked.map(p => p.bin), nb];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], z = cuts[i + 1]; const bs = bins.slice(a, z);
      const all = bs.flatMap(b => b.notes); if (!all.length) continue;
      const t0 = bs[0].t0, t1 = bs[bs.length - 1].t1;
      const dens = U.mean(bs.map(b => b.density)), wm = U.mean(bs.filter(b => b.meanPitch !== null).map(b => b.meanPitch));
      out.regions.push({ id: out.regions.length, startSec: t0, endSec: t1, startTick: seq.secToTick(t0), endTick: seq.secToTick(t1), bins: z - a, noteCount: all.length, density: dens, meanPitch: wm, meanVelocity: U.mean(all.map(x => x.velocity)), activeTracks: new Set(all.map(x => x.track)).size, bassShare: bs.filter(b => b.bassActive).length / bs.length, highShare: bs.filter(b => b.highActive).length / bs.length, startMeasure: seq.meter.position(seq.secToTick(t0)).measure, endMeasure: seq.meter.position(Math.max(0, seq.secToTick(t1) - 1)).measure });
    }
    const dAll = U.mean(out.regions.map(r => r.density)) || 1;
    for (const r of out.regions) r.character = r.density > dAll * 1.35 ? 'busy' : r.density < dAll * 0.65 ? 'sparse' : 'moderate';
    // silences: no note sounding for >= 1.5 beats
    const ev = []; for (const x of notes) ev.push([x.startTick, x.endTick]); ev.sort((a, b) => a[0] - b[0]);
    let cur = 0; const gapMin = seq.ppq * 1.5;
    for (const [a, z] of ev) { if (a - cur >= gapMin && cur > 0) out.silences.push({ startTick: cur, endTick: a, startSec: seq.tickToSec(cur), endSec: seq.tickToSec(a), beats: (a - cur) / seq.ppq }); if (z > cur) cur = z; }
    out.silences = out.silences.slice(0, 40);
    // abrupt changes: neighbouring bins differing in density by >= 2.5× (and enough notes)
    for (let i = 1; i < nb; i++) { const a = bins[i - 1].density, b = bins[i].density; if (Math.max(a, b) > 0 && Math.max(a, b) / Math.max(0.2, Math.min(a, b)) >= 2.5 && Math.max(bins[i - 1].notes.length, bins[i].notes.length) >= 6) out.abrupt.push({ sec: bins[i].t0, tick: seq.secToTick(bins[i].t0), kind: b > a ? 'sudden increase in activity' : 'sudden drop in activity', ratio: Math.max(a, b) / Math.max(0.2, Math.min(a, b)) }); }
    out.abrupt = out.abrupt.slice(0, 40);
    // repeated sections: self-similarity of bar bitmaps (pitch-class + density)
    const sim = (i, j) => 1 - Math.min(1, dist(vec[i], vec[j]) / 1.2);
    const seen = new Set();
    for (let L = Math.min(8, Math.floor(nb / 2)); L >= 2; L--) {
      for (let i = 0; i + L <= nb; i++) for (let j = i + L; j + L <= nb; j++) {
        let s = 0; for (let k = 0; k < L; k++) s += sim(i + k, j + k); s /= L;
        if (s >= 0.93) { const key = i + ':' + j; if ([...Array(L).keys()].some(k => seen.has((i + k) + ':' + (j + k)))) continue; for (let k = 0; k < L; k++) seen.add((i + k) + ':' + (j + k)); out.repeated.push({ aBin: i, bBin: j, bins: L, similarity: s, aSec: bins[i].t0, bSec: bins[j].t0, aEnd: bins[i + L - 1].t1, bEnd: bins[j + L - 1].t1 }); }
      }
    }
    out.repeated.sort((a, b) => b.bins - a.bins || b.similarity - a.similarity); out.repeated = out.repeated.slice(0, 16);
    out.bins = bins.map(b => ({ i: b.i, t0: b.t0, t1: b.t1, count: b.notes.length, density: b.density, densityNorm: b.densityNorm, meanPitch: b.meanPitch, activeTracks: b.activeTracks, bass: b.bassActive, high: b.highActive, velocity: b.velocity }));
    out.novelty = nov;
    out.motifs = opts.motifs || motifs(seq, notes);
    return out;
  }

  /** Compare two regions on measured quantities. regions = {startSec,endSec}. */
  function compareRegions(seq, notes, A, B, chords) {
    const pick = (r) => notes.filter(x => x.startSec >= r.startSec - 1e-9 && x.startSec < r.endSec);
    const side = (r) => {
      const ns = pick(r); const dur = Math.max(0.1, r.endSec - r.startSec);
      if (!ns.length) return { empty: true, n: 0, dur };
      const st = TN.computeStats(ns, { musicalEndSec: r.endSec });
      const pcs = U.normalize(st.pcMass);
      const ch = chords ? chords.segments.filter(s => s.kind === 'chord' && s.startSec < r.endSec && s.endSec > r.startSec) : [];
      return { n: ns.length, dur, rate: ns.length / dur, meanPitch: st.weightedMeanPitch, low: st.lowest.pitch, high: st.highest.pitch, vel: st.velocity.mean, poly: st.polyphony.avg, meanDur: st.duration.meanBeat, pcs, tracks: new Set(ns.map(x => x.track)).size, chords: [...new Set(ch.map(c => c.label.split('/')[0]))], tension: ch.length ? U.mean(ch.map(c => c.tension)) : null };
    };
    const a = side(A), b = side(B);
    const out = { a, b, rows: [], pcsCosine: null, verdict: '' };
    if (a.empty || b.empty) { out.verdict = 'One of the regions contains no notes.'; return out; }
    out.pcsCosine = U.cosine(a.pcs, b.pcs);
    const row = (label, av, bv, fmt) => out.rows.push({ label, a: fmt(av), b: fmt(bv), delta: bv - av, rel: av ? (bv - av) / Math.abs(av) : null });
    row('Notes', a.n, b.n, x => String(x)); row('Notes / sec', a.rate, b.rate, x => x.toFixed(2));
    row('Mean pitch (weighted)', a.meanPitch, b.meanPitch, x => T.noteName(Math.round(x)));
    row('Lowest note', a.low, b.low, x => T.noteName(x)); row('Highest note', a.high, b.high, x => T.noteName(x));
    row('Mean velocity', a.vel, b.vel, x => x.toFixed(0)); row('Avg polyphony', a.poly, b.poly, x => x.toFixed(2));
    row('Mean note length (beats)', a.meanDur, b.meanDur, x => x.toFixed(2)); row('Active tracks', a.tracks, b.tracks, x => String(x));
    if (a.tension !== null && b.tension !== null) row('Mean chord tension', a.tension, b.tension, x => x.toFixed(2));
    const bits = [];
    bits.push(`Pitch-class content is ${out.pcsCosine > 0.9 ? 'very similar' : out.pcsCosine > 0.7 ? 'related' : 'quite different'} (cosine similarity ${out.pcsCosine.toFixed(2)}).`);
    if (b.rate > a.rate * 1.3) bits.push('Region B is busier.'); else if (b.rate < a.rate / 1.3) bits.push('Region B is sparser.');
    if (b.meanPitch > a.meanPitch + 3) bits.push('Region B sits higher in register.'); else if (b.meanPitch < a.meanPitch - 3) bits.push('Region B sits lower in register.');
    out.verdict = bits.join(' ');
    return out;
  }

  /* ======================= TRACK ROLES ======================= */
  function trackRoles(seq, notes, selected, chords, opts) {
    const byTrack = new Map();
    for (const t of seq.musicalTracks) byTrack.set(t.index, { track: t, notes: [] });
    for (const n of notes) { const e = byTrack.get(n.track); if (e) e.notes.push(n); }
    const entries = [...byTrack.values()].filter(e => e.notes.length);
    const global = TN.computeStats(notes, seq);
    const infos = [];
    const bins = Math.max(1, Math.min(96, Math.ceil(seq.musicalEndSec / 1)));
    const binSec = seq.musicalEndSec / bins;
    for (const e of entries) {
      const ns = e.notes, t = e.track;
      const st = TN.computeStats(ns, { musicalEndSec: seq.musicalEndSec });
      const g = TN.groupByOnset(ns); let multi = 0; for (const a of g.values()) if (a.length > 1) multi += a.length;
      const simShare = multi / ns.length;
      const ticks = [...g.keys()].sort((a, b) => a - b); const ioi = []; for (let i = 1; i < ticks.length; i++) ioi.push(ticks[i] - ticks[i - 1]);
      const ioiCv = ioi.length ? U.std(ioi) / (U.mean(ioi) || 1) : 1;
      const line = M.extractLine(ns, 'top'); const la = M.lineAnalysis(line, seq, selected);
      const stepShare = la.intervals.length ? (la.kinds.step + la.kinds.repeat) / la.intervals.length : 0;
      const activity = new Array(bins).fill(0); for (const x of ns) activity[Math.min(bins - 1, Math.floor(x.startSec / binSec))]++;
      const activeShare = activity.filter(v => v > 0).length / bins;
      const inMass = selected ? U.sum(selected.inPcs.map(p => U.normalize(st.pcMass)[p])) : null;
      infos.push({ index: t.index, name: t.name || ('Track ' + (t.index + 1)), channel: t.channels, programs: t.programs.map(p => ({ tick: p.tick, program: p.program, name: FO.midi ? FO.midi.gmProgramName(p.program) : '' })), n: ns.length, stats: st, simShare, ioiCv, stepShare, activity, activeShare, inMass, percussion: t.isPercussion, meanPitch: st.weightedMeanPitch, avgPoly: st.polyphony.avg, meanDurBeat: st.duration.meanBeat, rate: ns.length / Math.max(1, seq.musicalEndSec), range: st.pitchRange, vel: st.velocity, lineAnalysis: la, notes: ns, track: t });
    }
    const meanPitches = infos.filter(i => !i.percussion).map(i => i.meanPitch);
    const highestMean = meanPitches.length ? Math.max(...meanPitches) : 0;
    for (const inf of infos) {
      const sc = {};
      sc.percussion = inf.percussion ? 1 : (inf.track.hasPercussionChannel ? 0.5 : 0);
      if (!inf.percussion) {
        sc.bass = U.clamp((54 - inf.meanPitch) / 14) * (inf.avgPoly < 1.5 ? 1 : 0.5) * (inf.stats.lowest.pitch < 50 ? 1 : 0.6);
        sc.pad = U.clamp((inf.meanDurBeat - 2) / 2.5) * U.clamp((inf.avgPoly - 1.5) / 2);
        sc.chords = U.clamp((inf.avgPoly - 1.7) / 1.8) * U.clamp(inf.simShare / 0.7) * (inf.meanDurBeat < 3 ? 1 : 0.7);
        sc.arpeggio = U.clamp((inf.avgPoly - 1.1) / 1.5) * U.clamp(1 - inf.simShare / 0.5) * U.clamp(1 - inf.ioiCv / 0.6) * U.clamp((inf.range - 9) / 12);
        const isTopVoice = inf.meanPitch >= highestMean - 6 ? 1 : 0.5;
        sc.melody = U.clamp((2.0 - inf.avgPoly) / 1.0) * U.clamp((inf.meanPitch - 55) / 12) * (0.5 + 0.5 * inf.stepShare) * isTopVoice * (inf.simShare < 0.25 ? 1 : 0.5);
      }
      const ranked = Object.entries(sc).sort((a, b) => b[1] - a[1]);
      const [r1, s1] = ranked[0], [r2, s2] = ranked[1] || ['', 0];
      const strong = s1 >= 0.30;
      inf.role = strong ? r1 : 'ambiguous';
      inf.roleConfidence = strong ? U.clamp(s1) * (0.5 + 0.5 * U.clamp((s1 - s2) / 0.4)) : 0;
      inf.roleScores = sc; inf.roleAlternatives = ranked.filter(([k, v], i) => i > 0 && v >= 0.2 && k !== r1).map(([k, v]) => ({ role: k, score: v }));
      const bits = [];
      if (inf.percussion) bits.push('plays on MIDI channel 10, which is conventionally percussion');
      else {
        bits.push(`mean pitch ${T.noteName(Math.round(inf.meanPitch))} (lowest ${T.noteName(inf.stats.lowest.pitch)}, highest ${T.noteName(inf.stats.highest.pitch)})`);
        bits.push(`average polyphony ${inf.avgPoly.toFixed(2)}, ${U.pct(inf.simShare)} of notes start together with others`);
        bits.push(`mean note length ${inf.meanDurBeat.toFixed(2)} beats`);
        if (inf.lineAnalysis.count > 3) bits.push(`${U.pct(inf.stepShare)} of top-line moves are steps or repeats`);
      }
      inf.roleWhy = (inf.role === 'ambiguous' ? 'No role scored clearly: ' : `Hypothesis “${inf.role}” because it `) + bits.join('; ') + '.';
      inf.programNote = inf.programs.length ? `Program change(s): ${inf.programs.slice(0, 3).map(p => p.name).join(', ')} — a General MIDI label, not proof of the sound used in a DAW.` : 'No program change; instrument is unspecified.';
    }
    // overlaps
    for (const a of infos) {
      a.overlap = [];
      for (const b of infos) {
        if (a === b) continue;
        const lo = Math.max(a.stats.lowest.pitch, b.stats.lowest.pitch), hi = Math.min(a.stats.highest.pitch, b.stats.highest.pitch);
        const rangeOv = hi > lo ? (hi - lo) / Math.max(1, Math.min(a.range, b.range) || 1) : 0;
        // time overlap in activity bins
        let both = 0, either = 0; for (let i = 0; i < bins; i++) { const x = a.activity[i] > 0, y = b.activity[i] > 0; if (x || y) either++; if (x && y) both++; }
        // collision: notes within 2 semitones simultaneously
        let coll = 0; const bn = b.notes; let j0 = 0;
        for (const x of a.notes) { while (j0 < bn.length && bn[j0].endTick <= x.startTick) j0++; for (let j = j0; j < bn.length && bn[j].startTick < x.endTick; j++) { if (Math.abs(bn[j].pitch - x.pitch) <= 2 && bn[j].pitch !== x.pitch) { coll++; break; } } }
        a.overlap.push({ other: b.index, otherName: b.name, rangeOverlap: U.clamp(rangeOv), timeOverlap: either ? both / either : 0, closeNoteShare: coll / a.notes.length });
      }
    }
    return infos;
  }

  FO.character = { mood, terrain, structure, motifs, compareRegions, trackRoles };
  if (typeof module !== 'undefined' && module.exports) module.exports = FO.character;
})();
