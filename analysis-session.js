/* Frequency Oasis — MIDI DNA
 * analysis-session.js : one imported file + every analysis the UI can ask for.
 * Runs identically inside a Web Worker (preferred) or on the main thread (fallback, e.g. file:// previews).
 * Results are plain, structured-clone-safe data.
 */
(function () {
  'use strict';
  const FO = (globalThis.FO = globalThis.FO || {});
  const T = FO.theory || require('./theory.js');
  const MID = FO.midi || require('./midi-parser.js');
  const TN = FO.tonal || require('./analysis-tonal.js');
  const M = FO.motion || require('./analysis-motion.js');
  const C = FO.character || require('./analysis-character.js');
  const U = FO.util;

  class AnalysisSession {
    constructor(buffer, fileName) {
      this.parsed = MID.parse(buffer, fileName);
      this.fileName = fileName;
      this.setSequence(0);
    }
    setSequence(i) {
      this.seqIndex = Math.max(0, Math.min(this.parsed.sequences.length - 1, i | 0));
      this.seq = this.parsed.sequences[this.seqIndex];
      this.cache = {};
      return this.info();
    }

    info() {
      const p = this.parsed, s = this.seq;
      const tempo = M.tempoInfo(s);
      const traits = [];
      if (p.format === 2) traits.push('MIDI format 2: independent sequences — analysed one at a time');
      if (p.format === 0 && s.tracks.some(t => t.virtual)) traits.push('Format 0 file split into per-channel virtual tracks');
      if (tempo.changes > 0) traits.push(`${tempo.changes} tempo change${tempo.changes > 1 ? 's' : ''} (${tempo.minBpm.toFixed(0)}–${tempo.maxBpm.toFixed(0)} BPM)`);
      if (tempo.implicit) traits.push('No tempo event: 120 BPM default assumed (as the MIDI standard specifies)');
      if (s.timeSigs.length > 1) traits.push(`${s.timeSigs.length} time-signature regions`);
      else if (s.timeSigs[0].implicit) traits.push('No time signature: 4/4 assumed');
      const st = TN.computeStats(s.notes.filter(n => n.channel !== 9), s);
      if (st.polyphony.max >= 6) traits.push(`Dense polyphony (up to ${st.polyphony.max} simultaneous notes)`);
      if (s.tracks.some(t => t.isPercussion)) traits.push('Contains a percussion channel (10)');
      if (s.tracks.some(t => t.pitchBends.length)) traits.push('Contains pitch-bend data');
      if (s.tracks.some(t => Object.keys(t.ccCounts).length)) traits.push('Contains controller data (' + [...new Set(s.tracks.flatMap(t => Object.keys(t.ccCounts)))].slice(0, 8).map(c => 'CC' + c).join(', ') + ')');
      if (s.tracks.some(t => t.sysexCount)) traits.push('Contains SysEx messages (kept in the file, not analysed)');
      return {
        fileName: this.fileName, bytes: p.byteLength, format: p.format, ppq: p.ppq, smpte: p.smpte, warnings: p.warnings,
        sequences: p.sequences.map((q, i) => ({ id: i, label: q.label, notes: q.notes.length, tracks: q.musicalTracks.length, durationSec: q.musicalEndSec })),
        seqIndex: this.seqIndex, label: s.label,
        noteCount: s.notes.length, trackCount: s.tracks.length, musicalTrackCount: s.musicalTracks.length,
        durationSec: s.durationSec, musicalEndSec: s.musicalEndSec, endTick: s.endTick,
        tempo, timeSigs: s.timeSigs.map(t => ({ tick: t.tick, num: t.num, den: t.den, implicit: t.implicit })), fileKeySigs: s.keySigs.map(k => ({ tick: k.tick, sf: k.sf, minor: k.minor })), markers: s.markers,
        traits,
        tracks: s.tracks.map(t => ({
          index: t.index, name: t.name || '', instrumentName: t.instrumentName || '', channels: t.channels, virtual: t.virtual, noteCount: t.noteCount, isPercussion: t.isPercussion,
          programs: t.programs.map(x => ({ tick: x.tick, channel: x.channel, program: x.program, name: MID.gmProgramName(x.program) })),
          ccCounts: t.ccCounts, pitchBends: t.pitchBends.length, sysex: t.sysexCount, textEvents: t.textEvents.slice(0, 8),
          lowest: t.notes.length ? t.notes.reduce((a, b) => (a.pitch < b.pitch ? a : b)).pitch : null, highest: t.notes.length ? t.notes.reduce((a, b) => (a.pitch > b.pitch ? a : b)).pitch : null
        }))
      };
    }

    scopeNotes(req) {
      let ns = this.seq.notes;
      const set = req.tracks ? new Set(req.tracks) : null;
      if (set) ns = ns.filter(n => set.has(n.track));
      const all = ns;
      if (req.region) ns = ns.filter(n => n.startSec >= req.region.a - 1e-9 && n.startSec < req.region.b);
      return { trackScoped: all, scoped: ns };
    }

    compute(req) {
      req = req || {};
      const s = this.seq;
      const { trackScoped, scoped } = this.scopeNotes(req);
      const pitched = scoped.filter(n => n.channel !== 9);
      const out = { req, scope: { noteCount: scoped.length, pitchedCount: pitched.length, tracks: req.tracks || null, region: req.region || null }, empty: !pitched.length };
      out.statsAll = this.cleanStats(TN.computeStats(scoped, regionSeq(s, scoped, req)));
      if (!pitched.length) {
        out.rhythm = scoped.length ? M.rhythm(s, scoped, { grid: req.rhythmGrid || null }) : null;
        out.stats = out.statsAll; out.key = null; out.selected = null; out.chords = null; out.mood = null; out.structure = scoped.length ? C.structure(s, trackScoped, null) : null; out.terrain = [];
        out.roles = this.roles(null, null);
        return out;
      }
      const rs = regionSeq(s, pitched, req);
      const stats = TN.computeStats(pitched, rs);
      out.stats = this.cleanStats(stats);
      const neighbors = TN.buildNeighbors(pitched);
      const chords = TN.analyzeChords(pitched, s, { window: req.chordWindow || 'auto', neighbors });
      const key = TN.detectKey(pitched, s, chords);
      let root = key.best.root, scaleId = key.best.scaleId;
      if (req.key && req.key.scaleId && T.SCALE_BY_ID[req.key.scaleId]) { root = req.key.root; scaleId = req.key.scaleId; }
      const selected = TN.describeScale(key, root, scaleId, pitched, s, chords, neighbors);
      TN.annotateHarmony(chords, key, selected);
      out.key = key; out.chords = chords; out.selectedIsBest = root === key.best.root && scaleId === key.best.scaleId;
      // lines / voice leading
      const roles = this.roles(selected, chords);
      const melody = roles.find(r => r.role === 'melody') || roles.find(r => r.role === 'chords') || roles[0];
      const bass = roles.find(r => r.role === 'bass');
      out.roleIds = { melody: melody ? melody.index : null, bass: bass ? bass.index : null };
      const lt = req.lineTrack !== undefined && req.lineTrack !== null ? req.lineTrack : (melody ? melody.index : null);
      const lm = req.lineMode || 'top';
      if (lt !== null) {
        const tn = pitched.filter(n => n.track === lt);
        const line = M.extractLine(tn, lm);
        const la = M.lineAnalysis(line, s, selected);
        la.intervals = la.intervals.slice(0, 4000);
        out.line = { track: lt, mode: lm, analysis: la, polyphony: M.polyphonyOf(tn), noteIds: line.map(n => n.id).slice(0, 4000) };
      } else out.line = null;
      const pu = req.pair ? req.pair.upper : out.roleIds.melody, pl = req.pair ? req.pair.lower : out.roleIds.bass;
      if (pu !== null && pl !== null && pu !== pl && pu !== undefined && pl !== undefined) {
        out.pair = { upper: pu, lower: pl, result: M.pairAnalysis(M.extractLine(pitched.filter(n => n.track === pu), 'top'), M.extractLine(pitched.filter(n => n.track === pl), 'bottom'), s) };
        out.pair.result.crossings = out.pair.result.crossings.slice(0, 40); out.pair.result.overlaps = out.pair.result.overlaps.slice(0, 40);
      } else out.pair = null;
      out.rhythm = M.rhythm(s, scoped, { grid: req.rhythmGrid || null });
      const mo = C.mood(s, pitched, { stats, selected, chords, rhythm: out.rhythm, startSec: req.region ? req.region.a : undefined, endSec: req.region ? req.region.b : undefined });
      out.mood = mo; out.motifs = slimMotifs(mo.motifs); delete mo.motifs;
      out.terrain = C.terrain(s, pitched, chords);
      out.structure = this.structure(trackScoped, chords);
      out.roles = roles;
      if (req.compare) out.compare = C.compareRegions(s, trackScoped, req.compare.A, req.compare.B, chords);
      // tidy for structured clone
      delete selected.noteName; selected.scaleNotes = selected.scaleNotes.slice(); out.selected = selected;
      return out;
    }

    structure(notes, chords) { const st = C.structure(this.seq, notes, chords, {}); if (st.motifs) { st.motifs = slimMotifs(st.motifs); } return st; }

    roles(selected, chords) {
      const s = this.seq;
      const infos = C.trackRoles(s, s.notes, selected, chords);
      return infos.map(i => { const { notes, track, lineAnalysis, stats, ...rest } = i;
        const la = lineAnalysis; return Object.assign(rest, {
          stats: { lowest: stats.lowest.pitch, highest: stats.highest.pitch, meanPitch: stats.weightedMeanPitch, velocity: stats.velocity, duration: { meanBeat: stats.duration.meanBeat }, polyphony: stats.polyphony, pcMass: stats.pcMass, pitchRange: stats.pitchRange, topPitches: stats.topPitches.slice(0, 5), density: stats.density },
          line: { count: la.count, kinds: la.kinds, meanAbs: la.meanAbs, contour: la.contour, up: la.up, down: la.down, directionChanges: la.directionChanges, endsOnTonic: la.endsOnTonic } }); });
    }

    cleanStats(st) {
      const o = Object.assign({}, st);
      o.veryShort = { count: st.veryShort.length, ids: st.veryShort.slice(0, 200).map(n => n.id) };
      o.longHeld = st.longHeld.map(n => n.id);
      o.lowest = st.lowest ? st.lowest.id : null; o.highest = st.highest ? st.highest.id : null;
      o.longestRepeat = { len: st.longestRepeat.len, pitch: st.longestRepeat.pitch, id: st.longestRepeat.note ? st.longestRepeat.note.id : null };
      return o;
    }
  }

  function regionSeq(s, notes, req) {
    const end = req.region ? req.region.b : Math.max(s.musicalEndSec, 0);
    return { musicalEndSec: end, meter: s.meter, ppq: s.ppq, tickToSec: s.tickToSec, secToTick: s.secToTick };
  }
  function slimMotifs(m) {
    return { coverage: m.coverage, list: m.list.map(x => ({ id: x.id, track: x.track, notes: x.notes, intervals: x.intervals, count: x.count, transposed: x.transposed, exactPitch: x.exactPitch, occurrences: x.occurrences.slice(0, 40) })), coveredNoteIds: [...m.coveredNoteIds].slice(0, 20000) };
  }

  FO.AnalysisSession = AnalysisSession;
  if (typeof module !== 'undefined' && module.exports) module.exports = AnalysisSession;
})();
