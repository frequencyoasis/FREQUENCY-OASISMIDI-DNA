'use strict';
const assert = require('assert');
const { F } = require('./test-fixtures.js');
const midi = require('./midi-parser.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); } }
const P = (k) => midi.parse(F[k].buffer.slice(F[k].byteOffset, F[k].byteOffset + F[k].byteLength), k + '.mid');

console.log('MIDI parser');

t('mono melody: note count, pitches, timing at 120 BPM', () => {
  const p = P('mono-melody-c-major'); const s = p.sequences[0];
  assert.strictEqual(p.format, 0); assert.strictEqual(p.ppq, 480);
  assert.strictEqual(s.notes.length, 18);
  assert.deepStrictEqual(s.notes.slice(0, 5).map(n => n.pitch), [60, 62, 64, 65, 67]);
  assert.ok(Math.abs(s.notes[1].startSec - 0.5) < 1e-9, 'beat 2 should be 0.5 s at 120 BPM');
  assert.ok(Math.abs(s.notes[0].durSec - 0.425) < 1e-3, 'legato 0.85 of 0.5 s');
  assert.ok(s.notes.every(n => n.endTick > n.startTick), 'vel-0 note-ons closed notes');
  assert.strictEqual(s.tempoMap.entries[0].bpm, 120);
});

t('running status + velocity-0 note-off parsed identically', () => {
  const s = P('mono-melody-c-major').sequences[0];
  assert.strictEqual(s.notes.filter(n => n.unclosed).length, 0);
});

t('chord progression: simultaneous notes, 4 notes at first onset', () => {
  const s = P('chord-progression-c-am-f-g').sequences[0];
  assert.strictEqual(s.notes.filter(n => n.startTick === 0).length, 4);
  assert.strictEqual(s.notes.length, 4 * 8 + 5);
  assert.ok(Math.abs(s.durationSec - (36 * 480 / 480 * 60 / 90)) < 0.5);
});

t('multitrack: 4 musical tracks, conductor is meta-only, names + programs read', () => {
  const s = P('multitrack-tempo-changes-a-minor').sequences[0];
  assert.strictEqual(s.musicalTracks.length, 4);
  assert.strictEqual(s.metaTracks.length, 1);
  const names = s.musicalTracks.map(t => t.name); assert.deepStrictEqual(names, ['Pad', 'Bass', 'Lead', 'Drums']);
  assert.strictEqual(s.musicalTracks[1].programs[0].program, 38);
  assert.ok(s.musicalTracks[3].isPercussion);
  assert.strictEqual(s.keySigs.length, 1); assert.strictEqual(s.keySigs[0].sf, 0); assert.strictEqual(s.keySigs[0].minor, true);
});

t('tempo map is honoured (100 -> 128 -> 84 BPM)', () => {
  const s = P('multitrack-tempo-changes-a-minor').sequences[0];
  const E = s.tempoMap.entries;
  assert.strictEqual(E.length, 3);
  assert.deepStrictEqual(E.map(e => Math.round(e.bpm)), [100, 128, 84]);
  // 16 beats at 100 BPM = 9.6 s ; then 16 beats at 128 BPM = 7.5 s
  assert.ok(Math.abs(s.tickToSec(16 * 480) - 9.6) < 1e-6);
  assert.ok(Math.abs(s.tickToSec(32 * 480) - (9.6 + 7.5)) < 1e-6);
  const back = s.secToTick(s.tickToSec(20000)); assert.ok(Math.abs(back - 20000) < 1e-6);
});

t('overlapping same-pitch notes are paired first-on/first-off', () => {
  const s = P('overlap-pedal-bend-unclosed').sequences[0];
  const c4 = s.notes.filter(n => n.pitch === 60);
  assert.strictEqual(c4.length, 2);
  assert.deepStrictEqual(c4.map(n => [n.startTick, n.endTick]), [[0, 480], [240, 720]]);
});

t('sustain pedal extends sounding end but not the written note', () => {
  const s = P('overlap-pedal-bend-unclosed').sequences[0];
  const n = s.notes.find(n => n.pitch === 64);
  assert.strictEqual(n.endTick, 1100); assert.strictEqual(n.soundEndTick, 1920);
});

t('unclosed note is closed at track end and reported', () => {
  const p = P('overlap-pedal-bend-unclosed'); const s = p.sequences[0];
  const n = s.notes.find(n => n.pitch === 72);
  assert.ok(n.unclosed); assert.ok(n.endTick >= n.startTick);
  assert.ok(p.warnings.some(w => /never received a note-off/.test(w)));
});

t('controllers and pitch bends captured', () => {
  const s = P('overlap-pedal-bend-unclosed').sequences[0];
  const tr = s.musicalTracks[0];
  assert.ok(tr.pitchBends.length >= 9); assert.strictEqual(tr.pitchBends[8].value, 8000);
  assert.ok(tr.ccCounts[1] >= 40); assert.ok(tr.ccCounts[64] === 2);
});

t('format 0 multi-channel track split into virtual tracks', () => {
  const p = P('format0-three-channels-waltz'); const s = p.sequences[0];
  assert.strictEqual(s.musicalTracks.length, 3); assert.ok(s.musicalTracks.every(t => t.virtual));
  assert.deepStrictEqual(s.musicalTracks.map(t => t.channels[0]), [0, 1, 3]);
  assert.strictEqual(s.timeSigs[0].num, 3);
  assert.ok(p.warnings.some(w => /split by MIDI channel/.test(w)));
  // 3/4: bar 2 begins at tick 1440
  assert.strictEqual(s.posOfTick(1440).measure, 2);
});

t('format 2: two independent sequences with their own tempo', () => {
  const p = P('format2-two-sequences');
  assert.strictEqual(p.format, 2); assert.strictEqual(p.sequences.length, 2);
  assert.strictEqual(Math.round(p.sequences[0].tempoMap.entries[0].bpm), 120);
  assert.strictEqual(Math.round(p.sequences[1].tempoMap.entries[0].bpm), 70);
  assert.strictEqual(p.sequences[0].notes.length, 3); assert.strictEqual(p.sequences[1].notes.length, 2);
});

t('missing metadata: defaults flagged implicit, no crash', () => {
  const p = P('no-metadata'); const s = p.sequences[0];
  assert.ok(s.tempoMap.entries[0].implicit); assert.ok(s.timeSigs[0].implicit);
  assert.strictEqual(s.notes.length, 5); assert.strictEqual(p.ppq, 96);
  assert.ok(Math.abs(s.notes[1].startSec - 0.5) < 1e-9);
});

t('large file parses all notes quickly', () => {
  const t0 = Date.now(); const p = P('large-24k-notes'); const dt = Date.now() - t0;
  assert.strictEqual(p.sequences[0].notes.length, 24000);
  assert.ok(dt < 3000, 'parse took ' + dt + ' ms');
  console.log('       (24,000 notes parsed in ' + dt + ' ms)');
});

t('original buffer is never mutated', () => {
  const copy = Uint8Array.from(F['multitrack-tempo-changes-a-minor']);
  const buf = copy.buffer.slice(0); const p = midi.parse(buf, 'x.mid');
  assert.deepStrictEqual(Array.from(new Uint8Array(p.original)), Array.from(copy));
  midi.transposeCopy(p, 3);
  assert.deepStrictEqual(Array.from(new Uint8Array(p.original)), Array.from(copy));
});

t('transposeCopy shifts every pitched note, skips drums, exact round-trip', () => {
  const p = P('multitrack-tempo-changes-a-minor');
  const r = midi.transposeCopy(p, 5);
  const q = midi.parse(r.bytes.buffer.slice(0), 'y.mid');
  const a = p.sequences[0].notes, b = q.sequences[0].notes;
  assert.strictEqual(a.length, b.length);
  const byPos = new Map(b.map(n => [n.byteOn, n]));
  for (const n of a) {
    const m = byPos.get(n.byteOn); assert.ok(m, 'note at same byte position exists');
    assert.strictEqual(m.pitch, n.channel === 9 ? n.pitch : n.pitch + 5);
    assert.strictEqual(m.startTick, n.startTick); assert.strictEqual(m.endTick, n.endTick);
  }
});

t('transposeCopy refuses to push notes out of range', () => {
  const p = P('multitrack-tempo-changes-a-minor');
  assert.throws(() => midi.transposeCopy(p, -36), /outside the MIDI range/);
});

t('running status file (fixture 1) has correct 4/4 position math', () => {
  const s = P('mono-melody-c-major').sequences[0];
  const pos = s.posOfTick(4 * 480 + 480); assert.deepStrictEqual([pos.measure, pos.beat], [2, 2]);
});

console.log('Malformed input');
t('truncated file: parsed with warnings, partial notes kept', () => {
  const p = P('bad-truncated');
  assert.ok(p.warnings.length > 0); assert.ok(p.sequences[0].notes.length > 0);
});
t('garbage bytes: friendly error', () => {
  assert.throws(() => P('bad-garbage'), e => e instanceof midi.MidiParseError && /MThd/.test(e.message));
});
t('missing End-of-Track: still parsed', () => {
  const p = P('bad-no-end-of-track'); assert.strictEqual(p.sequences[0].notes.length, 2);
});
t('header only: friendly error', () => {
  assert.throws(() => P('bad-header-only'), e => e instanceof midi.MidiParseError);
});
t('empty / tiny input: friendly error', () => {
  assert.throws(() => midi.parse(new ArrayBuffer(3)), e => e instanceof midi.MidiParseError);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
