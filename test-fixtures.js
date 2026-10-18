/* Frequency Oasis — MIDI DNA : test fixtures.
 * Builds small, original MIDI files in memory so the parser/analysis can be tested against known ground truth.
 * Run `node test-fixtures.js <outdir>` to write them as .mid files.
 */
'use strict';

function vlq(n) {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}
function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function u16(n) { return [(n >> 8) & 255, n & 255]; }
function text(s) { return [...Buffer.from(s, 'latin1')]; }

/** events: [{tick, bytes:[...]}] ; opts.running -> use running status where legal */
function trackChunk(events, opts = {}) {
  events = events.slice().sort((a, b) => a.tick - b.tick || (a.order || 0) - (b.order || 0));
  const body = [];
  let last = 0, runningStatus = -1;
  for (const e of events) {
    body.push(...vlq(e.tick - last)); last = e.tick;
    const b = e.bytes;
    if (opts.running && b[0] >= 0x80 && b[0] < 0xf0) {
      if (b[0] === runningStatus) body.push(...b.slice(1)); else { body.push(...b); runningStatus = b[0]; }
    } else { body.push(...b); runningStatus = (b[0] >= 0x80 && b[0] < 0xf0) ? b[0] : -1; }
  }
  if (!opts.noEnd) body.push(...vlq(0), 0xff, 0x2f, 0x00);
  return [...text('MTrk'), ...u32(body.length), ...body];
}
function header(format, ntrks, ppq) { return [...text('MThd'), ...u32(6), ...u16(format), ...u16(ntrks), ...u16(ppq)]; }

const on = (t, ch, p, v) => ({ tick: t, order: 2, bytes: [0x90 | ch, p, v] });
const off = (t, ch, p) => ({ tick: t, order: 1, bytes: [0x80 | ch, p, 0] });
const offZero = (t, ch, p) => ({ tick: t, order: 1, bytes: [0x90 | ch, p, 0] });
const prog = (t, ch, p) => ({ tick: t, order: 0, bytes: [0xc0 | ch, p] });
const cc = (t, ch, c, v) => ({ tick: t, order: 0, bytes: [0xb0 | ch, c, v] });
const bend = (t, ch, v) => ({ tick: t, order: 0, bytes: [0xe0 | ch, (v + 8192) & 127, ((v + 8192) >> 7) & 127] });
const tempo = (t, bpm) => { const us = Math.round(60e6 / bpm); return { tick: t, order: 0, bytes: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] }; };
const timesig = (t, n, d) => ({ tick: t, order: 0, bytes: [0xff, 0x58, 4, n, Math.log2(d), 24, 8] });
const keysig = (t, sf, minor) => ({ tick: t, order: 0, bytes: [0xff, 0x59, 2, sf & 255, minor ? 1 : 0] });
const name = (t, s) => ({ tick: t, order: 0, bytes: [0xff, 0x03, ...vlq(s.length), ...text(s)] });

function noteSeq(list, ch, ppq, vel = 90, legato = 0.9, useZero = false) {
  // list: [[pitch, beats], ...] with null pitch = rest
  const ev = []; let t = 0;
  for (const [p, b] of list) {
    const len = Math.round(b * ppq);
    if (p !== null) { ev.push(on(t, ch, p, vel)); ev.push((useZero ? offZero : off)(t + Math.round(len * legato), ch, p)); }
    t += len;
  }
  return { ev, end: t };
}
function chordBlock(t0, ch, pitches, beats, ppq, vel = 80) {
  const ev = [];
  for (const p of pitches) { ev.push(on(t0, ch, p, vel)); ev.push(off(t0 + Math.round(beats * ppq * 0.95), ch, p)); }
  return ev;
}
function file(format, tracks, ppq, opts) {
  const chunks = tracks.map((t, i) => trackChunk(t, Array.isArray(opts && opts.perTrack) ? opts.perTrack[i] : opts));
  return Uint8Array.from([...header(format, tracks.length, ppq), ...chunks.flat()]);
}

const F = {};
const PPQ = 480;

// 1 — simple monophonic melody, C major, 120 BPM, running status + vel-0 note-offs
{
  const mel = [[60,1],[62,1],[64,1],[65,1],[67,2],[64,1],[60,1],[62,1],[64,1],[67,1],[65,1],[64,1],[62,1],[60,3],[null,1],[67,0.5],[69,0.5],[71,1],[72,2]];
  const s = noteSeq(mel, 0, PPQ, 88, 0.85, true);
  F['mono-melody-c-major'] = file(0, [[tempo(0, 120), timesig(0, 4, 4), name(0, 'Lead'), prog(0, 0, 73), ...s.ev]], PPQ, { running: true });
}

// 2 — polyphonic chord progression C Am F G (x2), then C (resolution)
{
  const ev = [tempo(0, 90), timesig(0, 4, 4), name(0, 'Keys'), prog(0, 0, 0)];
  const prog4 = [[48,60,64,67],[45,57,60,64],[41,57,60,65],[43,59,62,67]];
  let t = 0;
  for (let rep = 0; rep < 2; rep++) for (const ch of prog4) { ev.push(...chordBlock(t, 0, ch, 4, PPQ)); t += 4 * PPQ; }
  ev.push(...chordBlock(t, 0, [48,60,64,67,72], 4, PPQ));
  F['chord-progression-c-am-f-g'] = file(1, [[tempo(0, 90), timesig(0, 4, 4)], ev.slice(2)], PPQ);
}

// 3 — multitrack arrangement with tempo changes: lead, bass, chords, drums
{
  const conductor = [tempo(0, 100), timesig(0, 4, 4), tempo(16 * PPQ, 128), tempo(32 * PPQ, 84), keysig(0, 0, true)];
  // A natural minor: Am - Dm - G - Am
  const chordsEv = [name(0, 'Pad'), prog(0, 0, 89)];
  const bassEv = [name(0, 'Bass'), prog(0, 1, 38)];
  const leadEv = [name(0, 'Lead'), prog(0, 2, 81)];
  const drumEv = [name(0, 'Drums')];
  const chordList = [[57,60,64],[62,65,69],[55,59,62],[57,60,64]];
  const bassRoots = [33,38,31,33];
  for (let bar = 0; bar < 12; bar++) {
    const t = bar * 4 * PPQ, c = chordList[bar % 4];
    chordsEv.push(...chordBlock(t, 0, c, 4, PPQ, 70));
    for (let b = 0; b < 4; b++) { bassEv.push(on(t + b * PPQ, 1, bassRoots[bar % 4], 100)); bassEv.push(off(t + b * PPQ + PPQ * 0.8, 1, bassRoots[bar % 4])); }
    const mel = [[81,1],[79,0.5],[76,0.5],[74,1],[76,1]];
    let tt = t; for (const [p, bt] of mel) { const L = bt * PPQ; leadEv.push(on(tt, 2, p - (bar % 4 === 1 ? 2 : 0), 96)); leadEv.push(off(tt + L * 0.9, 2, p - (bar % 4 === 1 ? 2 : 0))); tt += L; }
    for (let b = 0; b < 4; b++) {
      drumEv.push(on(t + b * PPQ, 9, 42, 70)); drumEv.push(off(t + b * PPQ + 60, 9, 42));
      drumEv.push(on(t + b * PPQ + PPQ / 2, 9, 42, 55)); drumEv.push(off(t + b * PPQ + PPQ / 2 + 60, 9, 42));
    }
    drumEv.push(on(t, 9, 36, 110), off(t + 100, 9, 36), on(t + 2 * PPQ, 9, 36, 105), off(t + 2 * PPQ + 100, 9, 36));
    drumEv.push(on(t + PPQ, 9, 38, 100), off(t + PPQ + 100, 9, 38), on(t + 3 * PPQ, 9, 38, 100), off(t + 3 * PPQ + 100, 9, 38));
  }
  F['multitrack-tempo-changes-a-minor'] = file(1, [conductor, chordsEv, bassEv, leadEv, drumEv], PPQ);
}

// 3b — D Dorian: Dm7 <-> G vamp, melody emphasising D with the natural 6th (B)
{
  const ev = [tempo(0, 96), timesig(0, 4, 4), name(0, 'Dorian Vamp'), prog(0, 0, 4)];
  const melody = [[74,1],[76,1],[77,1],[79,1],[81,1],[83,1],[84,1],[81,1], [79,1],[77,1],[76,1],[74,2],[null,1], [74,1],[77,1],[81,1],[83,1],[81,1],[79,1],[77,1],[74,1]];
  let t = 0; for (const [p, b] of melody) { const L = b * PPQ; if (p !== null) { ev.push(on(t, 0, p, 92), off(t + L * 0.9, 0, p)); } t += L; }
  const bassEv = [name(0, 'Bass'), prog(0, 1, 33)];
  const total = t;
  for (let bar = 0; bar * 4 * PPQ < total; bar++) {
    const b0 = bar * 4 * PPQ, isDm = bar % 4 !== 3;
    const chord = isDm ? [50, 53, 57, 60] : [43, 47, 50, 55];
    ev.push(...chordBlock(b0, 2, chord, 4, PPQ, 60));
    bassEv.push(on(b0, 1, isDm ? 38 : 31, 100), off(b0 + 4 * PPQ - 20, 1, isDm ? 38 : 31));
  }
  // end on Dm
  ev.push(...chordBlock(Math.ceil(total / (4 * PPQ)) * 4 * PPQ, 2, [50, 53, 57], 4, PPQ, 60));
  F['modal-d-dorian'] = file(1, [[tempo(0, 96), timesig(0, 4, 4)], ev.slice(2), bassEv], PPQ);
}

// 4 — chromatic / twelve-tone row (should NOT be forced into a confident key)
{
  const row = [3,10,8,5,0,7,6,1,11,2,4,9].map(x => 60 + x);
  const ev = [tempo(0, 110), name(0, 'Row')];
  let t = 0;
  for (let rep = 0; rep < 6; rep++) for (const p of row) { const q = p + ((rep % 3) - 1) * 12; ev.push(on(t, 0, q, 60 + ((t / 240) % 5) * 10)); ev.push(off(t + 200, 0, q)); t += 240; }
  F['chromatic-twelve-tone-row'] = file(0, [ev], PPQ);
}

// 5 — overlapping notes (same pitch retrigger), vel-0 offs, sustain pedal, pitch bend, many controllers
{
  const ev = [tempo(0, 120), name(0, 'Expressive'), prog(0, 0, 4),
    cc(0, 0, 7, 100), cc(0, 0, 11, 110), cc(0, 0, 10, 40)];
  // overlapping same-pitch notes: two note-ons then two note-offs
  ev.push(on(0, 0, 60, 80), on(240, 0, 60, 90), off(480, 0, 60), off(720, 0, 60));
  // pedal held over a short note
  ev.push(cc(960, 0, 64, 127), on(960, 0, 64, 70), off(1100, 0, 64), cc(1920, 0, 64, 0));
  // pitch bend sweep
  ev.push(on(2000, 0, 67, 100));
  for (let i = 0; i <= 8; i++) ev.push(bend(2000 + i * 60, 0, i * 1000));
  ev.push(off(2600, 0, 67));
  for (let i = 0; i < 40; i++) ev.push(cc(2000 + i * 20, 0, 1, Math.min(127, i * 3)));
  // legit unclosed note at the end (no off)
  ev.push(on(3000, 0, 72, 80));
  F['overlap-pedal-bend-unclosed'] = file(1, [[tempo(0, 120)], ev.slice(1)], PPQ, { perTrack: [{}, { noEnd: false }] });
}

// 6 — format 0, three channels
{
  const ev = [tempo(0, 140), timesig(0, 3, 4), prog(0, 0, 0), prog(0, 1, 32), prog(0, 3, 56)];
  for (let bar = 0; bar < 8; bar++) {
    const t = bar * 3 * PPQ;
    ev.push(on(t, 1, 36 + (bar % 2 ? 7 : 0), 100), off(t + PPQ, 1, 36 + (bar % 2 ? 7 : 0)));
    for (const p of [60, 64, 67]) { ev.push(on(t, 0, p, 70), off(t + 3 * PPQ - 10, 0, p)); }
    ev.push(on(t + PPQ, 3, 72 + (bar % 3), 90), off(t + 2 * PPQ, 3, 72 + (bar % 3)));
  }
  F['format0-three-channels-waltz'] = file(0, [ev], PPQ);
}

// 7 — format 2 (two independent sequences)
{
  const a = [tempo(0, 120), ...noteSeq([[60,1],[62,1],[64,2]], 0, PPQ).ev];
  const b = [tempo(0, 70), ...noteSeq([[48,2],[55,2]], 0, PPQ).ev];
  F['format2-two-sequences'] = file(2, [a, b], PPQ);
}

// 8 — metadata-free file (no tempo, no names, no time signature, no programs)
{
  F['no-metadata'] = file(0, [noteSeq([[57,1],[60,1],[64,1],[60,1],[57,2]], 0, 96, 80).ev], 96);
}

// 9 — large file (~24k notes, 8 tracks)
{
  const tracks = [[tempo(0, 132), timesig(0, 4, 4)]];
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const scale = [0,2,3,5,7,8,10];
  for (let tr = 0; tr < 8; tr++) {
    const ev = [name(0, 'T' + tr)]; let t = 0;
    for (let i = 0; i < 3000; i++) {
      const deg = Math.floor(rnd() * 7), oct = 3 + (tr % 4) + (rnd() < 0.2 ? 1 : 0);
      const p = Math.min(120, 12 * oct + 9 + scale[deg]);
      const len = [120, 240, 240, 480][Math.floor(rnd() * 4)];
      ev.push(on(t, tr % 9, p, 50 + Math.floor(rnd() * 70)), off(t + len, tr % 9, p));
      t += [120, 240, 240, 480][Math.floor(rnd() * 4)];
    }
    tracks.push(ev);
  }
  F['large-24k-notes'] = file(1, tracks, PPQ);
}

// 10 — malformed variants
{
  const good = F['mono-melody-c-major'];
  F['bad-truncated'] = good.slice(0, Math.floor(good.length * 0.6));
  F['bad-garbage'] = Uint8Array.from(Array.from({ length: 200 }, (_, i) => (i * 37 + 11) & 255));
  F['bad-no-end-of-track'] = file(0, [noteSeq([[60,1],[64,1]], 0, PPQ).ev], PPQ, { noEnd: true });
  const empty = Uint8Array.from([...header(1, 0, 480)]);
  F['bad-header-only'] = Uint8Array.from([...empty, 0,0,0,0,0,0]);
}

module.exports = { F, PPQ, helpers: { on, off, tempo, timesig, file, noteSeq, chordBlock, trackChunk, header, name, keysig, cc, bend, prog } };

if (require.main === module) {
  const fs = require('fs'), path = require('path');
  const out = process.argv[2];
  if (!out) { console.log('usage: node test-fixtures.js <outdir>'); process.exit(1); }
  fs.mkdirSync(out, { recursive: true });
  for (const [k, v] of Object.entries(F)) fs.writeFileSync(path.join(out, k + '.mid'), v);
  console.log('wrote', Object.keys(F).length, 'files to', out);
}
