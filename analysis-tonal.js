/* Frequency Oasis — MIDI DNA
 * analysis-tonal.js : utilities, note statistics, key / scale / mode detection, chord analysis.
 * Every number is computed from the imported note events. Heuristics are labelled as such and
 * every confidence value has a published formula (see CONF_FORMULA below).
 */
(function () {
  'use strict';
  const FO = (globalThis.FO = globalThis.FO || {});
  const T = FO.theory || require('./theory.js');

  /* ---------------- utilities ---------------- */
  const U = {
    clamp: (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x),
    sum: (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; },
    mean: (a) => (a.length ? U.sum(a) / a.length : 0),
    std: (a) => { if (a.length < 2) return 0; const m = U.mean(a); let s = 0; for (const x of a) s += (x - m) * (x - m); return Math.sqrt(s / a.length); },
    median: (a) => { if (!a.length) return 0; const b = Array.from(a).sort((x, y) => x - y); const h = b.length >> 1; return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; },
    percentile: (a, p) => { if (!a.length) return 0; const b = Array.from(a).sort((x, y) => x - y); const i = (b.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return b[lo] + (b[hi] - b[lo]) * (i - lo); },
    pearson(a, b) {
      const n = a.length; let ma = 0, mb = 0;
      for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
      let num = 0, da = 0, db = 0;
      for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
      return da && db ? num / Math.sqrt(da * db) : 0;
    },
    cosine(a, b) {
      let n = 0, da = 0, db = 0;
      for (let i = 0; i < a.length; i++) { n += a[i] * b[i]; da += a[i] * a[i]; db += b[i] * b[i]; }
      return da && db ? n / Math.sqrt(da * db) : 0;
    },
    entropyNorm(a) { // normalised Shannon entropy 0..1
      const s = U.sum(a); if (!s) return 0; let h = 0;
      for (const x of a) if (x > 0) { const p = x / s; h -= p * Math.log(p); }
      return h / Math.log(a.length);
    },
    normalize(a) { const s = U.sum(a); return Array.from(a, x => (s ? x / s : 0)); },
    rotate(a, r) { const o = new Array(12); for (let d = 0; d < 12; d++) o[d] = a[(r + d) % 12]; return o; },
    lowerBound(arr, x, key) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if ((key ? arr[m][key] : arr[m]) < x) lo = m + 1; else hi = m; } return lo; },
    pct: (x, d = 0) => (x * 100).toFixed(d) + '%',
    histogram(values, edges) { const h = new Array(edges.length - 1).fill(0); for (const v of values) { for (let i = 0; i < edges.length - 1; i++) if (v >= edges[i] && v < edges[i + 1]) { h[i]++; break; } } return h; }
  };
  FO.util = U;

  const CONF_FORMULA = {
    centre: 'confidence = clamp(Δscore ÷ 0.10) × √clamp(notes ÷ 48) × clamp((in-scale mass − 0.60) ÷ 0.35), where Δscore is the lead of the best reading over the best reading with a different tonic.',
    scale: 'confidence = clamp(Δscore ÷ 0.06) × √clamp(notes ÷ 48) × clamp((in-scale mass − 0.60) ÷ 0.35), where Δscore is the lead over the runner-up reading of any kind.',
    chord: 'confidence = clamp((score − 0.30) ÷ 0.55) × (0.4 + 0.6 × clamp(lead over runner-up ÷ 0.20)); chord labels below score 0.30 are shown as non-chord clusters.',
    score: 'reading score = 0.8 × profile correlation + 0.2 × in-scale mass + small simplicity prior + cadence/chord bonuses (≤ 0.07 total).'
  };

  /* ---------------- helpers on notes ---------------- */
  function noteMass(n) {
    const d = U.clamp(n.durBeat, 0.1, 6);
    return d * Math.sqrt(n.velocity / 127);
  }
  function groupByOnset(notes) {
    const g = new Map();
    for (const n of notes) { const k = n.startTick; let a = g.get(k); if (!a) g.set(k, a = []); a.push(n); }
    return g;
  }
  /** per-track previous/next neighbours (by onset) for ornament classification */
  function buildNeighbors(notes) {
    const byTrack = new Map();
    for (const n of notes) { let a = byTrack.get(n.track); if (!a) byTrack.set(n.track, a = []); a.push(n); }
    const nb = new Map();
    for (const arr of byTrack.values()) {
      arr.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
      // collapse same-onset groups to a "line" (skyline) for neighbour relations
      for (let i = 0; i < arr.length; i++) {
        let p = i - 1; while (p >= 0 && arr[p].startTick === arr[i].startTick) p--;
        let q = i + 1; while (q < arr.length && arr[q].startTick === arr[i].startTick) q++;
        nb.set(arr[i].id, { prev: p >= 0 ? arr[p] : null, next: q < arr.length ? arr[q] : null });
      }
    }
    return nb;
  }

  /* ---------------- statistics ---------------- */
  function computeStats(notes, seq) {
    const n = notes.length;
    const pcMass = new Array(12).fill(0), pcCount = new Array(12).fill(0);
    const pitchCount = new Array(128).fill(0), pitchMass = new Array(128).fill(0);
    const octCount = {}, octMass = {};
    const durs = [], durBeats = [], vels = [];
    let lowest = null, highest = null;
    for (const x of notes) {
      const m = noteMass(x), p = x.pitch, pcx = p % 12, o = T.octave(p);
      pcMass[pcx] += m; pcCount[pcx]++; pitchCount[p]++; pitchMass[p] += m;
      octCount[o] = (octCount[o] || 0) + 1; octMass[o] = (octMass[o] || 0) + m;
      durs.push(x.durSec); durBeats.push(x.durBeat); vels.push(x.velocity);
      if (!lowest || p < lowest.pitch) lowest = x;
      if (!highest || p > highest.pitch) highest = x;
    }
    const durEdges = [0, 0.125, 0.25, 0.5, 1, 2, 4, Infinity];
    const durLabels = ['<1/32 note'.replace('1/32 note', '⅛ beat'), '⅛–¼', '¼–½', '½–1', '1–2', '2–4', '≥4 beats'];
    const velEdges = [0, 16, 32, 48, 64, 80, 96, 112, 128];

    // polyphony sweep
    const ev = [];
    for (const x of notes) { ev.push([x.startSec, 1]); ev.push([x.endSec, -1]); }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0, last = 0, activeT = 0, weighted = 0, maxPoly = 0;
    for (const [t, d] of ev) {
      if (cur > 0) { activeT += t - last; weighted += cur * (t - last); }
      cur += d; last = t; if (cur > maxPoly) maxPoly = cur;
    }
    const avgPoly = activeT > 0 ? weighted / activeT : (n ? 1 : 0);

    // density over time (onsets per bin)
    const span = seq.musicalEndSec || 0;
    let binSec = 1; while (span / binSec > 400) binSec *= 2;
    const nb = Math.max(1, Math.ceil(span / binSec));
    const density = new Array(nb).fill(0);
    for (const x of notes) density[Math.min(nb - 1, Math.floor(x.startSec / binSec))]++;

    // repeated pitch runs per track
    const byTrack = new Map();
    for (const x of notes) { let a = byTrack.get(x.track); if (!a) byTrack.set(x.track, a = []); a.push(x); }
    let repeatRuns = 0, longestRun = { len: 0, pitch: null, note: null };
    for (const arr of byTrack.values()) {
      let run = 1;
      for (let i = 1; i <= arr.length; i++) {
        if (i < arr.length && arr[i].pitch === arr[i - 1].pitch && arr[i].startTick > arr[i - 1].startTick) run++;
        else { if (run >= 3) { repeatRuns++; if (run > longestRun.len) longestRun = { len: run, pitch: arr[i - 1].pitch, note: arr[i - run] }; } run = 1; }
      }
    }

    const longHeld = notes.filter(x => x.durBeat >= 4).sort((a, b) => b.durBeat - a.durBeat).slice(0, 30);
    const veryShort = notes.filter(x => x.durSec < 0.06 || x.durBeat < 0.0625);
    const topPitches = pitchCount.map((c, p) => ({ pitch: p, count: c, mass: pitchMass[p] })).filter(o => o.count).sort((a, b) => b.count - a.count || b.mass - a.mass).slice(0, 12);

    return {
      count: n, pcMass, pcCount, pitchCount, pitchMass, octCount, octMass, topPitches,
      lowest, highest, meanPitch: U.mean(notes.map(x => x.pitch)),
      weightedMeanPitch: (() => { let s = 0, w = 0; for (const x of notes) { const m = noteMass(x); s += x.pitch * m; w += m; } return w ? s / w : 0; })(),
      duration: { meanSec: U.mean(durs), medianSec: U.median(durs), p10Sec: U.percentile(durs, 0.1), p90Sec: U.percentile(durs, 0.9), meanBeat: U.mean(durBeats), medianBeat: U.median(durBeats), hist: U.histogram(durBeats, durEdges), labels: durLabels },
      velocity: { mean: U.mean(vels), std: U.std(vels), min: vels.length ? Math.min(...vels) : 0, max: vels.length ? Math.max(...vels) : 0, p5: U.percentile(vels, 0.05), p95: U.percentile(vels, 0.95), hist: U.histogram(vels, velEdges) },
      polyphony: { avg: avgPoly, max: maxPoly, activeSec: activeT },
      density: { binSec, onsets: density },
      repeatRuns, longestRepeat: longestRun, longHeld, veryShort,
      pitchRange: n ? highest.pitch - lowest.pitch : 0
    };
  }

  /* ---------------- key / scale / mode ---------------- */
  function genericProfile(iv) {
    const p = new Array(12).fill(0);
    for (const i of iv) p[i] = 1;
    p[0] += 3;
    if (iv.indexOf(7) >= 0) p[7] += 1.5;
    const third = iv.indexOf(4) >= 0 ? 4 : iv.indexOf(3) >= 0 ? 3 : -1;
    if (third >= 0) p[third] += 1.0;
    return p;
  }
  const GEN = Object.fromEntries(T.SCALES.map(s => [s.id, genericProfile(s.iv)]));

  function weightedPitchClassProfile(notes, seq) {
    const pcw = new Array(12).fill(0);
    const groups = groupByOnset(notes);
    const lowest = new Set();
    for (const arr of groups.values()) { if (arr.length > 1) { let lo = arr[0]; for (const x of arr) if (x.pitch < lo.pitch) lo = x; lowest.add(lo.id); } }
    for (const x of notes) {
      let w = noteMass(x);
      const pos = seq.meter.position(x.startTick);
      const frac = pos.beatFloat - Math.floor(pos.beatFloat);
      if (frac < 0.06) w *= pos.beat === 1 ? 1.35 : 1.15;
      if (lowest.has(x.id)) w *= 1.2;
      pcw[x.pitch % 12] += w;
    }
    return pcw;
  }

  function scoreCandidate(rotNorm, scale, extras) {
    const prof = GEN[scale.id];
    let corr = U.pearson(rotNorm, prof);
    if (scale.id === 'major') corr = 0.5 * corr + 0.5 * U.pearson(rotNorm, T.KS_MAJOR);
    else if (scale.id === 'minor') corr = 0.5 * corr + 0.5 * U.pearson(rotNorm, T.KS_MINOR);
    let inMass = 0; for (const i of scale.iv) inMass += rotNorm[i];
    let score = 0.8 * corr + 0.2 * inMass + scale.prior;
    let bonus = 0;
    if (extras) {
      if (extras.finalBassRel === 0) bonus += 0.02;
      if (extras.finalChordRel === 0) bonus += 0.02;
      if (extras.firstRel === 0) bonus += 0.01;
      if (extras.finalTopRel === 0) bonus += 0.01;
      bonus += 0.03 * U.clamp(extras.tonicChord + 0.3 * extras.dominantChord, 0, 1);
    }
    return { score: score + bonus, corr, inMass, bonus };
  }

  function chordRootShares(chords) {
    const share = new Array(12).fill(0); let tot = 0;
    if (chords && chords.segments) for (const s of chords.segments) if (s.kind === 'chord') { const d = s.endSec - s.startSec; share[s.root] += d; tot += d; }
    return tot ? share.map(x => x / tot) : share;
  }

  function detectKey(notes, seq, chords) {
    const n = notes.length;
    const pcwRaw = weightedPitchClassProfile(notes, seq);
    const pcw = U.normalize(pcwRaw);
    const usedPcs = pcw.filter(x => x >= 0.02).length;
    const flatness = U.entropyNorm(pcwRaw);
    // first / final reference notes
    let firstNote = null, finalGroup = null;
    if (n) {
      const g = groupByOnset(notes);
      const ticks = [...g.keys()].sort((a, b) => a - b);
      const f = g.get(ticks[0]); firstNote = f.reduce((a, b) => (a.pitch <= b.pitch ? a : b));
      const l = g.get(ticks[ticks.length - 1]); finalGroup = { bass: l.reduce((a, b) => (a.pitch <= b.pitch ? a : b)), top: l.reduce((a, b) => (a.pitch >= b.pitch ? a : b)) };
    }
    const crs = chordRootShares(chords);
    let finalChordRoot = null;
    if (chords && chords.segments) for (let i = chords.segments.length - 1; i >= 0; i--) if (chords.segments[i].kind === 'chord') { finalChordRoot = chords.segments[i].root; break; }
    const cands = [];
    for (let root = 0; root < 12; root++) {
      const rot = U.rotate(pcw, root);
      const extras = {
        finalBassRel: finalGroup ? ((finalGroup.bass.pitch - root) % 12 + 12) % 12 : -1,
        firstRel: firstNote ? ((firstNote.pitch - root) % 12 + 12) % 12 : -1,
        finalTopRel: finalGroup ? ((finalGroup.top.pitch - root) % 12 + 12) % 12 : -1,
        finalChordRel: finalChordRoot === null ? -1 : ((finalChordRoot - root) % 12 + 12) % 12,
        tonicChord: crs[root], dominantChord: crs[(root + 7) % 12]
      };
      for (const sc of T.SCALES) {
        const r = scoreCandidate(rot, sc, extras);
        cands.push({ root, rootName: '', scaleId: sc.id, scaleName: sc.name, score: r.score, corr: r.corr, inMass: r.inMass, outMass: 1 - r.inMass, bonus: r.bonus });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const best = cands[0];
    const secondAny = cands[1];
    const bestOtherRoot = cands.find(c => c.root !== best.root) || secondAny;
    const evid = Math.sqrt(U.clamp(n / 48));
    const cover = U.clamp((best.inMass - 0.6) / 0.35);
    const centreConfidence = U.clamp((best.score - bestOtherRoot.score) / 0.10) * evid * cover;
    const scaleConfidence = U.clamp((best.score - secondAny.score) / 0.06) * evid * cover;
    const heptBest = cands.find(c => T.SCALE_BY_ID[c.scaleId].iv.length === 7);
    let verdict, verdictText;
    if (n < 8 || usedPcs < 4) {
      verdict = 'insufficient';
      verdictText = `Only ${n} note${n === 1 ? '' : 's'} using ${usedPcs} significant pitch class${usedPcs === 1 ? '' : 'es'} — too little material to classify a key confidently. Candidates below are tentative.`;
    } else if (flatness >= 0.93 && heptBest.inMass < 0.86) {
      verdict = 'chromatic';
      verdictText = `The pitch-class distribution is nearly flat (normalised entropy ${flatness.toFixed(2)}) and no 7-note scale holds more than ${U.pct(heptBest.inMass)} of the weighted pitch mass. This material is chromatic, atonal or strongly polytonal — a single key is not a defensible description.`;
    } else if (centreConfidence < 0.33) {
      verdict = 'ambiguous';
      verdictText = 'The evidence supports more than one tonal centre almost equally. Compare the alternatives below instead of trusting the top result.';
    } else if (best.scaleId === 'major' || best.scaleId === 'minor') {
      verdict = 'tonal';
      verdictText = 'The material fits a conventional major/minor reading.';
    } else if (scaleConfidence >= 0.33) {
      verdict = 'modal';
      verdictText = 'The best reading is a mode or non-diatonic scale. Modal readings share their notes with major/minor keys, so compare the related readings before committing.';
    } else {
      verdict = 'centre-only';
      verdictText = `The tonal centre looks fairly clear, but several scales or modes explain the notes about equally well, so the scale is not settled. Treat ${'the top reading'} as one of several candidates.`;
    }
    const label = (c) => (c >= 0.66 ? 'High' : c >= 0.33 ? 'Moderate' : 'Low');
    for (const c of cands) { c.flats = T.spellFlats(c.root, c.scaleId); c.rootName = T.pcName(c.root, c.flats); }
    best.rootName = T.pcName(best.root, best.flats);
    return {
      verdict, verdictText, noteCount: n, usedPcs, flatness, pcw, pcwRaw,
      candidates: cands.slice(0, 24), allCandidates: cands, best,
      centreConfidence, scaleConfidence, centreLabel: label(centreConfidence), scaleLabel: label(scaleConfidence),
      firstPc: firstNote ? firstNote.pitch % 12 : null, finalBassPc: finalGroup ? finalGroup.bass.pitch % 12 : null, finalTopPc: finalGroup ? finalGroup.top.pitch % 12 : null,
      chordRootShare: crs, formula: CONF_FORMULA, _best: best
    };
  }

  /** Detailed description of one reading (root + scale) against a note set. Used when the user switches candidates. */
  function describeScale(key, root, scaleId, notes, seq, chords, neighbors) {
    const scale = T.SCALE_BY_ID[scaleId];
    const inSet = new Set(scale.iv.map(i => (root + i) % 12));
    const flats = T.spellFlats(root, scaleId);
    const nm = (p) => T.pcName(p, flats);
    const found = key.allCandidates.find(c => c.root === root && c.scaleId === scaleId);
    const rank = key.allCandidates.indexOf(found) + 1;
    const rotNorm = U.rotate(key.pcw, root);
    const pcw = key.pcw;
    const ranks = pcw.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    const rankOf = (p) => ranks.findIndex(r => r.i === p) + 1;
    const relName = (d) => nm((root + d) % 12);
    const ev = [];
    ev.push(`Tonic ${nm(root)} holds ${U.pct(pcw[root], 1)} of the weighted pitch mass (rank ${rankOf(root)} of 12).`);
    if (scale.iv.indexOf(7) >= 0) ev.push(`Perfect 5th ${relName(7)} holds ${U.pct(pcw[(root + 7) % 12], 1)} (rank ${rankOf((root + 7) % 12)}).`);
    else ev.push('This scale has no perfect 5th above the tonic.');
    const third = scale.iv.indexOf(4) >= 0 ? 4 : scale.iv.indexOf(3) >= 0 ? 3 : null;
    if (third !== null) ev.push(`Defining ${third === 4 ? 'major' : 'minor'} 3rd ${relName(third)} holds ${U.pct(pcw[(root + third) % 12], 1)}; the opposite 3rd ${relName(third === 4 ? 3 : 4)} holds ${U.pct(pcw[(root + (third === 4 ? 3 : 4)) % 12], 1)}.`);
    const inMass = U.sum(scale.iv.map(i => rotNorm[i]));
    const outPcs = []; for (let d = 0; d < 12; d++) if (!scale.iv.includes(d) && pcw[(root + d) % 12] > 0.004) outPcs.push((root + d) % 12);
    ev.push(`${U.pct(inMass, 1)} of the weighted pitch mass lies inside this scale; ${outPcs.length ? outPcs.length + ' pitch class' + (outPcs.length > 1 ? 'es are' : ' is') + ' outside it (' + outPcs.map(nm).join(', ') + ').' : 'no pitch class is outside it.'}`);
    if (scale.char) {
      const m = pcw[(root + scale.char.deg) % 12];
      ev.push(m > 0.01 ? `Characteristic ${scale.char.label} (${relName(scale.char.deg)}) is present at ${U.pct(m, 1)}, which supports this mode.` : `Characteristic ${scale.char.label} (${relName(scale.char.deg)}) is essentially absent, so the evidence for this mode over its relatives is weak.`);
    }
    if (scale.iv.indexOf(11) >= 0 || scale.iv.indexOf(10) >= 0) {
      ev.push(`Leading tone (${relName(11)}) ${U.pct(pcw[(root + 11) % 12], 1)} vs subtonic ♭7 (${relName(10)}) ${U.pct(pcw[(root + 10) % 12], 1)}.`);
    }
    if (key.finalBassPc !== null) ev.push(`The last bass note is ${nm(key.finalBassPc)}${key.finalBassPc === root ? ' — it matches the tonic (a common, not guaranteed, sign of closure).' : ' — it is not the tonic.'}`);
    if (key.firstPc !== null) ev.push(`The first note is ${nm(key.firstPc)}${key.firstPc === root ? ' (the tonic).' : '.'}`);
    if (chords && chords.segments) {
      const tShare = key.chordRootShare[root], dShare = key.chordRootShare[(root + 7) % 12], sShare = key.chordRootShare[(root + 5) % 12];
      if (tShare + dShare + sShare > 0) ev.push(`Chord roots on ${nm(root)} occupy ${U.pct(tShare)} of chord time, on ${nm((root + 7) % 12)} ${U.pct(dShare)}, on ${nm((root + 5) % 12)} ${U.pct(sShare)}.`);
    }
    const sameSet = key.allCandidates.filter(c => c.root !== root && T.SCALE_BY_ID[c.scaleId].iv.length === scale.iv.length && T.SCALE_BY_ID[c.scaleId].iv.every(i => inSet.has((c.root + i) % 12)));
    const related = sameSet.slice(0, 7).map(c => ({ root: c.root, scaleId: c.scaleId, name: `${T.pcName(c.root, T.spellFlats(c.root, c.scaleId))} ${c.scaleName.split(' (')[0]}`, score: c.score }));

    // outside-scale notes: ornamental vs structural
    const outside = new Map();
    const alt = key.allCandidates.filter(c => c.root === root && c.scaleId !== scaleId).slice(0, 8);
    for (const x of notes) {
      const p = x.pitch % 12;
      if (inSet.has(p)) continue;
      let o = outside.get(p); if (!o) outside.set(p, o = { pc: p, name: nm(p), degree: T.degreeLabel(p - root), count: 0, mass: 0, ornamental: 0, structural: 0, explainedBy: [] });
      o.count++; o.mass += noteMass(x);
      const role = classifyOutside(x, inSet, neighbors);
      if (role === 'ornamental') o.ornamental++; else o.structural++;
    }
    const totalMass = U.sum(notes.map(noteMass)) || 1;
    for (const o of outside.values()) {
      o.massShare = o.mass / totalMass;
      for (const c of alt) if (T.SCALE_BY_ID[c.scaleId].iv.some(i => (c.root + i) % 12 === o.pc)) o.explainedBy.push(c.scaleName.split(' (')[0]);
      o.explainedBy = o.explainedBy.slice(0, 3);
      const orn = o.ornamental / o.count;
      o.verdict = orn >= 0.6 ? 'mostly ornamental — passing, neighbour or chromatic approach tones' : orn <= 0.25 ? 'mostly structural — held or emphasised, likely a deliberate colour or a different scale' : 'mixed — some ornamental, some structural';
    }
    const outsideList = [...outside.values()].sort((a, b) => b.mass - a.mass);
    let outCount = 0; for (const o of outsideList) outCount += o.count;
    return {
      root, scaleId, scale, flats, rootName: nm(root), name: `${nm(root)} ${scale.name}`, inPcs: [...inSet], outPcs, inSet, evidence: ev,
      score: found ? found.score : null, rank, inMass, outsideNoteCount: outCount, outsideList, related, noteName: nm,
      scaleNotes: scale.iv.map(i => nm((root + i) % 12))
    };
  }

  function classifyOutside(x, inSet, nb) {
    const q = nb && nb.get(x.id);
    if (x.durBeat <= 0.75 && q) {
      const near = (o) => o && Math.abs(o.pitch - x.pitch) <= 2;
      if (near(q.prev) && near(q.next)) return 'ornamental';
      if (q.next && Math.abs(q.next.pitch - x.pitch) <= 2 && inSet.has(q.next.pitch % 12) && x.durBeat <= 0.5) return 'ornamental';
    }
    return 'structural';
  }

  /* ---------------- chords ---------------- */
  function profileDissonance(w) {
    const tot = U.sum(w); if (!tot) return 0;
    let d = 0, norm = 0;
    for (let a = 0; a < 12; a++) { if (!w[a]) continue; for (let b = a + 1; b < 12; b++) { if (!w[b]) continue; const ww = w[a] * w[b]; d += ww * T.IC_DISS[T.icOf(a, b)]; norm += ww; } }
    return norm ? d / norm : 0;
  }

  function buildWindows(seq, mode, endTick) {
    const wins = []; const E = seq.meter.entries;
    for (let i = 0; i < E.length; i++) {
      const e = E[i], nextTick = i + 1 < E.length ? E[i + 1].tick : Infinity;
      let step = e.measTicks;
      if (mode === 'half-bar') step = e.measTicks / 2;
      else if (mode === 'beat' || mode === 'auto') step = (e.den === 8 && e.num % 3 === 0) ? e.beatTicks * 3 : e.beatTicks;
      if (!(step > 0)) step = seq.ppq;
      let t = e.tick;
      while (t < Math.min(nextTick, endTick)) { wins.push({ a: t, b: Math.min(t + step, nextTick) }); t += step; }
    }
    return wins;
  }

  const MISSING_W = { root: 0.35, third: 0.30, fifth: 0.10, seventh: 0.50, ext: 0.30 };
  const NC = T.CHORDS.length;
  const SWITCH_COST = 0.30, SAME_ROOT_COST = 0.85;

  /** Score of one (root, chord-template) hypothesis against a pitch-class weight profile. */
  function scoreState(w, total, maxW, r, ch, bassPc, bassPresent) {
    let inW = 0, missing = 0;
    for (const iv of ch.iv) {
      const tone = (r + iv) % 12;
      inW += w[tone];
      if (w[tone] < 0.12 * maxW) {
        const role = T.toneRole(iv, ch);
        missing += role === 'root' ? MISSING_W.root : (role === '3rd' || role === 'sus4' || role === 'sus2') ? MISSING_W.third : role === '5th' ? MISSING_W.fifth : (role === '7th' || role === '6th' || role === '♭♭7') ? MISSING_W.seventh : MISSING_W.ext;
      }
    }
    const outW = total - inW;
    let score = inW / total - 0.6 * outW / total - missing - ch.cx + 0.15 * (w[r] / maxW);
    let bassRole = null;
    if (bassPresent) {
      const rel = ((bassPc - r) % 12 + 12) % 12;
      const idx = ch.iv.findIndex(i => i % 12 === rel);
      if (idx === 0) { score += 0.12; bassRole = 'root'; }
      else if (idx > 0) { score += 0.04; bassRole = T.toneRole(ch.iv[idx], ch); }
      else { score -= 0.08; bassRole = 'non-chord'; }
    }
    return { score, coverage: inW / total, missing, bassRole };
  }

  function presentPcs(w) {
    let maxW = 0; for (const x of w) if (x > maxW) maxW = x;
    const present = []; for (let i = 0; i < 12; i++) if (w[i] >= 0.12 * maxW) present.push(i);
    return { present, maxW };
  }

  function labelProfile(w, bassPc, bassPresent) {
    const total = U.sum(w);
    if (total < 0.02) return { kind: 'silence' };
    const { present, maxW } = presentPcs(w);
    if (present.length === 1) return { kind: 'single', pcs: present };
    if (present.length === 2) {
      const ic = T.icOf(present[0], present[1]);
      return { kind: 'dyad', pcs: present, interval: ic, power: ic === 5 };
    }
    const evals = [];
    for (let r = 0; r < 12; r++) {
      if (w[r] < 0.12 * maxW && !(bassPresent && bassPc === r)) continue; // root must be sounding
      for (const ch of T.CHORDS) {
        const e = scoreState(w, total, maxW, r, ch, bassPc, bassPresent);
        evals.push({ root: r, chord: ch, score: e.score, coverage: e.coverage, missing: e.missing, bassRole: e.bassRole });
      }
    }
    evals.sort((a, b) => b.score - a.score);
    if (!evals.length) return { kind: 'cluster', pcs: present, alts: [] };
    const best = evals[0];
    const second = evals.find(e => e !== best && !(e.root === best.root && e.chord.id === best.chord.id)) || evals[1];
    const lead = second ? best.score - second.score : 0.2;
    let adj = 0; for (const p of present) if (present.includes((p + 1) % 12)) adj++;
    const clusterish = present.length >= 4 && adj / present.length >= 0.5;
    const confidence = U.clamp((best.score - 0.30) / 0.55) * (0.4 + 0.6 * U.clamp(lead / 0.20));
    const kind = (best.score < 0.30 || (clusterish && best.score < 0.55)) ? 'cluster' : 'chord';
    return { kind, best, evals: evals.slice(0, 5), lead, confidence, pcs: present, maxW };
  }

  /** Viterbi smoothing: a chord persists unless a different label wins by more than SWITCH_COST in total. */
  function smoothPath(windowProfiles, windowBass) {
    const NS = 12 * NC + 1, NONE = NS - 1, n = windowProfiles.length;
    const back = new Uint16Array(n * NS);
    let prev = new Float64Array(NS), cur = new Float64Array(NS);
    for (let t = 0; t < n; t++) {
      const w = windowProfiles[t], bp = windowBass[t];
      const total = U.sum(w);
      const em = new Float64Array(NS);
      if (total < 0.02) { em.fill(-3); em[NONE] = 1; }
      else {
        const { present, maxW } = presentPcs(w);
        const pen = present.length < 3 ? 0.30 : 0;
        for (let r = 0; r < 12; r++) for (let c = 0; c < NC; c++) {
          const e = scoreState(w, total, maxW, r, T.CHORDS[c], bp === null ? 0 : bp % 12, bp !== null);
          em[r * NC + c] = e.score - pen - (w[r] < 0.12 * maxW && !(bp !== null && bp % 12 === r) ? 0.4 : 0);
        }
        em[NONE] = present.length < 3 ? 0.5 : 0.30;
      }
      if (t === 0) { for (let s = 0; s < NS; s++) { cur[s] = em[s]; back[s] = s; } }
      else {
        const rb = new Float64Array(12).fill(-Infinity), rbs = new Int32Array(12);
        for (let r = 0; r < 12; r++) for (let c = 0; c < NC; c++) { const v = prev[r * NC + c]; if (v > rb[r]) { rb[r] = v; rbs[r] = r * NC + c; } }
        // best predecessor from a different root (or the non-chord state) for each target root, and for the non-chord state
        const otherVal = new Float64Array(13), otherFrom = new Int32Array(13);
        for (let r = 0; r < 13; r++) {
          let v = prev[NONE], f = NONE;
          if (r === 12) v = -Infinity;
          for (let q = 0; q < 12; q++) if (q !== r && rb[q] > v) { v = rb[q]; f = rbs[q]; }
          otherVal[r] = v; otherFrom[r] = f;
        }
        for (let s = 0; s < NS; s++) {
          const r = s === NONE ? 12 : (s / NC) | 0;
          let best = prev[s], from = s;
          const g = otherVal[r] - SWITCH_COST; if (g > best) { best = g; from = otherFrom[r]; }
          if (s !== NONE) { const v = rb[r] - SAME_ROOT_COST; if (v > best) { best = v; from = rbs[r]; } }
          cur[s] = best + em[s]; back[t * NS + s] = from;
        }
      }
      const tmp = prev; prev = cur; cur = tmp;
    }
    let s = 0, bv = -Infinity; for (let k = 0; k < NS; k++) if (prev[k] > bv) { bv = prev[k]; s = k; }
    const path = new Array(n);
    for (let t = n - 1; t >= 0; t--) { path[t] = s; s = back[t * NS + s]; }
    return path;
  }

  function chordLabel(root, ch, bassPc, flats) {
    const r = T.pcName(root, flats);
    let s = r + ch.sym;
    if (bassPc !== null && bassPc !== undefined && bassPc !== root) s += '/' + T.pcName(bassPc, flats);
    return s;
  }

  function analyzeChords(notes, seq, opts) {
    opts = opts || {};
    const mode = opts.window || 'auto';
    const out = { window: mode, segments: [], transitions: [], progressions: [], bassStats: null, noteMap: new Map(), caveats: [] };
    if (!notes.length) return out;
    let endTick = 0; for (const x of notes) if (x.endTick > endTick) endTick = x.endTick;
    const wins = buildWindows(seq, mode, endTick);
    const prof = wins.map(() => new Float64Array(12));
    const bass = wins.map(() => ({ pitch: 999, onsetPitch: 999 }));
    const members = wins.map(() => []);
    const winA = wins.map(w => w.a);
    for (const x of notes) {
      let wi = U.lowerBound(winA, x.startTick + 1) - 1; if (wi < 0) wi = 0;
      for (let i = wi; i < wins.length && wins[i].a < Math.max(x.endTick, x.startTick + 1); i++) {
        const w = wins[i], len = w.b - w.a;
        const ov = Math.min(x.endTick, w.b) - Math.max(x.startTick, w.a);
        const eff = ov > 0 ? ov : (x.startTick >= w.a && x.startTick < w.b ? 1 : 0);
        if (eff <= 0) continue;
        let wt = (eff / len) * (0.6 + 0.4 * x.velocity / 127);
        const onset = x.startTick >= w.a && x.startTick < w.b;
        if (onset) wt *= 1.25;
        prof[i][x.pitch % 12] += wt;
        members[i].push({ note: x, ov: eff / len, onset });
        if (eff / len >= 0.2 && x.pitch < bass[i].pitch) bass[i].pitch = x.pitch;
        if (onset && x.pitch < bass[i].onsetPitch) bass[i].onsetPitch = x.pitch;
      }
    }
    // per-window bass, then smoothed path
    const winBass = wins.map((w, i) => (bass[i].pitch < 999 ? bass[i].pitch : (bass[i].onsetPitch < 999 ? bass[i].onsetPitch : null)));
    const path = smoothPath(prof, winBass);
    const segs = [];
    for (let i = 0; i < wins.length; i++) {
      const last = segs[segs.length - 1];
      if (last && last.state === path[i]) { last.endTick = wins[i].b; last.idxs.push(i); }
      else segs.push({ state: path[i], startTick: wins[i].a, endTick: wins[i].b, idxs: [i] });
    }
    // per segment: merged profile, dominant bass, final label from the merged evidence
    for (const sg of segs) {
      const merged = new Float64Array(12); const bw = new Map();
      for (const i of sg.idxs) {
        for (let k = 0; k < 12; k++) merged[k] += prof[i][k];
        if (winBass[i] !== null) { const k = winBass[i] % 12; bw.set(k, (bw.get(k) || 0) + (wins[i].b - wins[i].a)); }
      }
      let bpc = null, bwv = -1; for (const [k, v] of bw) if (v > bwv) { bwv = v; bpc = k; }
      let bassPitch = null; if (bpc !== null) for (const i of sg.idxs) if (winBass[i] !== null && winBass[i] % 12 === bpc) { bassPitch = winBass[i]; break; }
      const res = labelProfile(merged, bpc === null ? 0 : bpc, bpc !== null);
      sg.first = { res, bassPitch, win: wins[sg.idxs[0]] };
    }
    const nb = opts.neighbors || buildNeighbors(notes);
    const ppq = seq.ppq;
    const noteMap = out.noteMap;
    for (let si = 0; si < segs.length; si++) {
      const sg = segs[si], L = sg.first, r = L.res;
      const seg = {
        idx: si, startTick: sg.startTick, endTick: sg.endTick, startSec: seq.tickToSec(sg.startTick), endSec: seq.tickToSec(sg.endTick),
        kind: r.kind, windows: sg.idxs.length
      };
      const pos = seq.meter.position(sg.startTick); seg.measure = pos.measure; seg.beat = pos.beat;
      const profile = new Array(12).fill(0);
      const mem = new Map();
      for (const i of sg.idxs) { for (let k = 0; k < 12; k++) profile[k] += prof[i][k]; for (const m of members[i]) mem.set(m.note.id, m); }
      const tot = U.sum(profile) || 1; seg.profile = profile.map(x => x / tot);
      seg.dissonance = profileDissonance(profile);
      seg.tension = U.clamp(seg.dissonance * 1.6);
      seg.noteIds = [...mem.keys()];
      seg.bassPitch = L.bassPitch; seg.bassPc = L.bassPitch === null ? null : L.bassPitch % 12;
      // texture
      const ons = new Map(); for (const m of mem.values()) if (m.onset) ons.set(m.note.startTick, (ons.get(m.note.startTick) || 0) + 1);
      const maxCluster = ons.size ? Math.max(...ons.values()) : 0;
      seg.texture = maxCluster >= 3 ? 'block / simultaneous' : ons.size >= 3 ? 'arpeggiated or melodic' : 'sparse';
      if (r.kind === 'chord') {
        const b = r.best, flats = false;
        seg.root = b.root; seg.chordId = b.chord.id; seg.chordName = b.chord.name;
        seg.flats = opts.flats === undefined ? false : opts.flats;
        seg.label = chordLabel(b.root, b.chord, seg.bassPc, seg.flats);
        const rel = seg.bassPc === null ? 0 : ((seg.bassPc - b.root) % 12 + 12) % 12;
        const bi = b.chord.iv.findIndex(i => i % 12 === rel);
        seg.inversion = bi < 0 ? -1 : (bi === 0 ? 0 : bi);
        seg.inversionText = bi === 0 ? 'root position' : bi === 1 ? '1st inversion (3rd in bass)' : bi === 2 ? '2nd inversion (5th in bass)' : bi === 3 ? '3rd inversion (7th in bass)' : bi > 3 ? 'extension in bass' : 'bass note is not a chord tone';
        seg.confidence = r.confidence; seg.score = b.score; seg.lead = r.lead;
        seg.alts = r.evals.filter(e => !(e.root === b.root && e.chord.id === b.chord.id)).slice(0, 3).map(e => ({ label: chordLabel(e.root, e.chord, seg.bassPc, seg.flats), root: e.root, chordId: e.chord.id, score: e.score }));
        seg.tones = b.chord.iv.map(iv => { const pcx = (b.root + iv) % 12; return { pc: pcx, name: T.pcName(pcx, seg.flats), role: T.toneRole(iv, b.chord), present: seg.profile[pcx] >= 0.12 * Math.max(...seg.profile), share: seg.profile[pcx] }; });
        const miss = seg.tones.filter(t => !t.present).map(t => t.role);
        seg.chordPcs = new Set(seg.tones.map(t => t.pc));
        const cov = U.sum(seg.tones.map(t => t.share));
        const sameSet = r.evals.find(e => e !== b && e.score > b.score - 0.12 && e.chord.tones.map(t => (e.root + t) % 12).sort().join() === b.chord.tones.map(t => (b.root + t) % 12).sort().join());
        seg.support = `${seg.label}: its tones ${seg.tones.map(t => t.name).join(' ')} cover ${U.pct(cov)} of the sounding material. ` +
          (seg.bassPc === null ? '' : `Lowest sustained note ${T.pcName(seg.bassPc, seg.flats)} is ${b.bassRole === 'root' ? 'the root' : b.bassRole === 'non-chord' ? 'not a chord tone' : 'the ' + b.bassRole}. `) +
          (miss.length ? `Not sounding: ${miss.join(', ')}. ` : 'All chord tones are sounding. ') +
          (sameSet ? `Equivalent reading with the same pitch classes: ${chordLabel(sameSet.root, sameSet.chord, seg.bassPc, seg.flats)} — the bass/root emphasis decided between them. ` : '') +
          `Texture: ${seg.texture}.`;
        // non-chord tones
        seg.nct = [];
        for (const m of mem.values()) {
          const x = m.note, pcx = x.pitch % 12;
          if (seg.chordPcs.has(pcx)) continue;
          if (m.ov < 0.2 && !m.onset) continue;
          const iv = ((pcx - b.root) % 12 + 12) % 12, q = nb.get(x.id);
          let type;
          const near = (o) => o && Math.abs(o.pitch - x.pitch) <= 2;
          if (x.durBeat <= 0.75 && q && near(q.prev) && near(q.next)) {
            type = ((q.prev.pitch < x.pitch && q.next.pitch > x.pitch) || (q.prev.pitch > x.pitch && q.next.pitch < x.pitch)) ? 'passing tone' : 'neighbour tone';
          } else if ((iv === 5 || iv === 2) && x.startTick <= sg.startTick + ppq / 8 && x.durBeat >= 1) type = iv === 5 ? 'suspension-like (held 4th)' : 'suspension-like (held 2nd)';
          else if (m.ov >= 0.5) type = 'added / extension tone';
          else type = 'unexplained non-chord tone';
          seg.nct.push({ noteId: x.id, pc: pcx, type });
        }
      } else if (r.kind === 'dyad') {
        const [a, b2] = r.pcs;
        seg.pcs = r.pcs; seg.interval = r.interval;
        seg.label = `${T.pcName(a)}–${T.pcName(b2)} · ${r.power ? 'P4/P5' : T.intervalName(r.interval)} dyad`;
        seg.support = `Only two pitch classes (${T.pcName(a)}, ${T.pcName(b2)}) are sounding, forming a ${T.intervalLong(r.interval)}. A dyad does not define a chord quality, so no chord name is assigned (a perfect 4th/5th could be a "power chord" on either note).`;
        seg.confidence = 0;
      } else if (r.kind === 'single') {
        seg.pcs = r.pcs; seg.label = T.pcName(r.pcs[0]); seg.support = 'A single pitch class — melodic, no harmony implied.'; seg.confidence = 0;
      } else if (r.kind === 'cluster') {
        seg.pcs = r.pcs; seg.label = 'cluster ' + r.pcs.map(p => T.pcName(p)).join(' ');
        seg.alts = (r.evals || []).slice(0, 3).map(e => ({ label: chordLabel(e.root, e.chord, seg.bassPc, false), root: e.root, chordId: e.chord.id, score: e.score }));
        seg.support = `${r.pcs.length} pitch classes sound together (${r.pcs.map(p => T.pcName(p)).join(' ')}) but no conventional chord explains them well${r.best ? ' (best match ' + chordLabel(r.best.root, r.best.chord, seg.bassPc, false) + ' scores only ' + r.best.score.toFixed(2) + ', below the 0.30 threshold)' : ''}. This may be a cluster, layered voicing, ornament or non-functional harmony, so no chord name is forced.`;
        seg.confidence = 0;
      } else { seg.label = '—'; seg.support = 'No notes sounding.'; seg.confidence = 0; }
      out.segments.push(seg);
      for (const id of seg.noteIds) { if (!noteMap.has(id)) noteMap.set(id, []); noteMap.get(id).push(si); }
    }

    // note roles within chords (for Notes view)
    for (const seg of out.segments) {
      if (seg.kind !== 'chord') continue;
      const nctSet = new Map(seg.nct.map(n => [n.noteId, n.type]));
      seg.noteRoles = new Map();
      for (const id of seg.noteIds) {
        const nn = seg.tones.find(t => false);
        seg.noteRoles.set(id, nctSet.get(id) || null);
      }
    }
    out.caveats.push('Chord labels come from pitch-class evidence in fixed analysis windows; arpeggios, ornaments and layered voicings can disguise the intended harmony.');
    out.chordCount = out.segments.filter(s => s.kind === 'chord').length;
    out.nonChordCount = out.segments.filter(s => s.kind === 'cluster' || s.kind === 'dyad').length;
    out.vocabulary = [...new Set(out.segments.filter(s => s.kind === 'chord').map(s => s.label.split('/')[0]))];
    return out;
  }

  const DOM_IDS = new Set(['7', '9', '7b9', '7s9', 'aug7', 'dim7', '7sus4', 'm7b5']);
  function isDominantType(seg, tonic) {
    if (seg.kind !== 'chord') return false;
    const colour = tonic !== null && (seg.root === tonic || seg.root === (tonic + 5) % 12); // I7 / IV7 are usually blues or modal colour, not dominants
    if (['7', '9', '7b9', '7s9', 'aug7', 'dim7'].includes(seg.chordId)) return !colour;
    if (tonic !== null && seg.chordId === 'maj' && seg.root === (tonic + 7) % 12) return true;
    return false;
  }

  function annotateHarmony(chords, key, selected) {
    const tonic = selected ? selected.root : null;
    const inSet = selected ? selected.inSet : null;
    const segs = chords.segments;
    for (const s of segs) {
      if (s.kind !== 'chord') continue;
      if (selected) {
        s.roman = T.roman(s.root, T.CHORDS.find(c => c.id === s.chordId), tonic);
        s.diatonic = s.tones.every(t => inSet.has(t.pc));
        s.flats = selected.flats;
        s.label = chordLabel(s.root, T.CHORDS.find(c => c.id === s.chordId), s.bassPc, selected.flats);
        s.tones.forEach(t => { t.name = T.pcName(t.pc, selected.flats); });
        for (const a of s.alts || []) a.label = chordLabel(a.root, T.CHORDS.find(c => c.id === a.chordId), s.bassPc, selected.flats);
        for (const n of s.nct) n.chromatic = !inSet.has(n.pc);
      }
    }
    const chordSegs = segs.filter(s => s.kind === 'chord');
    const trans = [];
    for (let i = 0; i + 1 < chordSegs.length; i++) {
      const a = chordSegs[i], b = chordSegs[i + 1];
      const rootMove = ((b.root - a.root) % 12 + 12) % 12;
      const common = a.tones.filter(t => b.tones.some(u => u.pc === t.pc)).map(t => t.name);
      const dt = b.tension - a.tension;
      let type = null;
      const dom = isDominantType(a, tonic);
      if (dom && rootMove === 5) type = 'dominant-type resolution (root falls a 5th)';
      else if (dom && (rootMove === 8 || rootMove === 9)) type = 'deceptive-type motion (dominant-type chord moves up to the 6th degree area)';
      else if (rootMove === 7 && tonic !== null && b.root === tonic) type = 'plagal-type motion (IV→I area)';
      else if (rootMove === 5) type = 'root falls a 5th';
      else if (rootMove === 7) type = 'root rises a 5th';
      else if (rootMove === 1 || rootMove === 11) type = 'chromatic root motion';
      else if (rootMove === 0) type = 'same root, quality change';
      trans.push({ from: a.idx, to: b.idx, rootMove, common, commonCount: common.length, dTension: dt, type, dominantTypeFrom: dom });
    }
    chords.transitions = trans;
    // unresolved tension
    const unresolved = [];
    for (let i = 0; i < chordSegs.length; i++) {
      const a = chordSegs[i];
      if (!isDominantType(a, tonic)) continue;
      const nextT = trans.find(t => t.from === a.idx);
      if (!nextT) { unresolved.push({ idx: a.idx, why: 'ends on a dominant-type chord with no following chord' }); continue; }
      if (!(nextT.rootMove === 5 || nextT.rootMove === 8 || nextT.rootMove === 9)) unresolved.push({ idx: a.idx, why: `dominant-type chord is followed by a root move of ${nextT.rootMove} semitones rather than falling a 5th` });
    }
    chords.unresolved = unresolved;
    if (chordSegs.length && tonic !== null) {
      const last = chordSegs[chordSegs.length - 1];
      chords.endsOnTonic = last.root === tonic;
    }
    // repeated progressions
    const seq = chordSegs.map(s => s.label.split('/')[0]);
    const found = [];
    for (let n = 2; n <= 8; n++) {
      const m = new Map();
      for (let i = 0; i + n <= seq.length; i++) {
        const k = seq.slice(i, i + n).join(' → ');
        let o = m.get(k); if (!o) m.set(k, o = { key: k, n, starts: [] });
        if (!o.starts.length || i >= o.starts[o.starts.length - 1] + n) o.starts.push(i);
      }
      for (const o of m.values()) if (o.starts.length >= 2 && new Set(o.key.split(' → ')).size > 1) found.push(o);
    }
    found.sort((a, b) => (b.n * b.starts.length) - (a.n * a.starts.length) || b.n - a.n);
    const kept = [];
    for (const f of found) {
      if (kept.some(k => k.key.indexOf(f.key) >= 0 && k.starts.length >= f.starts.length)) continue;
      kept.push(f); if (kept.length >= 8) break;
    }
    chords.progressions = kept.map(f => ({ labels: f.key.split(' → '), count: f.starts.length, length: f.n, segIdx: f.starts.map(i => chordSegs[i].idx), roman: tonic !== null ? chordSegs.slice(f.starts[0], f.starts[0] + f.n).map(s => s.roman).join(' – ') : null }));
    // bass-to-chord statistics
    const bs = { root: 0, first: 0, second: 0, third: 0, other: 0, nonChord: 0, total: 0, moves: new Array(12).fill(0) };
    for (const s of chordSegs) { bs.total++; if (s.inversion === 0) bs.root++; else if (s.inversion === 1) bs.first++; else if (s.inversion === 2) bs.second++; else if (s.inversion === 3) bs.third++; else if (s.inversion === -1) bs.nonChord++; else bs.other++; }
    for (let i = 0; i + 1 < chordSegs.length; i++) if (chordSegs[i].bassPc !== null && chordSegs[i + 1].bassPc !== null) bs.moves[((chordSegs[i + 1].bassPc - chordSegs[i].bassPc) % 12 + 12) % 12]++;
    chords.bassStats = bs;
    if (tonic !== null) { chords.diatonicShare = chordSegs.length ? chordSegs.filter(s => s.diatonic).length / chordSegs.length : 0; }
    chords.tensionMean = chordSegs.length ? U.mean(chordSegs.map(s => s.tension)) : 0;
    chords.dissonanceMean = chordSegs.length ? U.mean(chordSegs.map(s => s.dissonance)) : 0;
    return chords;
  }

  function chordAt(chords, sec) {
    const S = chords.segments; if (!S.length) return null;
    let lo = 0, hi = S.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m].startSec <= sec) lo = m; else hi = m - 1; }
    return S[lo].startSec <= sec && sec < S[lo].endSec + 1e-6 ? S[lo] : null;
  }

  FO.tonal = { computeStats, detectKey, describeScale, analyzeChords, annotateHarmony, chordAt, profileDissonance, noteMass, buildNeighbors, groupByOnset, weightedPitchClassProfile, CONF_FORMULA, chordLabel, classifyOutside, isDominantType };
  if (typeof module !== 'undefined' && module.exports) module.exports = FO.tonal;
})();
