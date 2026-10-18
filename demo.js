/* Frequency Oasis — MIDI DNA
 * demo.js : builds a small original multitrack demo piece as real MIDI bytes in the browser (nothing is downloaded).
 * "Oasis in D Dorian" — Dm7 / Gadd9 / Dm7 / Cmaj7 vamp (i – IV – i – bVII), ending on Dm7 with a bass line, arpeggio, lead melody and drums.
 */
(function () {
  'use strict';
  const FO = (globalThis.FO = globalThis.FO || {});

  function vlq(n) { const o = [n & 127]; while ((n >>= 7)) o.unshift((n & 127) | 128); return o; }
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const u16 = (n) => [(n >> 8) & 255, n & 255];
  const txt = (s) => Array.from(s).map(c => c.charCodeAt(0) & 127);
  function track(evs) {
    evs.sort((a, b) => a.t - b.t || (a.o || 0) - (b.o || 0));
    const body = []; let last = 0;
    for (const e of evs) { body.push(...vlq(e.t - last), ...e.b); last = e.t; }
    body.push(0, 0xff, 0x2f, 0);
    return [...txt('MTrk'), ...u32(body.length), ...body];
  }
  const on = (t, c, p, v) => ({ t, o: 2, b: [0x90 | c, p, v] });
  const off = (t, c, p) => ({ t, o: 1, b: [0x80 | c, p, 0] });
  const meta = (t, type, data) => ({ t, o: 0, b: [0xff, type, ...vlq(data.length), ...data] });

  function build() {
    const PPQ = 480, BEAT = PPQ, BAR = 4 * PPQ, BARS = 16;
    const us = Math.round(60e6 / 104);
    const cond = [meta(0, 0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]), meta(0, 0x58, [4, 2, 24, 8]), meta(0, 0x59, [0xff, 0]), meta(0, 0x03, txt('Oasis in D Dorian'))];
    const keys = [meta(0, 0x03, txt('Keys')), { t: 0, o: 0, b: [0xc0, 4] }];
    const arp = [meta(0, 0x03, txt('Arp')), { t: 0, o: 0, b: [0xc1, 11] }];
    const bass = [meta(0, 0x03, txt('Bass')), { t: 0, o: 0, b: [0xc2, 38] }];
    const lead = [meta(0, 0x03, txt('Lead')), { t: 0, o: 0, b: [0xc3, 80] }];
    const drums = [meta(0, 0x03, txt('Drums'))];
    const prog = [[50, 53, 57, 60], [43, 50, 55, 59], [50, 53, 57, 60], [48, 52, 55, 59]]; // Dm7  Gadd9  Dm7  Cmaj7  (i – IV – i – bVII)
    const roots = [38, 31, 38, 36];
    const arpPat = [[0, 1, 2, 3, 2, 1, 2, 3], [0, 2, 1, 3, 1, 2, 3, 2]];
    const melodies = [
      [[74, 1.5], [77, 0.5], [76, 1], [74, 1], [72, 1.5], [74, 0.5], [76, 2]],
      [[79, 1], [77, 1], [76, 1.5], [74, 0.5], [72, 4]],
      [[76, 1], [79, 1], [81, 1.5], [79, 0.5], [76, 4]],
      [[77, 1.5], [76, 0.5], [74, 1], [72, 1], [74, 4]]
    ];
    for (let bar = 0; bar < BARS; bar++) {
      const t = bar * BAR, k = bar === BARS - 1 ? 0 : bar % 4, ch = prog[k], vary = bar >= 8;
      for (const p of ch) { keys.push(on(t, 0, p, 62 + (vary ? 8 : 0)), off(t + BAR - 30, 0, p)); }
      if (bar >= 4) { const pat = arpPat[bar % 2]; for (let i = 0; i < 8; i++) { const p = ch[pat[i] % 4] + 12, tt = t + i * BEAT / 2; arp.push(on(tt, 1, p, 58 + (i % 4 === 0 ? 14 : 0)), off(tt + BEAT / 2 - 40, 1, p)); } }
      const r = roots[k];
      for (const [beat, len, d] of [[0, 1.5, 0], [2, 0.5, 0], [2.5, 1, 7], [3.5, 0.5, 12]]) { const p = r + (d === 12 ? 12 : d === 7 ? 7 : 0); bass.push(on(t + beat * BEAT, 2, p, 96 - (d ? 8 : 0)), off(t + (beat + len) * BEAT - 25, 2, p)); }
      if (bar >= 8 || bar % 2 === 1) { let tt = t; for (const [p, bt] of melodies[k]) { lead.push(on(tt, 3, p, 88 + (bt >= 2 ? 6 : 0)), off(tt + bt * BEAT * 0.92, 3, p)); tt += bt * BEAT; } }
      if (bar >= 2) {
        for (let i = 0; i < 8; i++) { const tt = t + i * BEAT / 2; drums.push(on(tt, 9, i % 2 ? 42 : 42, i % 2 ? 52 : 78), off(tt + 50, 9, 42)); }
        drums.push(on(t, 9, 36, 112), off(t + 90, 9, 36), on(t + 2 * BEAT, 9, 36, 104), off(t + 2 * BEAT + 90, 9, 36), on(t + 2.5 * BEAT, 9, 36, 80), off(t + 2.5 * BEAT + 90, 9, 36));
        drums.push(on(t + BEAT, 9, 38, 100), off(t + BEAT + 90, 9, 38), on(t + 3 * BEAT, 9, 38, 104), off(t + 3 * BEAT + 90, 9, 38));
        if (bar % 4 === 3) { drums.push(on(t + 3.5 * BEAT, 9, 38, 70), off(t + 3.5 * BEAT + 60, 9, 38), on(t + 3.75 * BEAT, 9, 38, 92), off(t + 3.75 * BEAT + 60, 9, 38)); }
        if (bar % 4 === 0 && bar >= 8) drums.push(on(t, 9, 49, 100), off(t + 400, 9, 49));
      }
    }
    const tracks = [cond, keys, arp, bass, lead, drums].map(track);
    return Uint8Array.from([...txt('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ), ...tracks.flat()]);
  }
  FO.demo = { build, fileName: 'Oasis-in-D-Dorian (demo).mid' };
})();
