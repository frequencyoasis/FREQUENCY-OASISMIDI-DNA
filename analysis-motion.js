/* Frequency Oasis — MIDI DNA
 * analysis-motion.js : melodic / harmonic intervals, voice leading, rhythm and groove.
 * Measured quantities (timing deviations, counts) are reported separately from interpretations (swing verdicts, syncopation labels).
 */
(function () {
  'use strict';
  const FO = (globalThis.FO = globalThis.FO || {});
  const T = FO.theory || require('./theory.js');
  const TN = FO.tonal || require('./analysis-tonal.js');
  const U = FO.util;

  /* ======================= LINES & INTERVALS ======================= */
  /** One note per onset. mode: 'mono' (as written), 'top' (highest at each onset), 'bottom' (lowest at each onset). */
  function extractLine(notes, mode) {
    const sorted = notes.slice().sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    if (mode === 'mono') return sorted;
    const line = []; let i = 0;
    while (i < sorted.length) {
      let j = i, pick = sorted[i];
      while (j < sorted.length && sorted[j].startTick === sorted[i].startTick) {
        if (mode === 'top' ? sorted[j].pitch > pick.pitch : sorted[j].pitch < pick.pitch) pick = sorted[j];
        j++;
      }
      line.push(pick); i = j;
    }
    return line;
  }
  function polyphonyOf(notes) {
    if (!notes.length) return { avg: 0, ambiguous: false, simultaneousOnsetShare: 0 };
    const s = TN.computeStats(notes, { musicalEndSec: Math.max(...notes.map(n => n.endSec)) });
    const g = TN.groupByOnset(notes); let multi = 0; for (const a of g.values()) if (a.length > 1) multi += a.length;
    return { avg: s.polyphony.avg, max: s.polyphony.max, simultaneousOnsetShare: multi / notes.length, ambiguous: s.polyphony.avg > 1.15 || multi / notes.length > 0.1 };
  }
  const kindOf = (a) => (a === 0 ? 'repeat' : a <= 2 ? 'step' : a <= 4 ? 'skip' : a <= 7 ? 'leap' : 'large leap');

  function lineAnalysis(line, seq, selected, opts) {
    opts = opts || {};
    const n = line.length;
    const out = { count: n, intervals: [], hist: {}, kinds: { repeat: 0, step: 0, skip: 0, leap: 0, 'large leap': 0 }, up: 0, down: 0, meanAbs: 0, contour: '', largest: [], chromaticRuns: [], unusual: [], unresolved: [], directionChanges: 0 };
    if (n < 2) return out;
    const tonic = selected ? selected.root : null, inSet = selected ? selected.inSet : null;
    const hist = {};
    for (let i = 1; i < n; i++) {
      const a = line[i - 1], b = line[i], d = b.pitch - a.pitch, ab = Math.abs(d);
      const iv = { from: a.id, to: b.id, semis: d, abs: ab, dir: Math.sign(d), kind: kindOf(ab), name: T.intervalName(d), startSec: b.startSec, tick: b.startTick, gapBeats: (b.startTick - a.endTick) / seq.ppq };
      out.intervals.push(iv); out.kinds[iv.kind]++;
      if (d > 0) out.up++; else if (d < 0) out.down++;
      const k = Math.max(-24, Math.min(24, d)); hist[k] = (hist[k] || 0) + 1;
    }
    out.hist = hist;
    out.meanAbs = U.mean(out.intervals.map(x => x.abs));
    let ch = 0, prevDir = 0; for (const iv of out.intervals) { if (iv.dir !== 0) { if (prevDir !== 0 && iv.dir !== prevDir) ch++; prevDir = iv.dir; } }
    out.directionChanges = ch;
    out.contour = out.intervals.slice(0, 96).map(x => (x.dir > 0 ? '↑' : x.dir < 0 ? '↓' : '→')).join('');
    out.largest = out.intervals.slice().sort((a, b) => b.abs - a.abs).slice(0, 10);
    // chromatic runs: >=3 consecutive semitone steps in one direction
    let run = [], rd = 0;
    const flush = () => { if (run.length >= 3) out.chromaticRuns.push({ from: run[0].from, to: run[run.length - 1].to, steps: run.length, dir: rd, startSec: run[0].startSec }); run = []; rd = 0; };
    for (const iv of out.intervals) { if (iv.abs === 1 && (rd === 0 || iv.dir === rd)) { run.push(iv); rd = iv.dir; } else { flush(); if (iv.abs === 1) { run = [iv]; rd = iv.dir; } } }
    flush();
    // unusual intervals: tritones, major 7ths, and anything > an octave that is rare in this line
    const total = out.intervals.length;
    for (const iv of out.intervals) {
      const k = Math.max(-24, Math.min(24, iv.semis));
      if ((iv.abs === 6 || iv.abs === 11 || iv.abs > 12) && (hist[k] / total) <= 0.04) out.unusual.push(iv);
    }
    out.unusual = out.unusual.slice(0, 20);
    // unresolved events
    const rel = (p) => (tonic === null ? null : ((p - tonic) % 12 + 12) % 12);
    for (let i = 0; i < out.intervals.length; i++) {
      const iv = out.intervals[i], nxt = out.intervals[i + 1];
      if (iv.abs >= 5 && nxt) {
        const resolved = nxt.dir === -iv.dir && nxt.abs <= 2;
        if (!resolved) out.unresolved.push({ type: 'leap not answered by a step back', noteId: iv.to, detail: `${iv.name} ${iv.dir > 0 ? 'up' : 'down'} followed by ${nxt.dir === 0 ? 'a repeated note' : nxt.name + (nxt.dir > 0 ? ' up' : ' down')}`, sec: iv.startSec, tick: iv.tick });
      }
    }
    if (tonic !== null && selected.scale.iv.indexOf(11) >= 0) {
      for (let i = 0; i + 1 < n - 0; i++) {
        if (rel(line[i].pitch) === 11 && i + 1 < n && rel(line[i + 1].pitch) !== 0 && line[i].durBeat <= 1.5)
          out.unresolved.push({ type: 'leading tone not resolved to the tonic', noteId: line[i].id, detail: `${T.noteName(line[i].pitch, selected.flats)} followed by ${T.noteName(line[i + 1].pitch, selected.flats)}`, sec: line[i].startSec, tick: line[i].startTick });
      }
    }
    const last = line[n - 1];
    if (tonic !== null) {
      const r = rel(last.pitch);
      if (![0, 3, 4, 7].includes(r)) out.unresolved.push({ type: 'line ends on a tendency degree', noteId: last.id, detail: `last note ${T.noteName(last.pitch, selected.flats)} is scale degree ${T.degreeLabel(r)} relative to ${selected.rootName}`, sec: last.startSec, tick: last.startTick });
      out.endsOnTonic = r === 0;
    }
    out.unresolved = out.unresolved.slice(0, 60);
    return out;
  }

  /** Harmonic relationship between an upper and a lower line sampled at every onset of either line. */
  function pairAnalysis(upper, lower, seq) {
    const out = { samples: 0, intervalClass: new Array(12).fill(0), compound: {}, consonant: 0, perfect4: 0, dissonant: 0, motion: { parallel: 0, similar: 0, contrary: 0, oblique: 0, static: 0 }, parallels: [], crossings: [], overlaps: [], mean: 0, caveat: '' };
    if (!upper.length || !lower.length) return out;
    const ticks = [...new Set([...upper.map(n => n.startTick), ...lower.map(n => n.startTick)])].sort((a, b) => a - b);
    const soundingAt = (line, t) => {
      let lo = 0, hi = line.length - 1, idx = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (line[m].startTick <= t) { idx = m; lo = m + 1; } else hi = m - 1; }
      return idx >= 0 && line[idx].endTick > t ? line[idx] : null;
    };
    let prev = null, sum = 0;
    for (const t of ticks) {
      const u = soundingAt(upper, t), l = soundingAt(lower, t);
      if (!u || !l) { prev = null; continue; }
      const semis = u.pitch - l.pitch, ic = ((Math.abs(semis)) % 12);
      out.samples++; out.intervalClass[ic]++; sum += Math.abs(semis);
      const cap = Math.min(Math.abs(semis), 36); out.compound[cap] = (out.compound[cap] || 0) + 1;
      if ([0, 3, 4, 7, 8, 9].includes(ic)) out.consonant++; else if (ic === 5) out.perfect4++; else out.dissonant++;
      if (semis < 0) out.crossings.push({ tick: t, sec: seq.tickToSec(t), upper: u.id, lower: l.id });
      if (prev) {
        const dU = u.pitch - prev.u.pitch, dL = l.pitch - prev.l.pitch;
        let m;
        if (dU === 0 && dL === 0) m = 'static';
        else if (dU === 0 || dL === 0) m = 'oblique';
        else if (Math.sign(dU) === Math.sign(dL)) m = dU === dL ? 'parallel' : 'similar';
        else m = 'contrary';
        out.motion[m]++;
        if (dU !== 0 && dL !== 0 && Math.sign(dU) === Math.sign(dL)) {
          const icPrev = Math.abs(prev.u.pitch - prev.l.pitch) % 12;
          if (ic === icPrev && (ic === 7 || ic === 0) && Math.abs(semis) >= 7)
            out.parallels.push({ kind: ic === 7 ? 'parallel fifths' : 'parallel octaves', tick: t, sec: seq.tickToSec(t), noteIds: [prev.u.id, u.id, prev.l.id, l.id] });
        }
        if (l.pitch > prev.u.pitch || u.pitch < prev.l.pitch) out.overlaps.push({ tick: t, sec: seq.tickToSec(t), noteIds: [u.id, l.id] });
      }
      prev = { u, l };
    }
    out.mean = out.samples ? sum / out.samples : 0;
    out.parallels = out.parallels.slice(0, 40);
    out.caveat = 'Lines are reduced to one note per onset. If a track contains several simultaneous voices, these results describe only the extracted top/bottom line and may miss inner-voice motion.';
    return out;
  }

  /* ======================= RHYTHM ======================= */
  function tempoInfo(seq) {
    const E = seq.tempoMap.entries; const segs = [];
    for (let i = 0; i < E.length; i++) { const end = i + 1 < E.length ? E[i + 1].sec : seq.durationSec; segs.push({ bpm: E[i].bpm, sec: Math.max(0, end - E[i].sec), tick: E[i].tick, implicit: !!E[i].implicit }); }
    const tot = U.sum(segs.map(s => s.sec)) || 1;
    return { entries: segs, meanBpm: U.sum(segs.map(s => s.bpm * s.sec)) / tot, minBpm: Math.min(...segs.map(s => s.bpm)), maxBpm: Math.max(...segs.map(s => s.bpm)), changes: E.length - 1, implicit: !!E[0].implicit && E.length === 1 };
  }

  function tempoCandidates(seq, notes) {
    const declared = tempoInfo(seq);
    const out = { declared, inferred: [], caveat: '' };
    const ons = notes.map(n => ({ t: n.startSec, v: n.velocity / 127 }));
    if (ons.length < 16) { out.caveat = 'Too few onsets to infer a pulse independently of the file tempo.'; return out; }
    const dur = Math.min(300, seq.musicalEndSec || 0), bin = 0.01, N = Math.ceil(dur / bin) + 2;
    const sig = new Float32Array(N);
    for (const o of ons) { if (o.t > dur) continue; const i = Math.round(o.t / bin); sig[i] += o.v; }
    const sm = new Float32Array(N); for (let i = 1; i < N - 1; i++) sm[i] = 0.25 * sig[i - 1] + 0.5 * sig[i] + 0.25 * sig[i + 1];
    const minLag = Math.round(60 / 210 / bin), maxLag = Math.round(60 / 45 / bin), maxMul = 4;
    const ac = new Float64Array(maxLag * maxMul + 2);
    for (let l = minLag; l <= maxLag * maxMul && l < N - 1; l++) { let s = 0; for (let i = 0; i + l < N; i++) s += sm[i] * sm[i + l]; ac[l] = s / (N - l); }
    const score = new Float64Array(maxLag + 2);
    for (let l = minLag; l <= maxLag; l++) score[l] = ac[l] + 0.5 * ac[2 * l] + 0.25 * ac[3 * l] + 0.12 * ac[4 * l];
    const peaks = [];
    for (let l = minLag + 1; l < maxLag; l++) if (score[l] > score[l - 1] && score[l] >= score[l + 1] && score[l] > 0) peaks.push({ l, s: score[l] });
    peaks.sort((a, b) => b.s - a.s);
    const chosen = [];
    for (const p of peaks) { const bpm = 60 / (p.l * bin); if (chosen.every(c => Math.abs(c.bpm / bpm - 1) > 0.08)) chosen.push({ bpm, s: p.s }); if (chosen.length >= 4) break; }
    const mx = chosen.length ? chosen[0].s : 1;
    for (const c of chosen) {
      const r = c.bpm / declared.meanBpm; let rel = '';
      if (Math.abs(r - 1) < 0.04) rel = 'matches the file tempo';
      else if (Math.abs(r - 2) < 0.07) rel = 'double the file tempo';
      else if (Math.abs(r - 0.5) < 0.04) rel = 'half the file tempo';
      else if (Math.abs(r - 1.5) < 0.06) rel = '3:2 against the file tempo';
      out.inferred.push({ bpm: c.bpm, strength: c.s / mx, relation: rel });
    }
    out.caveat = declared.changes > 0 ? 'The file contains tempo changes; a single inferred pulse can only describe the dominant or average feel.' : '';
    return out;
  }

  const stepWeight = (step, stepsPerBeat) => {
    if (step % (stepsPerBeat * 4) === 0) return 4;
    if (step % stepsPerBeat === 0) return 3;
    if (step % (stepsPerBeat / 2) === 0) return 2;
    return 1;
  };

  /**
   * opts.grid: 'declared' (file tempo map + time signatures) or {bpm} (user-chosen inferred pulse; beats assumed 4 per bar unless the file says otherwise)
   */
  function rhythm(seq, notes, opts) {
    opts = opts || {};
    const res = { n: notes.length, gridKind: 'declared', grid: null, onsetHist: null, deviation: null, swing: null, syncopation: null, densityPerMeasure: [], patternChange: [], trackPatterns: [], drumLanes: [], ioiMotifs: [], tempo: null, caveats: [] };
    res.tempo = tempoCandidates(seq, notes);
    if (!notes.length) return res;
    const ppq = seq.ppq;
    const m0 = seq.meter.entries[0];
    const stepsPerBeat = 4;
    const beatsPerMeasure = (m0.den === 8 && m0.num % 3 === 0) ? m0.num / 3 : (m0.num * 4 / m0.den);
    const mainStepsPerMeasure = Math.max(1, Math.round(m0.measTicks / (ppq / 4)));
    const inferred = opts.grid && opts.grid.bpm;
    const ons = [];
    let periodSec = 0, offsetSec = 0;
    if (inferred) {
      res.gridKind = 'inferred';
      periodSec = 60 / opts.grid.bpm;
      let sx = 0, sy = 0; for (const n of notes) { const ph = (n.startSec / periodSec) % 1; sx += Math.cos(2 * Math.PI * ph) * n.velocity; sy += Math.sin(2 * Math.PI * ph) * n.velocity; }
      offsetSec = ((Math.atan2(sy, sx) / (2 * Math.PI)) * periodSec + periodSec) % periodSec;
      const bpmeas = m0.num === 3 && m0.den === 4 ? 3 : 4;
      for (const n of notes) {
        const u = (n.startSec - offsetSec) / periodSec; const beatIdx = Math.floor(u + 1e-9);
        const measure = Math.floor(beatIdx / bpmeas);
        const stepF = (u - measure * bpmeas) * stepsPerBeat;
        const devSteps = stepF - Math.round(stepF);
        ons.push({ n, measure: measure + 1, stepF, beatPhase: u - beatIdx, devMs: devSteps * periodSec / stepsPerBeat * 1000, grid: '16th' });
      }
      res.grid = { kind: 'inferred', bpm: opts.grid.bpm, offsetSec, stepsPerMeasure: bpmeas * stepsPerBeat, beatsPerMeasure: bpmeas, stepsPerBeat, note: 'Inferred beat grid: period from the chosen tempo, phase estimated from the onsets. The file itself is not modified.' };
    } else {
      const E = seq.tempoMap.entries;
      for (const n of notes) {
        const pos = seq.meter.position(n.startTick);
        const stepTicks = ppq / 4;
        const inMeas = (pos.beatFloat * pos.beatTicks);
        const stepF = inMeas / stepTicks;
        const beatPhase = pos.tickInBeat / pos.beatTicks;
        // deviation to the nearest 16th or 8th-triplet gridline
        const d16 = n.startTick - Math.round(n.startTick / stepTicks) * stepTicks;
        const tripTicks = ppq / 3, d3 = n.startTick - Math.round(n.startTick / tripTicks) * tripTicks;
        const dev = Math.abs(d16) <= Math.abs(d3) ? d16 : d3;
        let lo = 0, hi = E.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (E[m].tick <= n.startTick) lo = m; else hi = m - 1; }
        const msPerTick = seq.smpte ? 1000 / seq.tempoMap.ticksPerSec : E[lo].usPerQuarter / ppq / 1000;
        ons.push({ n, measure: pos.measure, stepF: stepF % Math.max(1, Math.round(pos.measTicks / stepTicks)), beatPhase, devMs: dev * msPerTick, grid: Math.abs(d16) <= Math.abs(d3) ? '16th' : 'triplet' });
      }
      res.grid = { kind: 'declared', stepsPerMeasure: mainStepsPerMeasure, beatsPerMeasure, stepsPerBeat, note: 'Measured against the file’s own tempo map and time signatures.', meter: `${m0.num}/${m0.den}`, meterImplicit: !!m0.implicit };
    }
    const SPM = res.grid.stepsPerMeasure;
    // onset histogram
    const raw = new Array(SPM).fill(0), wt = new Array(SPM).fill(0); let offGrid = 0;
    for (const o of ons) {
      const r = Math.round(o.stepF);
      if (Math.abs(o.stepF - r) <= 0.34) { const k = ((r % SPM) + SPM) % SPM; raw[k]++; wt[k] += o.n.velocity; } else offGrid++;
    }
    res.onsetHist = { raw, weighted: wt, offGrid, stepWeights: raw.map((_, i) => stepWeight(i, stepsPerBeat)) };
    // deviation (measured)
    const devs = ons.map(o => o.devMs);
    const absd = devs.map(Math.abs);
    const within = (ms) => absd.filter(x => x <= ms).length / absd.length;
    const edges = []; for (let x = -50; x <= 50; x += 5) edges.push(x);
    const dh = new Array(edges.length - 1).fill(0);
    for (const d of devs) { const c = Math.max(-49.999, Math.min(49.999, d)); dh[Math.floor((c + 50) / 5)]++; }
    const dmean = U.mean(absd);
    let verdict;
    if (within(2) >= 0.95) verdict = 'Onsets sit exactly on a 16th/triplet grid — consistent with sequenced or quantised input.';
    else if (dmean <= 12) verdict = 'Onsets sit close to the grid with small timing variation.';
    else verdict = 'Onsets deviate noticeably from the grid — consistent with unquantised, performed timing (or a grid that does not match this tempo).';
    res.deviation = { meanAbsMs: dmean, meanSignedMs: U.mean(devs), stdMs: U.std(devs), within2: within(2), within10: within(10), within25: within(25), hist: dh, edges, verdict, gridDescription: res.gridKind === 'declared' ? 'nearest 16th note or 8th-note triplet' : 'nearest 16th of the inferred pulse' };
    // swing (needs enough off-beat eighths)
    const off8 = ons.filter(o => o.beatPhase > 0.40 && o.beatPhase < 0.72).map(o => o.beatPhase);
    if (off8.length >= 12) {
      const med = U.median(off8); const ratio = med / (1 - med);
      let sv;
      if (med < 0.53) sv = 'straight (even eighths)'; else if (med < 0.62) sv = 'light swing'; else if (med < 0.70) sv = 'triplet-style swing'; else sv = 'hard / dotted swing';
      res.swing = { n: off8.length, medianPhase: med, ratio, verdict: sv, note: `Median position of off-beat eighth-note onsets within the beat = ${med.toFixed(3)} (0.500 is straight, 0.667 is triplet swing), giving a long:short ratio of about ${ratio.toFixed(2)}:1.` };
    } else res.swing = { n: off8.length, verdict: 'inconclusive', note: `Only ${off8.length} off-beat eighth-note onsets — too few (need 12) to say anything reliable about swing.` };
    // syncopation + offbeat emphasis
    let offW = 0, totW = 0, sync = 0, weak = 0;
    const byTM = new Map();
    for (const o of ons) {
      const r = Math.round(o.stepF), onGrid = Math.abs(o.stepF - r) <= 0.34;
      const w = o.n.velocity; totW += w;
      if (!onGrid || r % stepsPerBeat !== 0) offW += w;
      if (onGrid) { const key = o.n.track + ':' + o.measure; let s = byTM.get(key); if (!s) byTM.set(key, s = new Set()); s.add(((r % SPM) + SPM) % SPM); }
    }
    for (const [, set] of byTM) {
      for (const st of set) {
        const w = stepWeight(st, stepsPerBeat);
        if (w <= 2) {
          weak++;
          // next stronger position
          let nx = st + 1; while (nx < SPM + 1 && stepWeight(nx % SPM, stepsPerBeat) <= w && nx % SPM !== 0) nx++;
          const nxm = nx % SPM; if (stepWeight(nxm, stepsPerBeat) > w && !set.has(nxm)) sync++;
        }
      }
    }
    const nOn = ons.length;
    res.syncopation = { offbeatShare: totW ? offW / totW : 0, syncopatedShare: nOn ? sync / nOn : 0, syncopatedCount: sync, weakOnsets: weak, note: 'Off-beat share is the velocity-weighted fraction of onsets not on a beat. Syncopated onsets are weak-position onsets whose next stronger metrical position has no onset in the same track and bar (a simplified metrical-weight test).' };
    // density / pattern change per measure
    const perMeasure = new Map(); const bitmaps = new Map();
    for (const o of ons) {
      perMeasure.set(o.measure, (perMeasure.get(o.measure) || 0) + 1);
      const r = Math.round(o.stepF), onGrid = Math.abs(o.stepF - r) <= 0.34;
      if (onGrid) { let b = bitmaps.get(o.measure); if (!b) bitmaps.set(o.measure, b = new Array(SPM).fill(0)); b[((r % SPM) + SPM) % SPM] = 1; }
    }
    const maxM = Math.max(...perMeasure.keys());
    for (let m = 1; m <= maxM; m++) res.densityPerMeasure.push(perMeasure.get(m) || 0);
    for (let m = 2; m <= maxM; m++) {
      const a = bitmaps.get(m - 1), b = bitmaps.get(m); if (!a || !b) { res.patternChange.push(0); continue; }
      let diff = 0, uni = 0; for (let i = 0; i < SPM; i++) { if (a[i] !== b[i]) diff++; if (a[i] || b[i]) uni++; }
      res.patternChange.push(uni ? diff / uni : 0);
    }
    // per-track bar patterns & repeated rhythm motifs
    const tracks = new Map();
    for (const o of ons) { let t = tracks.get(o.n.track); if (!t) tracks.set(o.n.track, t = []); t.push(o); }
    for (const [ti, arr] of tracks) {
      const bars = new Map();
      for (const o of arr) { const r = Math.round(o.stepF); if (Math.abs(o.stepF - r) > 0.34) continue; let b = bars.get(o.measure); if (!b) bars.set(o.measure, b = new Array(SPM).fill('·')); b[((r % SPM) + SPM) % SPM] = '█'; }
      const pat = new Map();
      for (const [m, b] of bars) { const k = b.join(''); let p = pat.get(k); if (!p) pat.set(k, p = { pattern: k, count: 0, measures: [] }); p.count++; p.measures.push(m); }
      const list = [...pat.values()].sort((a, b) => b.count - a.count);
      res.trackPatterns.push({ track: ti, bars: bars.size, patterns: list.slice(0, 4), uniquePatterns: list.length, repeatedShare: bars.size ? list.filter(p => p.count > 1).reduce((s, p) => s + p.count, 0) / bars.size : 0 });
      // IOI motifs (quantised to 16ths)
      const ts = [...new Set(arr.map(o => o.n.startTick))].sort((a, b) => a - b);
      const q = []; for (let i = 1; i < ts.length; i++) q.push(Math.max(1, Math.round((ts[i] - ts[i - 1]) / (ppq / 4))));
      const L = 6, mm = new Map();
      for (let i = 0; i + L <= q.length; i++) { const k = q.slice(i, i + L).join(','); let o = mm.get(k); if (!o) mm.set(k, o = { k, starts: [] }); if (!o.starts.length || i >= o.starts[o.starts.length - 1] + L) o.starts.push(i); }
      const best = [...mm.values()].filter(o => o.starts.length >= 3 && new Set(o.k.split(',')).size > 1).sort((a, b) => b.starts.length - a.starts.length).slice(0, 2);
      for (const b of best) res.ioiMotifs.push({ track: ti, sixteenths: b.k.split(',').map(Number), count: b.starts.length, firstSec: seq.tickToSec(ts[b.starts[0]]) });
    }
    // drum lanes for percussion channels
    const lanes = new Map();
    for (const o of ons) {
      if (o.n.channel !== 9) continue; const r = Math.round(o.stepF); if (Math.abs(o.stepF - r) > 0.34) continue;
      let l = lanes.get(o.n.pitch); if (!l) lanes.set(o.n.pitch, l = { pitch: o.n.pitch, name: FO.midi ? FO.midi.gmDrumName(o.n.pitch) : 'Drum ' + o.n.pitch, steps: new Array(SPM).fill(0), total: 0 });
      l.steps[((r % SPM) + SPM) % SPM]++; l.total++;
    }
    res.drumLanes = [...lanes.values()].sort((a, b) => b.total - a.total);
    res.caveats.push(res.gridKind === 'declared' ? 'Grid positions are measured against the tempo map and time signature stored in the file. If those are wrong or default, bar-relative statistics will be too.' : 'The inferred grid is an interpretation. Switch back to the file’s tempo map to see measured positions.');
    if (offGrid > ons.length * 0.25) res.caveats.push(`${offGrid} onsets (${U.pct(offGrid / ons.length)}) fall between 16th-note grid positions, so step-based pattern statistics cover only part of the material.`);
    return res;
  }

  FO.motion = { extractLine, polyphonyOf, lineAnalysis, pairAnalysis, rhythm, tempoCandidates, tempoInfo, stepWeight };
  if (typeof module !== 'undefined' && module.exports) module.exports = FO.motion;
})();
