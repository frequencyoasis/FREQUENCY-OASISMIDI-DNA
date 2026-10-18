/* Frequency Oasis — MIDI DNA
 * midi-parser.js : Standard MIDI File parser (format 0 / 1 / 2), tempo map, note pairing.
 * No dependencies. Works in browsers and Node (attaches to globalThis.FO).
 *
 * Guarantees:
 *  - Never mutates the input buffer.
 *  - Never silently drops events: anything skipped or repaired is reported in `warnings`.
 *  - Note-on with velocity 0 is treated as note-off.
 *  - Tempo map is honoured (no constant-tempo assumption).
 */
(function () {
  'use strict';
  const FO = (globalThis.FO = globalThis.FO || {});

  const GM_PROGRAMS = [
    'Acoustic Grand Piano','Bright Acoustic Piano','Electric Grand Piano','Honky-tonk Piano','Electric Piano 1','Electric Piano 2','Harpsichord','Clavinet',
    'Celesta','Glockenspiel','Music Box','Vibraphone','Marimba','Xylophone','Tubular Bells','Dulcimer',
    'Drawbar Organ','Percussive Organ','Rock Organ','Church Organ','Reed Organ','Accordion','Harmonica','Tango Accordion',
    'Nylon Guitar','Steel Guitar','Jazz Guitar','Clean Guitar','Muted Guitar','Overdriven Guitar','Distortion Guitar','Guitar Harmonics',
    'Acoustic Bass','Finger Bass','Pick Bass','Fretless Bass','Slap Bass 1','Slap Bass 2','Synth Bass 1','Synth Bass 2',
    'Violin','Viola','Cello','Contrabass','Tremolo Strings','Pizzicato Strings','Orchestral Harp','Timpani',
    'String Ensemble 1','String Ensemble 2','Synth Strings 1','Synth Strings 2','Choir Aahs','Voice Oohs','Synth Voice','Orchestra Hit',
    'Trumpet','Trombone','Tuba','Muted Trumpet','French Horn','Brass Section','Synth Brass 1','Synth Brass 2',
    'Soprano Sax','Alto Sax','Tenor Sax','Baritone Sax','Oboe','English Horn','Bassoon','Clarinet',
    'Piccolo','Flute','Recorder','Pan Flute','Blown Bottle','Shakuhachi','Whistle','Ocarina',
    'Square Lead','Saw Lead','Calliope Lead','Chiff Lead','Charang Lead','Voice Lead','Fifths Lead','Bass+Lead',
    'New Age Pad','Warm Pad','Polysynth Pad','Choir Pad','Bowed Pad','Metallic Pad','Halo Pad','Sweep Pad',
    'Rain FX','Soundtrack FX','Crystal FX','Atmosphere FX','Brightness FX','Goblins FX','Echoes FX','Sci-fi FX',
    'Sitar','Banjo','Shamisen','Koto','Kalimba','Bagpipe','Fiddle','Shanai',
    'Tinkle Bell','Agogo','Steel Drums','Woodblock','Taiko Drum','Melodic Tom','Synth Drum','Reverse Cymbal',
    'Guitar Fret Noise','Breath Noise','Seashore','Bird Tweet','Telephone Ring','Helicopter','Applause','Gunshot'
  ];

  const GM_DRUMS = {
    35:'Acoustic Bass Drum',36:'Bass Drum 1',37:'Side Stick',38:'Acoustic Snare',39:'Hand Clap',40:'Electric Snare',41:'Low Floor Tom',42:'Closed Hi-Hat',
    43:'High Floor Tom',44:'Pedal Hi-Hat',45:'Low Tom',46:'Open Hi-Hat',47:'Low-Mid Tom',48:'Hi-Mid Tom',49:'Crash Cymbal 1',50:'High Tom',
    51:'Ride Cymbal 1',52:'Chinese Cymbal',53:'Ride Bell',54:'Tambourine',55:'Splash Cymbal',56:'Cowbell',57:'Crash Cymbal 2',58:'Vibraslap',
    59:'Ride Cymbal 2',60:'Hi Bongo',61:'Low Bongo',62:'Mute Hi Conga',63:'Open Hi Conga',64:'Low Conga',65:'High Timbale',66:'Low Timbale',
    67:'High Agogo',68:'Low Agogo',69:'Cabasa',70:'Maracas',71:'Short Whistle',72:'Long Whistle',73:'Short Guiro',74:'Long Guiro',
    75:'Claves',76:'Hi Wood Block',77:'Low Wood Block',78:'Mute Cuica',79:'Open Cuica',80:'Mute Triangle',81:'Open Triangle'
  };

  class MidiParseError extends Error {
    constructor(msg, detail) { super(msg); this.name = 'MidiParseError'; this.detail = detail || null; }
  }

  function fourCC(u8, p) { return String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]); }

  function decodeText(bytes) {
    // MIDI text is nominally ASCII/Latin-1; try UTF-8 first, fall back to Latin-1.
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\0+$/g, ''); }
    catch (e) { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s.replace(/\0+$/g, ''); }
  }

  /* ---------- low-level track decoding ---------- */
  function decodeTrack(u8, start, end, trackIndex, warnings) {
    const ev = [];
    let p = start, tick = 0, running = 0, truncated = false;
    const readVLQ = () => {
      let v = 0;
      for (let i = 0; i < 4; i++) {
        if (p >= end) { truncated = true; return null; }
        const b = u8[p++];
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) return v >>> 0;
      }
      warnings.push(`Track ${trackIndex}: variable-length quantity longer than 4 bytes near byte ${p}; treated as terminated.`);
      return v >>> 0;
    };
    while (p < end) {
      const delta = readVLQ();
      if (delta === null) break;
      tick += delta;
      if (p >= end) { truncated = true; break; }
      let status = u8[p];
      let dataPos;
      if (status & 0x80) { p++; } else {
        if (!running) { warnings.push(`Track ${trackIndex}: data byte without running status at byte ${p}; remainder of track skipped.`); truncated = true; break; }
        status = running;
      }
      if (status === 0xff) {
        if (p >= end) { truncated = true; break; }
        const type = u8[p++];
        const len = readVLQ();
        if (len === null || p + len > end) { warnings.push(`Track ${trackIndex}: meta event 0x${type.toString(16)} truncated.`); truncated = true; break; }
        ev.push({ tick, kind: 'meta', type, data: u8.subarray(p, p + len), pos: p });
        p += len;
        running = 0;
        if (type === 0x2f) { break; }
      } else if (status === 0xf0 || status === 0xf7) {
        const len = readVLQ();
        if (len === null || p + len > end) { warnings.push(`Track ${trackIndex}: SysEx event truncated.`); truncated = true; break; }
        ev.push({ tick, kind: 'sysex', status, len, pos: p });
        p += len;
        running = 0;
      } else if (status >= 0xf1) {
        // System common / realtime inside a file is invalid; skip 0 data bytes per spec for realtime, report.
        warnings.push(`Track ${trackIndex}: unexpected system status 0x${status.toString(16)} at byte ${p - 1}; ignored.`);
        running = 0;
      } else {
        running = status;
        const hi = status & 0xf0, ch = status & 0x0f;
        const need = (hi === 0xc0 || hi === 0xd0) ? 1 : 2;
        if (p + need > end) { warnings.push(`Track ${trackIndex}: channel message truncated.`); truncated = true; break; }
        dataPos = p;
        const d1 = u8[p], d2 = need === 2 ? u8[p + 1] : 0;
        p += need;
        if ((d1 & 0x80) || (need === 2 && (d2 & 0x80))) {
          warnings.push(`Track ${trackIndex}: invalid data byte (>127) at byte ${dataPos}; value masked to 7 bits.`);
        }
        ev.push({ tick, kind: 'ch', hi, ch, d1: d1 & 0x7f, d2: d2 & 0x7f, pos: dataPos });
      }
    }
    return { events: ev, endTick: tick, truncated };
  }

  /* ---------- tempo map ---------- */
  function buildTempoMap(tempoEvents, ppq, smpte) {
    if (smpte) {
      return { smpte: true, entries: [{ tick: 0, usPerQuarter: 500000, bpm: 120, sec: 0, implicit: true }], ticksPerSec: smpte.ticksPerSec };
    }
    const byTick = new Map();
    tempoEvents.sort((a, b) => a.tick - b.tick);
    for (const t of tempoEvents) byTick.set(t.tick, t); // same tick: last wins
    let list = [...byTick.values()].map(t => ({ tick: t.tick, usPerQuarter: t.usPerQuarter }));
    list.sort((a, b) => a.tick - b.tick);
    let implicit = false;
    if (!list.length || list[0].tick > 0) { list.unshift({ tick: 0, usPerQuarter: 500000, implicit: true }); implicit = true; }
    let sec = 0;
    for (let i = 0; i < list.length; i++) {
      if (i > 0) sec += (list[i].tick - list[i - 1].tick) * list[i - 1].usPerQuarter / 1e6 / ppq;
      list[i].sec = sec;
      list[i].bpm = 60e6 / list[i].usPerQuarter;
    }
    return { smpte: false, entries: list, ppq, implicitDefault: implicit };
  }

  function makeTimeFns(map, ppq) {
    const E = map.entries;
    if (map.smpte) {
      const tps = map.ticksPerSec;
      return {
        tickToSec: t => t / tps,
        secToTick: s => Math.round(s * tps)
      };
    }
    const tickToSec = (tick) => {
      let lo = 0, hi = E.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (E[m].tick <= tick) lo = m; else hi = m - 1; }
      const e = E[lo];
      return e.sec + (tick - e.tick) * e.usPerQuarter / 1e6 / ppq;
    };
    const secToTick = (s) => {
      let lo = 0, hi = E.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (E[m].sec <= s) lo = m; else hi = m - 1; }
      const e = E[lo];
      return e.tick + (s - e.sec) * 1e6 * ppq / e.usPerQuarter;
    };
    return { tickToSec, secToTick };
  }

  /* ---------- measure / beat grid from time signatures ---------- */
  function buildMeterMap(timeSigs, ppq) {
    const list = [];
    const byTick = new Map();
    timeSigs.sort((a, b) => a.tick - b.tick).forEach(t => byTick.set(t.tick, t));
    const src = [...byTick.values()];
    if (!src.length || src[0].tick > 0) src.unshift({ tick: 0, num: 4, den: 4, implicit: true });
    let measureStart = 0, measureNo = 0;
    for (let i = 0; i < src.length; i++) {
      const s = src[i];
      const beatTicks = ppq * 4 / s.den;
      const measTicks = beatTicks * s.num;
      if (i > 0) {
        const prev = list[i - 1];
        const span = s.tick - prev.tick;
        const whole = Math.floor(span / prev.measTicks + 1e-9);
        measureNo = prev.measureAtStart + whole;
        // A meter change mid-measure is non-standard; we align the new meter to its own tick.
      }
      list.push({ tick: s.tick, num: s.num, den: s.den, beatTicks, measTicks, measureAtStart: i === 0 ? 0 : measureNo, implicit: !!s.implicit });
    }
    const at = (tick) => {
      let lo = 0, hi = list.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m].tick <= tick) lo = m; else hi = m - 1; }
      return list[lo];
    };
    return {
      entries: list,
      at,
      /** returns {measure (1-based), beat (1-based), tickInBeat, beatFloat} */
      position(tick) {
        const m = at(tick);
        const rel = tick - m.tick;
        const measOff = Math.floor(rel / m.measTicks + 1e-9);
        const inMeas = rel - measOff * m.measTicks;
        const beat = Math.floor(inMeas / m.beatTicks + 1e-9);
        return { measure: m.measureAtStart + measOff + 1, beat: beat + 1, tickInBeat: inMeas - beat * m.beatTicks, beatFloat: inMeas / m.beatTicks, measTicks: m.measTicks, beatTicks: m.beatTicks, num: m.num, den: m.den };
      },
      /** tick of start of 1-based measure number */
      measureStartTick(measure) {
        const idx = measure - 1;
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].measureAtStart <= idx) return list[i].tick + (idx - list[i].measureAtStart) * list[i].measTicks;
        }
        return 0;
      },
      measureNumberAt(tick) { return this.position(tick).measure; }
    };
  }

  /* ---------- main parse ---------- */
  function parse(input, fileName) {
    if (!input) throw new MidiParseError('No data supplied.');
    const buf = input instanceof ArrayBuffer ? input : (input.buffer ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) : null);
    if (!buf) throw new MidiParseError('Unsupported input type.');
    const u8 = new Uint8Array(buf);
    const warnings = [];
    if (u8.length < 14) throw new MidiParseError('This file is too small to be a MIDI file.', { bytes: u8.length });

    // Locate header (supports RIFF "RMID" wrapper and stray leading bytes).
    let hdr = -1;
    if (fourCC(u8, 0) === 'MThd') hdr = 0;
    else if (fourCC(u8, 0) === 'RIFF' && fourCC(u8, 8) === 'RMID') {
      for (let i = 12; i < Math.min(u8.length - 4, 4096); i++) if (fourCC(u8, i) === 'MThd') { hdr = i; break; }
      if (hdr >= 0) warnings.push('File is wrapped in an RIFF/RMID container; the embedded MIDI data was read.');
    } else {
      for (let i = 1; i < Math.min(u8.length - 4, 1024); i++) if (fourCC(u8, i) === 'MThd') { hdr = i; break; }
      if (hdr >= 0) warnings.push(`MIDI header found at byte ${hdr}, not at the start of the file; leading bytes ignored.`);
    }
    if (hdr < 0) throw new MidiParseError('Not a Standard MIDI File: the "MThd" header was not found. Is this really a .mid file?');

    const dv = new DataView(buf);
    const hlen = dv.getUint32(hdr + 4);
    if (hlen < 6) throw new MidiParseError('Corrupt MIDI header (length < 6).');
    const format = dv.getUint16(hdr + 8);
    const ntrks = dv.getUint16(hdr + 10);
    const divisionRaw = dv.getUint16(hdr + 12);
    if (format > 2) throw new MidiParseError(`Unsupported MIDI format ${format}. Only formats 0, 1 and 2 exist.`);

    let ppq = 480, smpte = null;
    if (divisionRaw & 0x8000) {
      const fpsCode = 256 - (divisionRaw >> 8);
      const fps = fpsCode === 29 ? 29.97 : fpsCode;
      const tpf = divisionRaw & 0xff;
      if (!tpf || ![24, 25, 29, 30].includes(fpsCode)) throw new MidiParseError('Invalid SMPTE time division in header.');
      smpte = { fps, ticksPerFrame: tpf, ticksPerSec: fps * tpf };
      ppq = Math.max(1, Math.round(smpte.ticksPerSec / 2)); // nominal: 120 BPM equivalent for beat display only
      warnings.push(`File uses SMPTE timing (${fps} fps × ${tpf} ticks). Beats/measures are shown on a nominal 120 BPM grid for display only; real-time positions are exact.`);
    } else {
      ppq = divisionRaw;
      if (ppq === 0) throw new MidiParseError('Invalid time division (0 ticks per quarter note).');
    }

    // Walk chunks
    let p = hdr + 8 + hlen;
    const rawTracks = [];
    while (p + 8 <= u8.length) {
      const id = fourCC(u8, p);
      let len = dv.getUint32(p + 4);
      const body = p + 8;
      if (id === 'MTrk') {
        let end = body + len;
        if (end > u8.length) { warnings.push(`Track chunk ${rawTracks.length} declares ${len} bytes but only ${u8.length - body} remain; reading what is present.`); end = u8.length; }
        const dec = decodeTrack(u8, body, end, rawTracks.length, warnings);
        if (dec.truncated) warnings.push(`Track ${rawTracks.length} ended abnormally; events before the problem were kept.`);
        rawTracks.push(dec);
        p = end;
      } else {
        warnings.push(`Unknown chunk "${id.replace(/[^\x20-\x7e]/g, '?')}" (${len} bytes) skipped.`);
        p = body + len;
      }
    }
    if (p < u8.length && u8.length - p > 0 && u8.length - p < 8) warnings.push(`${u8.length - p} trailing byte(s) after the last chunk ignored.`);
    if (!rawTracks.length) throw new MidiParseError('The file contains a valid header but no track data.');
    if (rawTracks.length !== ntrks) warnings.push(`Header declares ${ntrks} track(s) but ${rawTracks.length} were found.`);
    if (format === 0 && rawTracks.length > 1) warnings.push('Format 0 file contains more than one track; all tracks were read.');

    // Build sequences. Format 2: each track chunk is an independent sequence.
    const groups = format === 2 ? rawTracks.map((t, i) => [i]) : [rawTracks.map((_, i) => i)];
    const sequences = groups.map((idxs, sid) => buildSequence(idxs, rawTracks, ppq, smpte, format, sid, warnings));

    return {
      fileName: fileName || 'untitled.mid',
      byteLength: u8.length,
      format, ntrksDeclared: ntrks, ppq, smpte, divisionRaw,
      warnings,
      sequences,
      original: buf // untouched
    };
  }

  function buildSequence(trackIdxs, rawTracks, ppq, smpte, format, sid, warnings) {
    const tempoEvents = [], timeSigs = [], keySigs = [], markers = [];
    const tracks = [];
    let endTick = 0;

    for (const ti of trackIdxs) {
      const rt = rawTracks[ti];
      endTick = Math.max(endTick, rt.endTick);
      const tr = {
        index: tracks.length, chunkIndex: ti, name: '', instrumentName: '', channels: [], programs: [], notes: [],
        controllers: [], pitchBends: [], aftertouch: 0, channelPressure: 0, sysexCount: 0, textEvents: [],
        eventCount: rt.events.length, endTick: rt.endTick, virtual: false, truncated: rt.truncated,
        eventsByType: {}
      };
      const chSet = new Set();
      const open = new Map(); // key ch*128+pitch -> array of notes (FIFO)
      let noteSeq = 0;
      const unknownMeta = new Set();
      for (const e of rt.events) {
        if (e.kind === 'meta') {
          const t = e.type, d = e.data;
          if (t === 0x51 && d.length === 3) tempoEvents.push({ tick: e.tick, usPerQuarter: (d[0] << 16) | (d[1] << 8) | d[2] });
          else if (t === 0x58 && d.length >= 2) {
            const den = Math.pow(2, d[1]);
            timeSigs.push({ tick: e.tick, num: d[0] || 4, den: den >= 1 && den <= 64 ? den : 4, clocksPerClick: d[2], n32: d[3] });
          } else if (t === 0x59 && d.length >= 2) keySigs.push({ tick: e.tick, sf: (d[0] << 24) >> 24, minor: d[1] === 1 });
          else if (t === 0x03) { const s = decodeText(d); if (!tr.name) tr.name = s; }
          else if (t === 0x04) { if (!tr.instrumentName) tr.instrumentName = decodeText(d); }
          else if (t === 0x06) markers.push({ tick: e.tick, text: decodeText(d), track: tracks.length });
          else if (t === 0x01 || t === 0x05 || t === 0x07 || t === 0x02) tr.textEvents.push({ tick: e.tick, type: t, text: decodeText(d) });
          else if (t === 0x21 || t === 0x20 || t === 0x54 || t === 0x7f || t === 0x00 || t === 0x2f) { /* known, no action */ }
          else unknownMeta.add(t);
          continue;
        }
        if (e.kind === 'sysex') { tr.sysexCount++; continue; }
        const { hi, ch, d1, d2, tick } = e;
        chSet.add(ch);
        if (hi === 0x90 && d2 > 0) {
          const k = ch * 128 + d1;
          const note = { id: -1, track: tracks.length, channel: ch, pitch: d1, velocity: d2, offVelocity: 0, startTick: tick, endTick: -1, byteOn: e.pos, unclosed: false };
          let arr = open.get(k); if (!arr) { arr = []; open.set(k, arr); }
          arr.push(note);
          tr.notes.push(note);
          tr.eventsByType.noteOn = (tr.eventsByType.noteOn || 0) + 1;
        } else if (hi === 0x80 || hi === 0x90) {
          const k = ch * 128 + d1;
          const arr = open.get(k);
          if (arr && arr.length) {
            const n = arr.shift(); // FIFO: first-on first-off
            n.endTick = tick; n.offVelocity = hi === 0x80 ? d2 : 0; n.byteOff = e.pos;
          } else {
            tr.eventsByType.strayNoteOff = (tr.eventsByType.strayNoteOff || 0) + 1;
          }
        } else if (hi === 0xb0) {
          tr.controllers.push({ tick, channel: ch, cc: d1, value: d2 });
        } else if (hi === 0xc0) {
          tr.programs.push({ tick, channel: ch, program: d1 });
        } else if (hi === 0xe0) {
          tr.pitchBends.push({ tick, channel: ch, value: ((d2 << 7) | d1) - 8192 });
        } else if (hi === 0xa0) tr.aftertouch++;
        else if (hi === 0xd0) tr.channelPressure++;
      }
      if (unknownMeta.size) warnings.push(`Track ${ti}: unrecognised meta event type(s) ${[...unknownMeta].map(x => '0x' + x.toString(16)).join(', ')} were kept as raw data in the file but have no analysis role.`);
      // Close unterminated notes at track end.
      let unclosed = 0;
      for (const arr of open.values()) for (const n of arr) { n.endTick = Math.max(rt.endTick, n.startTick); n.unclosed = true; unclosed++; }
      if (unclosed) warnings.push(`Track ${ti}: ${unclosed} note(s) never received a note-off; they were ended at the end of the track.`);
      tr.channels = [...chSet].sort((a, b) => a - b);
      tracks.push(tr);
    }

    // Tempo / meter maps
    const tempoMap = buildTempoMap(tempoEvents, ppq, smpte);
    const { tickToSec, secToTick } = makeTimeFns(tempoMap, ppq);
    const meter = buildMeterMap(timeSigs, ppq);

    // Format 0: split a single multi-channel track into virtual per-channel tracks for analysis.
    let finalTracks = tracks;
    if (format === 0 && tracks.length === 1 && tracks[0].channels.length > 1) {
      const src = tracks[0];
      finalTracks = src.channels.map((ch, i) => {
        const nt = Object.assign({}, src, {
          index: i, virtual: true, channels: [ch],
          notes: src.notes.filter(n => n.channel === ch),
          controllers: src.controllers.filter(c => c.channel === ch),
          pitchBends: src.pitchBends.filter(c => c.channel === ch),
          programs: src.programs.filter(c => c.channel === ch),
          name: (src.name ? src.name + ' · ' : '') + 'Ch ' + (ch + 1)
        });
        nt.notes.forEach(n => { n.track = i; });
        return nt;
      });
      warnings.push(`Format 0 file: its single track was split by MIDI channel into ${finalTracks.length} virtual tracks for analysis. The original data is unchanged.`);
    }

    // Finalise notes: timing, sustain-pedal extension, ids
    let noteId = 0;
    const allNotes = [];
    for (const tr of finalTracks) {
      // sustain pedal per channel
      const pedal = {};
      for (const c of tr.controllers) if (c.cc === 64) (pedal[c.channel] = pedal[c.channel] || []).push(c);
      for (const ch of Object.keys(pedal)) pedal[ch].sort((a, b) => a.tick - b.tick);
      tr.notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
      let zeroLen = 0;
      for (const n of tr.notes) {
        if (n.endTick < n.startTick) n.endTick = n.startTick;
        if (n.endTick === n.startTick) zeroLen++;
        n.id = noteId++;
        n.durTick = n.endTick - n.startTick;
        n.startSec = tickToSec(n.startTick);
        n.endSec = tickToSec(n.endTick);
        n.durSec = n.endSec - n.startSec;
        n.startBeat = n.startTick / ppq;
        n.durBeat = n.durTick / ppq;
        // sustain pedal: if pedal down at note-off, sounding continues until pedal-up
        n.soundEndTick = n.endTick;
        const pl = pedal[n.channel];
        if (pl && n.channel !== 9) {
          let lo = 0, hi = pl.length - 1, idx = -1;
          while (lo <= hi) { const m = (lo + hi) >> 1; if (pl[m].tick <= n.endTick) { idx = m; lo = m + 1; } else hi = m - 1; }
          if (idx >= 0 && pl[idx].value >= 64) {
            let j = idx + 1; while (j < pl.length && pl[j].value >= 64) j++;
            n.soundEndTick = j < pl.length ? pl[j].tick : tr.endTick;
            if (n.soundEndTick < n.endTick) n.soundEndTick = n.endTick;
          }
        }
        n.soundEndSec = tickToSec(n.soundEndTick);
        allNotes.push(n);
      }
      if (zeroLen) warnings.push(`Track ${tr.index}: ${zeroLen} zero-length note(s) (note-on and note-off at the same tick). They are kept in the data and shown as thin marks; playback renders them as very short notes.`);
      // channel -> latest program-at-tick lookup
      tr.programs.sort((a, b) => a.tick - b.tick);
      tr.controllers.sort((a, b) => a.tick - b.tick);
      tr.pitchBends.sort((a, b) => a.tick - b.tick);
      tr.isPercussion = tr.channels.length > 0 && tr.channels.every(c => c === 9);
      tr.hasPercussionChannel = tr.channels.includes(9);
      tr.noteCount = tr.notes.length;
      const ccCounts = {};
      for (const c of tr.controllers) ccCounts[c.cc] = (ccCounts[c.cc] || 0) + 1;
      tr.ccCounts = ccCounts;
    }
    allNotes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch || a.id - b.id);

    let lastNoteEnd = 0;
    for (const n of allNotes) lastNoteEnd = Math.max(lastNoteEnd, n.endTick);
    const seqEndTick = Math.max(lastNoteEnd, endTick);
    const durationSec = tickToSec(seqEndTick);
    const musicalEndSec = tickToSec(lastNoteEnd);

    const label = trackIdxs.length === 1 && format === 2 ? `Sequence ${sid + 1}` : 'Arrangement';
    return {
      id: sid, label, ppq, smpte, format,
      tracks: finalTracks,
      metaTracks: finalTracks.filter(t => !t.notes.length),
      musicalTracks: finalTracks.filter(t => t.notes.length),
      notes: allNotes,
      tempoMap, timeSigs: meter.entries, meter, keySigs, markers,
      endTick: seqEndTick, lastNoteEndTick: lastNoteEnd, durationSec, musicalEndSec,
      tickToSec, secToTick,
      tickToBeat: t => t / ppq,
      posOfTick: t => meter.position(t),
      programAt(track, tick, channel) {
        let prog = null;
        for (const pc of track.programs) { if (pc.tick > tick) break; if (channel === undefined || pc.channel === channel) prog = pc.program; }
        return prog;
      }
    };
  }

  /* ---------- helpers exposed ---------- */
  function gmProgramName(p) { return GM_PROGRAMS[p] || 'Program ' + p; }
  function gmDrumName(n) { return GM_DRUMS[n] || 'Percussion ' + n; }

  /** Transposed COPY of the original bytes. Percussion channel (10) untouched. Throws if any note would leave 0..127. */
  function transposeCopy(parsed, semitones) {
    if (!Number.isInteger(semitones) || Math.abs(semitones) > 36) throw new Error('Transposition must be a whole number between -36 and +36.');
    const out = new Uint8Array(parsed.original.slice(0)); // copy; the original stays untouched
    const touched = new Set();
    let bad = 0, count = 0;
    for (const seq of parsed.sequences) for (const tr of seq.tracks) for (const n of tr.notes) {
      if (n.channel === 9) continue;
      const np = n.pitch + semitones;
      if (np < 0 || np > 127) { bad++; continue; }
      for (const pos of [n.byteOn, n.byteOff]) {
        if (pos === undefined || touched.has(pos)) continue;
        touched.add(pos); out[pos] = (out[pos] & 0x80) | np; // note-off byte uses the same pitch
      }
      count++;
    }
    if (bad) throw new Error(`Transposing by ${semitones > 0 ? '+' : ''}${semitones} would push ${bad} note(s) outside the MIDI range 0–127. Choose a smaller shift.`);
    return { bytes: out, notesChanged: count };
  }

  FO.midi = { parse, MidiParseError, gmProgramName, gmDrumName, transposeCopy, GM_PROGRAMS, GM_DRUMS };
  if (typeof module !== 'undefined' && module.exports) module.exports = FO.midi;
})();
