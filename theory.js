/* Frequency Oasis — MIDI DNA
 * theory.js : equal-tempered pitch maths, scale + chord vocabularies, interval and Roman-numeral helpers.
 * Everything here is pure and deterministic.
 */
(function () {
  'use strict';
  const FO = (globalThis.FO = globalThis.FO || {});

  const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  // Which tonics are conventionally spelled with flats (pitch-class index of tonic)
  const FLAT_TONICS_MAJOR = new Set([5, 10, 3, 8, 1]); // F Bb Eb Ab Db

  const pc = (p) => ((p % 12) + 12) % 12;
  const octave = (p) => Math.floor(p / 12) - 1; // MIDI 60 = C4
  const pcName = (x, flats) => (flats ? FLAT : SHARP)[pc(x)];
  const noteName = (p, flats) => pcName(p, flats) + octave(p);
  /** Theoretical 12-TET frequency, A4 = 440 Hz. This is a pitch label, not a measurement of any rendered sound. */
  const freq = (p) => 440 * Math.pow(2, (p - 69) / 12);

  const INTERVAL_NAMES = ['P1', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'];
  const INTERVAL_LONG = ['unison', 'minor 2nd', 'major 2nd', 'minor 3rd', 'major 3rd', 'perfect 4th', 'tritone', 'perfect 5th', 'minor 6th', 'major 6th', 'minor 7th', 'major 7th', 'octave'];
  function intervalName(semi) {
    const a = Math.abs(semi);
    if (a <= 12) return INTERVAL_NAMES[a];
    const oct = Math.floor(a / 12), r = a % 12;
    return (r === 0 ? 'P' + (8 + 7 * (oct - 1)) : INTERVAL_NAMES[r] + '+' + oct + 'oct');
  }
  function intervalLong(semi) { const a = Math.abs(semi); return a <= 12 ? INTERVAL_LONG[a] : INTERVAL_LONG[a % 12] + ' + ' + Math.floor(a / 12) + ' octave(s)'; }

  const DEGREE_LABEL = ['1', '♭2', '2', '♭3', '3', '4', '♯4/♭5', '5', '♭6', '6', '♭7', '7'];
  const degreeLabel = (rel) => DEGREE_LABEL[pc(rel)];

  /* Dissonance weights by interval class (0..6). Roughly follows common sensory-dissonance rankings;
     used only as a transparent heuristic for "tension", never as an acoustic measurement. */
  const IC_DISS = [0, 1.0, 0.55, 0.22, 0.12, 0.18, 0.85];
  function icOf(a, b) { const d = Math.abs(a - b) % 12; return d > 6 ? 12 - d : d; }

  /* ---- scales ---- */
  // prior: small complexity penalty so that simpler explanations win ties.
  const SCALES = [
    { id: 'major', name: 'Major (Ionian)', iv: [0, 2, 4, 5, 7, 9, 11], prior: 0.0, bright: 0.72 },
    { id: 'minor', name: 'Natural minor (Aeolian)', iv: [0, 2, 3, 5, 7, 8, 10], prior: 0.0, bright: 0.30 },
    { id: 'dorian', name: 'Dorian', iv: [0, 2, 3, 5, 7, 9, 10], prior: -0.012, bright: 0.45, char: { deg: 9, label: 'natural 6th' } },
    { id: 'phrygian', name: 'Phrygian', iv: [0, 1, 3, 5, 7, 8, 10], prior: -0.012, bright: 0.20, char: { deg: 1, label: '♭2' } },
    { id: 'lydian', name: 'Lydian', iv: [0, 2, 4, 6, 7, 9, 11], prior: -0.012, bright: 0.85, char: { deg: 6, label: '♯4' } },
    { id: 'mixolydian', name: 'Mixolydian', iv: [0, 2, 4, 5, 7, 9, 10], prior: -0.012, bright: 0.60, char: { deg: 10, label: '♭7' } },
    { id: 'locrian', name: 'Locrian', iv: [0, 1, 3, 5, 6, 8, 10], prior: -0.03, bright: 0.12, char: { deg: 6, label: '♭5' } },
    { id: 'harmonic-minor', name: 'Harmonic minor', iv: [0, 2, 3, 5, 7, 8, 11], prior: -0.025, bright: 0.28, char: { deg: 11, label: 'raised 7th' } },
    { id: 'melodic-minor', name: 'Melodic minor (ascending)', iv: [0, 2, 3, 5, 7, 9, 11], prior: -0.03, bright: 0.42, char: { deg: 9, label: 'raised 6th & 7th' } },
    { id: 'phrygian-dominant', name: 'Phrygian dominant', iv: [0, 1, 4, 5, 7, 8, 10], prior: -0.04, bright: 0.32, char: { deg: 4, label: '♭2 with major 3rd' } },
    { id: 'harmonic-major', name: 'Harmonic major', iv: [0, 2, 4, 5, 7, 8, 11], prior: -0.045, bright: 0.58 },
    { id: 'double-harmonic', name: 'Double harmonic', iv: [0, 1, 4, 5, 7, 8, 11], prior: -0.05, bright: 0.35 },
    { id: 'pent-major', name: 'Major pentatonic', iv: [0, 2, 4, 7, 9], prior: -0.05, bright: 0.75, subset: true },
    { id: 'pent-minor', name: 'Minor pentatonic', iv: [0, 3, 5, 7, 10], prior: -0.05, bright: 0.32, subset: true },
    { id: 'blues', name: 'Blues hexatonic', iv: [0, 3, 5, 6, 7, 10], prior: -0.055, bright: 0.30, subset: true },
    { id: 'whole-tone', name: 'Whole-tone', iv: [0, 2, 4, 6, 8, 10], prior: -0.07, bright: 0.62 },
    { id: 'dim-wh', name: 'Diminished (whole–half)', iv: [0, 2, 3, 5, 6, 8, 9, 11], prior: -0.08, bright: 0.25 },
    { id: 'dim-hw', name: 'Diminished (half–whole)', iv: [0, 1, 3, 4, 6, 7, 9, 10], prior: -0.08, bright: 0.25 }
  ];
  const SCALE_BY_ID = Object.fromEntries(SCALES.map(s => [s.id, s]));

  /* Krumhansl–Kessler probe-tone profiles (major/minor key-finding baseline). */
  const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  /* ---- chord vocabulary ----
     tones: [interval, importance]; the first entry is the root. `sym` is appended to the root name. */
  const CHORDS = [
    { id: 'maj', sym: '', name: 'major triad', iv: [0, 4, 7], cx: 0 },
    { id: 'min', sym: 'm', name: 'minor triad', iv: [0, 3, 7], cx: 0 },
    { id: 'dim', sym: '°', name: 'diminished triad', iv: [0, 3, 6], cx: 0.01 },
    { id: 'aug', sym: '+', name: 'augmented triad', iv: [0, 4, 8], cx: 0.02 },
    { id: 'sus4', sym: 'sus4', name: 'suspended 4th', iv: [0, 5, 7], cx: 0.01 },
    { id: 'sus2', sym: 'sus2', name: 'suspended 2nd', iv: [0, 2, 7], cx: 0.01 },
    { id: '7', sym: '7', name: 'dominant 7th', iv: [0, 4, 7, 10], cx: 0.04 },
    { id: 'maj7', sym: 'maj7', name: 'major 7th', iv: [0, 4, 7, 11], cx: 0.04 },
    { id: 'm7', sym: 'm7', name: 'minor 7th', iv: [0, 3, 7, 10], cx: 0.04 },
    { id: 'm7b5', sym: 'm7♭5', name: 'half-diminished 7th', iv: [0, 3, 6, 10], cx: 0.05 },
    { id: 'dim7', sym: '°7', name: 'diminished 7th', iv: [0, 3, 6, 9], cx: 0.05 },
    { id: 'mmaj7', sym: 'm(maj7)', name: 'minor-major 7th', iv: [0, 3, 7, 11], cx: 0.06 },
    { id: '7sus4', sym: '7sus4', name: 'dominant 7th suspended 4th', iv: [0, 5, 7, 10], cx: 0.06 },
    { id: 'aug7', sym: '7♯5', name: 'augmented 7th', iv: [0, 4, 8, 10], cx: 0.07 },
    { id: '6', sym: '6', name: 'major 6th', iv: [0, 4, 7, 9], cx: 0.05 },
    { id: 'm6', sym: 'm6', name: 'minor 6th', iv: [0, 3, 7, 9], cx: 0.05 },
    { id: 'add9', sym: 'add9', name: 'major add 9', iv: [0, 2, 4, 7], cx: 0.05 },
    { id: 'madd9', sym: 'm(add9)', name: 'minor add 9', iv: [0, 2, 3, 7], cx: 0.06 },
    { id: 'maj9', sym: 'maj9', name: 'major 9th', iv: [0, 2, 4, 7, 11], cx: 0.09 },
    { id: '9', sym: '9', name: 'dominant 9th', iv: [0, 2, 4, 7, 10], cx: 0.09 },
    { id: 'm9', sym: 'm9', name: 'minor 9th', iv: [0, 2, 3, 7, 10], cx: 0.09 },
    { id: '7b9', sym: '7♭9', name: 'dominant 7th ♭9', iv: [0, 1, 4, 7, 10], cx: 0.11 },
    { id: '7s9', sym: '7♯9', name: 'dominant 7th ♯9', iv: [0, 3, 4, 7, 10], cx: 0.11 },
    { id: 'm11', sym: 'm11', name: 'minor 11th', iv: [0, 2, 3, 5, 7, 10], cx: 0.13 },
    { id: 'maj7s11', sym: 'maj7♯11', name: 'major 7th ♯11', iv: [0, 4, 6, 7, 11], cx: 0.12 }
  ];
  CHORDS.forEach(c => { c.tones = c.iv.map(i => i % 12); });

  /** Function of each chord tone for display: root, 3rd/sus, 5th, 7th, ext */
  function toneRole(iv, chord) {
    if (iv === 0) return 'root';
    if (iv === 3 || iv === 4) return '3rd';
    if (iv === 5 && (chord.id.indexOf('sus4') >= 0)) return 'sus4';
    if (iv === 2 && chord.id === 'sus2') return 'sus2';
    if (iv === 6 || iv === 7 || iv === 8) return '5th';
    if (iv === 9 && (chord.id === '6' || chord.id === 'm6' || chord.id === 'dim7')) return chord.id === 'dim7' ? '♭♭7' : '6th';
    if (iv === 10 || iv === 11 || (iv === 9 && chord.id === 'dim7')) return '7th';
    if (iv === 2) return '9th';
    if (iv === 1) return '♭9';
    if (iv === 5) return '11th';
    return 'ext';
  }

  /* Roman numerals relative to a tonic. Case follows chord quality. */
  const ROMAN = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
  function roman(chordRootPc, chordDef, tonicPc) {
    const d = pc(chordRootPc - tonicPc);
    let r = ROMAN[d];
    const minorish = /^(min|dim|m7|m7b5|dim7|mmaj7|m6|madd9|m9|m11)$/.test(chordDef.id);
    if (minorish) r = r.toLowerCase();
    const suf = { dim: '°', dim7: '°7', m7b5: 'ø7', aug: '+', aug7: '+7', '7': '7', maj7: 'maj7', m7: '7', mmaj7: 'maj7', sus4: 'sus4', sus2: 'sus2', '7sus4': '7sus4', '6': '6', m6: '6', add9: 'add9', madd9: 'add9', maj9: 'maj9', '9': '9', m9: '9', '7b9': '7♭9', '7s9': '7♯9', m11: '11', maj7s11: 'maj7♯11' }[chordDef.id] || '';
    return r + suf;
  }

  function scaleNotes(rootPc, scaleId) { return SCALE_BY_ID[scaleId].iv.map(i => pc(rootPc + i)); }
  function spellFlats(rootPc, scaleId) {
    // prefer flats for flat-side tonics and for minor-type scales whose relative major is flat-side
    const s = SCALE_BY_ID[scaleId];
    const hasMinorThird = s.iv.indexOf(3) >= 0 && s.iv.indexOf(4) < 0;
    const relMajor = hasMinorThird ? pc(rootPc + 3) : rootPc;
    return FLAT_TONICS_MAJOR.has(relMajor);
  }

  FO.theory = {
    SHARP, FLAT, pc, octave, pcName, noteName, freq, INTERVAL_NAMES, intervalName, intervalLong, degreeLabel,
    IC_DISS, icOf, SCALES, SCALE_BY_ID, KS_MAJOR, KS_MINOR, CHORDS, toneRole, roman, scaleNotes, spellFlats
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = FO.theory;
})();
