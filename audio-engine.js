/* Frequency Oasis — MIDI DNA
 * audio-engine.js : built-in Web Audio synthesizer, look-ahead transport, per-track mixing, offline WAV render.
 *
 * HONESTY NOTE (shown in the UI): this is a compact additive/subtractive/FM synthesizer written for this app.
 * It is NOT a sample library and it does not reproduce the sounds of any DAW or General MIDI bank. General MIDI
 * program numbers are mapped to the nearest of ~13 synth voices. Percussion (channel 10) is synthesized.
 *
 * Timing: notes are scheduled against AudioContext.currentTime in a look-ahead window, driven by a Worker timer so
 * that heavy canvas animation on the main thread cannot delay the scheduler.
 */
(function () {
  'use strict';
  const FO = (globalThis.FO = globalThis.FO || {});

  const INSTRUMENTS = [
    { id: 'piano', name: 'Felt Piano', note: 'Additive hammered tone with pitch-dependent decay' },
    { id: 'epiano', name: 'Tine Electric Piano', note: 'Two-operator FM with decaying brightness' },
    { id: 'organ', name: 'Drawbar Organ', note: 'Eight-harmonic additive organ with soft key click' },
    { id: 'strings', name: 'Ensemble Strings', note: 'Detuned saw ensemble, slow bow attack, delayed vibrato' },
    { id: 'pad', name: 'Warm Pad', note: 'Three detuned saws, slow filter breathing' },
    { id: 'pluck', name: 'Plucked String', note: 'Filtered saw with fast spectral decay (guitar / harp family)' },
    { id: 'bass', name: 'Sub Bass', note: 'Sine + filtered saw, tight envelope' },
    { id: 'lead', name: 'Synth Lead', note: 'Detuned square/saw pair with delayed vibrato' },
    { id: 'brass', name: 'Brass Stab', note: 'Filter-swell saw pair' },
    { id: 'choir', name: 'Vowel Choir', note: 'Saw through two formant filters' },
    { id: 'bell', name: 'FM Bell', note: 'Inharmonic FM with long decay' },
    { id: 'sine', name: 'Pure Sine', note: 'Reference tone — handy for checking pitch' },
    { id: 'drums', name: 'Synth Drum Kit', note: 'Synthesized kit mapped from General MIDI drum notes' }
  ];
  const INSTR_BY_ID = Object.fromEntries(INSTRUMENTS.map(i => [i.id, i]));

  function programToInstrument(p) {
    if (p === null || p === undefined) return 'piano';
    if (p <= 3) return 'piano'; if (p <= 5) return 'epiano'; if (p <= 7) return 'pluck'; if (p <= 15) return 'bell';
    if (p <= 23) return 'organ'; if (p <= 31) return 'pluck'; if (p <= 39) return 'bass';
    if (p <= 44) return 'strings'; if (p === 45 || p === 46) return 'pluck'; if (p === 47) return 'bass';
    if (p <= 51) return 'strings'; if (p <= 54) return 'choir'; if (p === 55) return 'brass';
    if (p <= 63) return 'brass'; if (p <= 79) return 'lead'; if (p <= 87) return 'lead';
    if (p <= 95) return 'pad'; if (p <= 103) return 'pad'; if (p <= 111) return 'pluck'; if (p <= 119) return 'bell';
    return 'pad';
  }

  const mtof = (p) => 440 * Math.pow(2, (p - 69) / 12);
  const noiseCache = new WeakMap();
  function noiseBuf(ctx) {
    let b = noiseCache.get(ctx); if (b) return b;
    const len = Math.floor(ctx.sampleRate * 1.5); b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0); let s = 22222; for (let i = 0; i < len; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
    noiseCache.set(ctx, b); return b;
  }

  /* ---------- voice toolkit ---------- */
  class Voice {
    constructor(ctx, dest) { this.ctx = ctx; this.out = ctx.createGain(); this.out.gain.value = 1; this.out.connect(dest); this.srcs = []; this.nodes = [this.out]; this.endTime = 0; this.oscs = []; }
    osc(type, freq, t0, bend) {
      const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0); this.srcs.push(o); this.oscs.push(o);
      if (bend) for (const b of bend) o.detune.linearRampToValueAtTime(b.cents, b.t);
      return o;
    }
    gain(v) { const g = this.ctx.createGain(); g.gain.value = v; this.nodes.push(g); return g; }
    filter(type, f, q) { const n = this.ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q !== undefined) n.Q.value = q; this.nodes.push(n); return n; }
    noise(t0) { const s = this.ctx.createBufferSource(); s.buffer = noiseBuf(this.ctx); s.loop = true; this.srcs.push(s); return s; }
    /** ADSR on an AudioParam (a, d, r in seconds; s = sustain as a fraction of peak).
     *  s <= 0.002 means a percussive envelope: it decays fully over d and ignores the note-off. */
    adsr(param, t0, tOff, peak, a, d, s, r, floor) {
      floor = floor || 0.0001; const tA = t0 + a;
      param.cancelScheduledValues(t0); param.setValueAtTime(floor, t0); param.linearRampToValueAtTime(Math.max(peak, floor * 2), tA);
      if (s <= 0.002) { param.exponentialRampToValueAtTime(floor, tA + d); this.endTime = Math.max(this.endTime, tA + d + 0.02); return; }
      const susLvl = Math.max(peak * s, floor), tOffC = Math.max(tOff, tA + 0.002), dEnd = Math.min(tA + d, tOffC);
      const lvl = susLvl >= peak ? peak : Math.max(floor, peak * Math.pow(susLvl / peak, d > 0 ? (dEnd - tA) / d : 1));
      if (dEnd > tA) param.exponentialRampToValueAtTime(lvl, dEnd);
      param.setValueAtTime(lvl, tOffC); param.exponentialRampToValueAtTime(floor, tOffC + r);
      this.endTime = Math.max(this.endTime, tOffC + r);
    }
    start(t0) { for (const s of this.srcs) s.start(t0); }
    finish(onend) {
      const end = this.endTime + 0.05;
      for (const s of this.srcs) { try { s.stop(end); } catch (e) {} }
      const last = this.srcs[0];
      if (last) last.onended = () => { this.dispose(); if (onend) onend(this); };
      this.end = end;
    }
    kill(now) {
      try { this.out.gain.cancelScheduledValues(now); this.out.gain.setValueAtTime(this.out.gain.value, now); this.out.gain.linearRampToValueAtTime(0, now + 0.04); } catch (e) {}
      for (const s of this.srcs) { try { s.stop(now + 0.06); } catch (e) {} }
    }
    dispose() { for (const n of this.nodes) { try { n.disconnect(); } catch (e) {} } }
  }

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  /* ---------- melodic instruments. p = {pitch, vel (0..1), t0, tOff (release start), bend, mul} ---------- */
  const BUILD = {
    piano(v, p) {
      const f = mtof(p.pitch), t0 = p.t0, vel = p.vel;
      const g = v.gain(0), lp = v.filter('lowpass', clamp(f * (3 + 9 * vel), 800, 12000), 0.4);
      const dec = clamp(3.2 - (p.pitch - 36) / 30, 0.5, 3.6);
      const o1 = v.osc('triangle', f, t0, p.bend), o2 = v.osc('sine', f * 2, t0, p.bend), o3 = v.osc('sine', f * 3.005, t0, p.bend), o4 = v.osc('sine', f * 0.5, t0, p.bend);
      const g2 = v.gain(0.5 * vel + 0.1), g3 = v.gain(0.22 * vel), g4 = v.gain(0.12);
      o1.connect(g); o2.connect(g2); g2.connect(g); o3.connect(g3); g3.connect(g); o4.connect(g4); g4.connect(g);
      g.connect(lp); lp.connect(v.out);
      lp.frequency.setValueAtTime(clamp(f * (4 + 10 * vel), 900, 14000), t0); lp.frequency.exponentialRampToValueAtTime(clamp(f * 2.2, 400, 5000), t0 + dec * 0.6);
      v.adsr(g.gain, t0, p.tOff, 0.55 * (0.35 + 0.65 * vel) * p.mul, 0.004, dec, 0.02, p.pitch < 48 ? 0.35 : 0.22);
    },
    epiano(v, p) {
      const f = mtof(p.pitch), t0 = p.t0, vel = p.vel;
      const car = v.osc('sine', f, t0, p.bend), mod = v.osc('sine', f * 1, t0, p.bend), tine = v.osc('sine', f * 7, t0, p.bend);
      const mg = v.gain(0), cg = v.gain(0), tg = v.gain(0);
      mod.connect(mg); mg.connect(car.frequency); car.connect(cg); cg.connect(v.out); tine.connect(tg); tg.connect(v.out);
      const idx = f * (0.6 + 2.2 * vel);
      mg.gain.setValueAtTime(idx, t0); mg.gain.exponentialRampToValueAtTime(Math.max(1, idx * 0.08), t0 + 1.2);
      v.adsr(cg.gain, t0, p.tOff, 0.42 * (0.4 + 0.6 * vel) * p.mul, 0.004, 1.8, 0.28, 0.3);
      v.adsr(tg.gain, t0, t0 + 0.05, 0.08 * vel * p.mul, 0.001, 0.12, 0.001, 0.1);
    },
    organ(v, p) {
      const f = mtof(p.pitch), t0 = p.t0, bars = [[1, 0.9], [2, 0.8], [3, 0.5], [4, 0.45], [6, 0.25], [8, 0.2], [0.5, 0.5]];
      const g = v.gain(0); for (const [h, a] of bars) { const o = v.osc('sine', f * h, t0, p.bend), ag = v.gain(a * 0.16); o.connect(ag); ag.connect(g); }
      const lp = v.filter('lowpass', 6000, 0.3); g.connect(lp); lp.connect(v.out);
      v.adsr(g.gain, t0, p.tOff, 0.6 * (0.55 + 0.45 * p.vel) * p.mul, 0.012, 0.05, 0.92, 0.09);
    },
    strings(v, p) {
      const f = mtof(p.pitch), t0 = p.t0, g = v.gain(0), lp = v.filter('lowpass', clamp(f * 5, 900, 5200), 0.5);
      const lfo = v.osc('sine', 5.2, t0), lg = v.gain(0); lfo.connect(lg); lg.gain.setValueAtTime(0, t0); lg.gain.linearRampToValueAtTime(7, t0 + 0.9);
      [-9, -3, 3, 9].forEach((c, i) => { const o = v.osc('sawtooth', f, t0, p.bend); o.detune.value = c; lg.connect(o.detune); const og = v.gain(0.14); o.connect(og); og.connect(g); });
      g.connect(lp); lp.connect(v.out);
      v.adsr(g.gain, t0, p.tOff, 0.5 * (0.4 + 0.6 * p.vel) * p.mul, 0.13, 0.3, 0.85, 0.38);
    },
    pad(v, p) {
      const f = mtof(p.pitch), t0 = p.t0, g = v.gain(0), lp = v.filter('lowpass', 900, 0.8);
      const lfo = v.osc('sine', 0.23, t0), lg = v.gain(350); lfo.connect(lg); lg.connect(lp.frequency);
      [-12, 0, 12].forEach(c => { const o = v.osc('sawtooth', f, t0, p.bend); o.detune.value = c; const og = v.gain(0.17); o.connect(og); og.connect(g); });
      g.connect(lp); lp.connect(v.out);
      v.adsr(g.gain, t0, p.tOff, 0.5 * (0.4 + 0.6 * p.vel) * p.mul, 0.4, 0.5, 0.9, 1.0);
    },
    pluck(v, p) {
      const f = mtof(p.pitch), t0 = p.t0, vel = p.vel, g = v.gain(0), lp = v.filter('lowpass', 5000, 1.2);
      const o1 = v.osc('sawtooth', f, t0, p.bend), o2 = v.osc('triangle', f * 2, t0, p.bend), o2g = v.gain(0.25);
      o1.connect(g); o2.connect(o2g); o2g.connect(g); g.connect(lp); lp.connect(v.out);
      lp.frequency.setValueAtTime(clamp(f * (6 + 12 * vel), 1200, 9000), t0); lp.frequency.exponentialRampToValueAtTime(clamp(f * 1.5, 250, 2500), t0 + 0.5);
      v.adsr(g.gain, t0, p.tOff, 0.5 * (0.4 + 0.6 * vel) * p.mul, 0.002, 0.9, 0.04, 0.18);
    },
    bass(v, p) {
      const f = mtof(p.pitch), t0 = p.t0, vel = p.vel, g = v.gain(0), lp = v.filter('lowpass', 700, 1.1);
      const so = v.osc('sine', f, t0, p.bend), sw = v.osc('sawtooth', f, t0, p.bend), sg = v.gain(0.35);
      so.connect(g); sw.connect(sg); sg.connect(lp); lp.connect(g); g.connect(v.out);
      lp.frequency.setValueAtTime(clamp(f * 10 * (0.5 + vel), 300, 2400), t0); lp.frequency.exponentialRampToValueAtTime(clamp(f * 2.5, 100, 800), t0 + 0.25);
      v.adsr(g.gain, t0, p.tOff, 0.78 * (0.45 + 0.55 * vel) * p.mul, 0.004, 0.4, 0.7, 0.1);
    },
    lead(v, p) {
      const f = mtof(p.pitch), t0 = p.t0, g = v.gain(0), lp = v.filter('lowpass', clamp(f * 7, 1500, 7500), 0.9);
      const lfo = v.osc('sine', 5.6, t0), lg = v.gain(0); lfo.connect(lg); lg.gain.setValueAtTime(0, t0); lg.gain.linearRampToValueAtTime(10, t0 + 0.35);
      const a = v.osc('square', f, t0, p.bend), b = v.osc('sawtooth', f, t0, p.bend); a.detune.value = -6; b.detune.value = 6; lg.connect(a.detune); lg.connect(b.detune);
      const ag = v.gain(0.3), bg = v.gain(0.3); a.connect(ag); b.connect(bg); ag.connect(g); bg.connect(g); g.connect(lp); lp.connect(v.out);
      v.adsr(g.gain, t0, p.tOff, 0.45 * (0.45 + 0.55 * p.vel) * p.mul, 0.012, 0.12, 0.8, 0.14);
    },
    brass(v, p) {
      const f = mtof(p.pitch), t0 = p.t0, vel = p.vel, g = v.gain(0), lp = v.filter('lowpass', 500, 0.7);
      const a = v.osc('sawtooth', f, t0, p.bend), b = v.osc('sawtooth', f, t0, p.bend); b.detune.value = 7; const bg = v.gain(0.5);
      a.connect(g); b.connect(bg); bg.connect(g); g.connect(lp); lp.connect(v.out);
      lp.frequency.setValueAtTime(clamp(f * 1.5, 300, 900), t0); lp.frequency.exponentialRampToValueAtTime(clamp(f * (5 + 8 * vel), 1500, 7000), t0 + 0.12);
      v.adsr(g.gain, t0, p.tOff, 0.5 * (0.5 + 0.5 * vel) * p.mul, 0.045, 0.15, 0.85, 0.14);
    },
    choir(v, p) {
      const f = mtof(p.pitch), t0 = p.t0, g = v.gain(0), src = v.osc('sawtooth', f, t0, p.bend), src2 = v.osc('sawtooth', f, t0, p.bend); src2.detune.value = 9;
      const f1 = v.filter('bandpass', 700, 5), f2 = v.filter('bandpass', 1150, 6), g1 = v.gain(1.2), g2 = v.gain(0.8), s2g = v.gain(0.7);
      const lfo = v.osc('sine', 5, t0), lg = v.gain(0); lfo.connect(lg); lg.gain.setValueAtTime(0, t0); lg.gain.linearRampToValueAtTime(6, t0 + 0.7); lg.connect(src.detune); lg.connect(src2.detune);
      src.connect(f1); src2.connect(s2g); s2g.connect(f1); src.connect(f2); f1.connect(g1); f2.connect(g2); g1.connect(g); g2.connect(g); g.connect(v.out);
      v.adsr(g.gain, t0, p.tOff, 1.1 * (0.4 + 0.6 * p.vel) * p.mul, 0.18, 0.3, 0.9, 0.4);
    },
    bell(v, p) {
      const f = mtof(p.pitch), t0 = p.t0, vel = p.vel, car = v.osc('sine', f, t0, p.bend), mod = v.osc('sine', f * 3.5, t0, p.bend), mg = v.gain(0), cg = v.gain(0), c2 = v.osc('sine', f * 2.01, t0, p.bend), c2g = v.gain(0);
      mod.connect(mg); mg.connect(car.frequency); car.connect(cg); cg.connect(v.out); c2.connect(c2g); c2g.connect(v.out);
      mg.gain.setValueAtTime(f * (0.8 + 1.6 * vel), t0); mg.gain.exponentialRampToValueAtTime(Math.max(0.5, f * 0.05), t0 + 1.6);
      const ring = clamp(3.2 - (p.pitch - 48) / 28, 0.8, 3.5);
      v.adsr(cg.gain, t0, t0 + 0.02, 0.4 * (0.4 + 0.6 * vel) * p.mul, 0.002, ring, 0.001, 0.4);
      v.adsr(c2g.gain, t0, t0 + 0.02, 0.12 * vel * p.mul, 0.002, ring * 0.5, 0.001, 0.3);
      // bells ring on regardless of note length; ensure the end time reflects the ring
    },
    sine(v, p) {
      const f = mtof(p.pitch), t0 = p.t0, g = v.gain(0), o = v.osc('sine', f, t0, p.bend); o.connect(g); g.connect(v.out);
      v.adsr(g.gain, t0, p.tOff, 0.5 * (0.35 + 0.65 * p.vel) * p.mul, 0.008, 0.05, 0.95, 0.1);
    }
  };

  /* ---------- drums ---------- */
  function kick(v, t0, vel, mul, tune) {
    const o = v.osc('sine', 150, t0), g = v.gain(0); o.frequency.exponentialRampToValueAtTime(45 * tune, t0 + 0.12); o.connect(g); g.connect(v.out);
    v.adsr(g.gain, t0, t0 + 0.04, 0.95 * (0.5 + 0.5 * vel) * mul, 0.001, 0.32, 0.001, 0.05);
    const c = v.osc('triangle', 90, t0), cg = v.gain(0); c.connect(cg); cg.connect(v.out); v.adsr(cg.gain, t0, t0 + 0.01, 0.25 * vel * mul, 0.0005, 0.02, 0.001, 0.01);
  }
  function snare(v, t0, vel, mul, electric) {
    const n = v.noise(t0), hp = v.filter('highpass', 1400, 0.7), ng = v.gain(0); n.connect(hp); hp.connect(ng); ng.connect(v.out);
    v.adsr(ng.gain, t0, t0 + 0.02, 0.6 * (0.4 + 0.6 * vel) * mul, 0.001, electric ? 0.22 : 0.17, 0.001, 0.05);
    const o = v.osc('triangle', electric ? 190 : 175, t0), og = v.gain(0); o.frequency.exponentialRampToValueAtTime(120, t0 + 0.1); o.connect(og); og.connect(v.out); v.adsr(og.gain, t0, t0 + 0.02, 0.5 * vel * mul, 0.001, 0.1, 0.001, 0.03);
  }
  function hat(v, t0, vel, mul, open, pedal) {
    const n = v.noise(t0), hp = v.filter('highpass', 7200, 0.9), bp = v.filter('bandpass', 10000, 0.8), g = v.gain(0); n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(v.out);
    const d = open ? 0.38 : pedal ? 0.07 : 0.05; v.adsr(g.gain, t0, t0 + 0.005, 0.42 * (0.4 + 0.6 * vel) * mul, 0.001, d, 0.001, open ? 0.1 : 0.02);
  }
  function cymbal(v, t0, vel, mul, len, hpf) {
    const n = v.noise(t0), hp = v.filter('highpass', hpf, 0.6), g = v.gain(0); n.connect(hp); hp.connect(g); g.connect(v.out);
    v.adsr(g.gain, t0, t0 + 0.01, 0.38 * (0.4 + 0.6 * vel) * mul, 0.002, len, 0.001, 0.2);
  }
  function tom(v, t0, vel, mul, f) {
    const o = v.osc('sine', f * 1.5, t0), g = v.gain(0); o.frequency.exponentialRampToValueAtTime(f, t0 + 0.1); o.connect(g); g.connect(v.out);
    v.adsr(g.gain, t0, t0 + 0.02, 0.8 * (0.45 + 0.55 * vel) * mul, 0.001, 0.35, 0.001, 0.06);
  }
  function clap(v, t0, vel, mul) {
    const n = v.noise(t0), bp = v.filter('bandpass', 1500, 1.2), g = v.gain(0); n.connect(bp); bp.connect(g); g.connect(v.out);
    const gp = g.gain; gp.cancelScheduledValues(t0); gp.setValueAtTime(0.0001, t0);
    [0, 0.011, 0.023].forEach(d => { gp.linearRampToValueAtTime(0.55 * vel * mul, t0 + d + 0.002); gp.exponentialRampToValueAtTime(0.05, t0 + d + 0.01); });
    gp.linearRampToValueAtTime(0.5 * vel * mul, t0 + 0.027); gp.exponentialRampToValueAtTime(0.0001, t0 + 0.2); v.endTime = t0 + 0.22;
  }
  function metal(v, t0, vel, mul, f, len) {
    const g = v.gain(0), hp = v.filter('highpass', 600, 0.5); [1, 1.504, 1.9, 2.54].forEach((r, i) => { const o = v.osc('square', f * r, t0), og = v.gain(0.12); o.connect(og); og.connect(hp); }); hp.connect(g); g.connect(v.out);
    v.adsr(g.gain, t0, t0 + 0.01, 0.35 * (0.4 + 0.6 * vel) * mul, 0.001, len, 0.001, 0.05);
  }
  function woody(v, t0, vel, mul, f) {
    const o = v.osc('sine', f, t0), g = v.gain(0); o.connect(g); g.connect(v.out); v.adsr(g.gain, t0, t0 + 0.01, 0.6 * (0.4 + 0.6 * vel) * mul, 0.001, 0.06, 0.001, 0.02);
  }
  function drum(v, p) {
    const n = p.pitch, t0 = p.t0, vel = p.vel, m = p.mul;
    if (n === 35 || n === 36) kick(v, t0, vel, m, n === 35 ? 0.9 : 1);
    else if (n === 38 || n === 40) snare(v, t0, vel, m, n === 40);
    else if (n === 37) woody(v, t0, vel, m, 1700);
    else if (n === 39) clap(v, t0, vel, m);
    else if (n === 42) hat(v, t0, vel, m, false, false);
    else if (n === 44) hat(v, t0, vel, m, false, true);
    else if (n === 46) hat(v, t0, vel, m, true, false);
    else if ([41, 43, 45, 47, 48, 50].includes(n)) tom(v, t0, vel, m, { 41: 80, 43: 95, 45: 112, 47: 130, 48: 150, 50: 175 }[n]);
    else if (n === 49 || n === 57 || n === 52 || n === 55) cymbal(v, t0, vel, m, n === 55 ? 0.9 : 2.2, 5000);
    else if (n === 51 || n === 59 || n === 53) cymbal(v, t0, vel, m, 0.9, 7000);
    else if (n === 54 || n === 70 || n === 69) { hat(v, t0, vel, m, false, true); }
    else if (n === 56) metal(v, t0, vel, m, 560, 0.35);
    else if (n >= 60 && n <= 66) woody(v, t0, vel, m, 300 + (n - 60) * 60);
    else if (n === 75 || n === 76 || n === 77) woody(v, t0, vel, m, 900 + (n - 75) * 150);
    else if (n === 80 || n === 81) metal(v, t0, vel, m, 1800, n === 81 ? 0.8 : 0.1);
    else woody(v, t0, vel, m, 400 + (n % 24) * 40);
  }

  /** Build one note into `dest`. Returns the Voice. */
  function buildNote(ctx, dest, instId, p) {
    const v = new Voice(ctx, dest);
    if (instId === 'drums') drum(v, p); else (BUILD[instId] || BUILD.piano)(v, p);
    v.start(p.t0); v.finish();
    return v;
  }

  /* ---------- master chain ---------- */
  function buildMaster(ctx, masterVol) {
    const master = ctx.createGain(); master.gain.value = masterVol;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.22;
    const clip = ctx.createWaveShaper(); const N = 2048, curve = new Float32Array(N); for (let i = 0; i < N; i++) { const x = (i / (N - 1)) * 2 - 1; curve[i] = Math.tanh(x * 1.1) / Math.tanh(1.1); } clip.curve = curve; clip.oversample = '2x';
    const trim = ctx.createGain(); trim.gain.value = 0.89; // ≈ −1 dBFS ceiling after soft clip
    master.connect(comp); comp.connect(clip); clip.connect(trim);
    return { master, comp, clip, out: trim };
  }

  /* ---------- helpers on MIDI data ---------- */
  function ccLookup(track, ch, cc) {
    const arr = track.controllers.filter(c => c.channel === ch && c.cc === cc); // sorted by tick
    return (tick, def) => { let lo = 0, hi = arr.length - 1, idx = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].tick <= tick) { idx = m; lo = m + 1; } else hi = m - 1; } return idx >= 0 ? arr[idx].value : def; };
  }
  function prepareTracks(seq) {
    const tracks = {};
    for (const t of seq.musicalTracks) {
      const cache = {};
      tracks[t.index] = {
        track: t,
        vol: (ch) => (cache['v' + ch] = cache['v' + ch] || ccLookup(t, ch, 7)),
        expr: (ch) => (cache['e' + ch] = cache['e' + ch] || ccLookup(t, ch, 11)),
        bends: t.pitchBends
      };
    }
    return tracks;
  }
  /** Pitch-bend automation for one note as [{t: absolute audio time, cents}], assuming the GM default ±2 semitone range. */
  function bendsFor(tr, note, rate, whenStart) {
    const arr = tr.bends; if (!arr.length) return null;
    let last = 0; const out = [];
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i]; if (b.channel !== note.channel) continue;
      if (b.tick <= note.startTick) { last = b.value; continue; }
      if (b.tick > note.soundEndTick) break;
      if (!out.length) out.push({ t: whenStart, cents: last / 8192 * 200 });
      out.push({ t: whenStart + (b._sec - note.startSec) / rate, cents: b.value / 8192 * 200 });
    }
    if (!out.length) return last === 0 ? null : [{ t: whenStart, cents: last / 8192 * 200 }];
    return out;
  }

  /* ---------- WAV ---------- */
  function encodeWav(channels, sampleRate) {
    const nCh = channels.length, len = channels[0].length, bytes = 44 + len * nCh * 2, buf = new ArrayBuffer(bytes), dv = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nCh, true); dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * nCh * 2, true); dv.setUint16(32, nCh * 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, len * nCh * 2, true);
    let o = 44, peak = 0, nz = 0;
    for (let i = 0; i < len; i++) for (let c = 0; c < nCh; c++) { let s = channels[c][i]; if (s > 1) s = 1; else if (s < -1) s = -1; const a = Math.abs(s); if (a > peak) peak = a; if (a > 1e-4) nz++; dv.setInt16(o, s < 0 ? s * 32768 : s * 32767, true); o += 2; }
    return { bytes: new Uint8Array(buf), peak, nonSilentSamples: nz };
  }

  /* ---------- engine ---------- */
  const TICK_WORKER_SRC = 'let id=null;onmessage=e=>{if(e.data==="start"){if(id===null)id=setInterval(()=>postMessage(1),25)}else if(e.data==="stop"){clearInterval(id);id=null}};';

  class Engine {
    constructor() {
      this.ctx = null; this.seq = null; this.notes = []; this.trk = {}; this.settings = {}; this.masterVol = 0.8; this.rate = 1;
      this.playing = false; this.pos = 0; this.originSec = 0; this.originCtx = 0; this.idx = 0; this.voices = new Set(); this.buses = {};
      this.loop = null; this.listeners = {}; this.lookahead = 0.45; this.tailSec = 2.5; this.worker = null; this.timer = null; this.voiceLimit = 110; this.scheduled = 0;
    }
    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
    emit(ev, a) { for (const f of this.listeners[ev] || []) try { f(a); } catch (e) { console.error(e); } }
    get available() { return typeof (globalThis.AudioContext || globalThis.webkitAudioContext) !== 'undefined'; }

    ensureContext() {
      if (this.ctx) return this.ctx;
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) throw new Error('Web Audio is not available in this browser.');
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.chain = buildMaster(this.ctx, this.masterVol);
      this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0.8;
      this.chain.out.connect(this.analyser); this.chain.out.connect(this.ctx.destination);
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount); this.timeData = new Uint8Array(this.analyser.fftSize);
      for (const k of Object.keys(this.trk)) this.makeBus(+k);
      return this.ctx;
    }
    makeBus(i) {
      if (!this.ctx || this.buses[i]) return;
      const g = this.ctx.createGain(), pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (pan) { g.connect(pan); pan.connect(this.chain.master); } else g.connect(this.chain.master);
      this.buses[i] = { g, pan }; this.applyBus(i);
    }
    load(seq, defaults) {
      this.stop(); this.seq = seq; this.notes = seq.notes; this.trk = prepareTracks(seq); this.idx = 0; this.pos = 0;
      for (const b of Object.values(this.buses)) { try { b.g.disconnect(); if (b.pan) b.pan.disconnect(); } catch (e) {} }
      this.buses = {}; this.settings = {};
      for (const t of seq.musicalTracks) {
        const prog = t.programs.length ? t.programs[0].program : null;
        const auto = t.isPercussion || (t.hasPercussionChannel && t.channels.length === 1) ? 'drums' : programToInstrument(prog);
        this.settings[t.index] = Object.assign({ instrument: 'auto', autoInstrument: auto, volume: 0.85, pan: 0, mute: false, solo: false }, defaults && defaults[t.index]);
        if (this.ctx) this.makeBus(t.index);
      }
      for (const t of seq.tracks) for (const b of t.pitchBends) b._sec = seq.tickToSec(b.tick);
      this.duration = seq.musicalEndSec;
      this.emit('load');
    }
    instrumentOf(ti, channel) {
      const s = this.settings[ti]; if (!s) return 'piano';
      if (channel === 9) return 'drums';
      return s.instrument === 'auto' ? (s.autoInstrument === 'drums' ? 'piano' : s.autoInstrument) : s.instrument;
    }
    audible(ti) { const any = Object.values(this.settings).some(s => s.solo); const s = this.settings[ti]; return s && !s.mute && (!any || s.solo); }
    applyBus(i) {
      const b = this.buses[i], s = this.settings[i]; if (!b || !s) return;
      const g = this.audible(i) ? s.volume * s.volume : 0, now = this.ctx.currentTime;
      b.g.gain.cancelScheduledValues(now); b.g.gain.setTargetAtTime(g, now, 0.015); if (b.pan) b.pan.pan.value = s.pan;
    }
    applyAllBuses() { for (const k of Object.keys(this.buses)) this.applyBus(+k); }
    setTrack(i, patch) { Object.assign(this.settings[i], patch); if (this.ctx) this.applyAllBuses(); this.emit('mix'); }
    isolate(i) { for (const [k, s] of Object.entries(this.settings)) { s.solo = +k === i ? !s.solo : false; } if (this.ctx) this.applyAllBuses(); this.emit('mix'); }
    setMasterVolume(v) { this.masterVol = v; if (this.ctx) this.chain.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }
    setRate(r) { const p = this.position; this.rate = r; if (this.playing) { this.originSec = p; this.originCtx = this.ctx.currentTime; } }
    setLoop(a, b) { this.loop = a === null || a === undefined ? null : { a, b }; }

    get position() { if (!this.playing) return this.pos; return this.originSec + (this.ctx.currentTime - this.originCtx) * this.rate; }
    get level() { if (!this.analyser) return 0; this.analyser.getByteTimeDomainData(this.timeData); let s = 0; for (let i = 0; i < this.timeData.length; i++) { const x = (this.timeData[i] - 128) / 128; s += x * x; } return Math.sqrt(s / this.timeData.length); }
    spectrum() { if (!this.analyser) return null; this.analyser.getByteFrequencyData(this.freqData); return this.freqData; }

    async play(from) {
      if (!this.seq) return;
      const ctx = this.ensureContext(); if (ctx.state !== 'running') await ctx.resume();
      if (this.playing) return;
      if (from !== undefined) this.pos = from;
      if (this.pos >= this.duration + 0.01) this.pos = 0;
      this.applyAllBuses();
      this.originSec = this.pos; this.originCtx = ctx.currentTime + 0.06;
      this.idx = this.firstIndexAfter(this.pos - 1e-6); this.playing = true; this.cursor = this.pos;
      this.startTimer(); this.tick(); this.emit('state', 'playing');
    }
    firstIndexAfter(sec) { let lo = 0, hi = this.notes.length; while (lo < hi) { const m = (lo + hi) >> 1; if (this.notes[m].startSec < sec) lo = m + 1; else hi = m; } return lo; }
    startTimer() {
      this.stopTimer();
      try { const url = URL.createObjectURL(new Blob([TICK_WORKER_SRC], { type: 'text/javascript' })); this.worker = new Worker(url); URL.revokeObjectURL(url); this.worker.onmessage = () => this.tick(); this.worker.postMessage('start'); }
      catch (e) { this.worker = null; this.timer = setInterval(() => this.tick(), 25); }
    }
    stopTimer() { if (this.worker) { try { this.worker.postMessage('stop'); this.worker.terminate(); } catch (e) {} this.worker = null; } if (this.timer) { clearInterval(this.timer); this.timer = null; } }
    tick() {
      if (!this.playing) return;
      const ctx = this.ctx, pos = this.position;
      const horizon = pos + this.lookahead * this.rate;
      let loopEnd = this.loop ? this.loop.b : null;
      while (this.idx < this.notes.length) {
        const n = this.notes[this.idx];
        if (loopEnd !== null && n.startSec >= loopEnd) break;
        if (n.startSec >= horizon) break;
        if (n.startSec >= this.cursor - 1e-6 || n.startSec >= pos - 0.02) this.scheduleNote(n);
        this.idx++;
      }
      this.cursor = Math.max(this.cursor, horizon);
      if (loopEnd !== null && pos >= loopEnd) { this.jump(this.loop.a); return; }
      if (pos >= this.duration + this.tailSec) { this.stop(); this.emit('ended'); }
      else if (this.idx >= this.notes.length && pos >= this.duration) { /* tail ringing */ }
    }
    jump(sec) { const was = this.playing; this.killAll(); this.pos = sec; this.originSec = sec; this.originCtx = this.ctx.currentTime + 0.03; this.idx = this.firstIndexAfter(sec - 1e-6); this.cursor = sec; this.playing = was; }
    scheduleNote(n) {
      const ctx = this.ctx, bus = this.buses[n.track]; if (!bus) return;
      const s = this.settings[n.track]; if (!this.audible(n.track)) return;
      const when = this.originCtx + (n.startSec - this.originSec) / this.rate;
      const t0 = Math.max(when, ctx.currentTime);
      if (when < ctx.currentTime - 0.05) return; // too late to be musical
      const inst = this.instrumentOf(n.track, n.channel);
      const percussive = inst === 'drums';
      const sound = Math.max(0.03, (percussive ? n.durSec : n.soundEndSec - n.startSec) / this.rate);
      const T = this.trk[n.track];
      const v7 = T.vol(n.channel)(n.startTick, 100), v11 = T.expr(n.channel)(n.startTick, 127);
      const mul = Math.pow(v7 / 100, 1.5) * Math.pow(v11 / 127, 1.5);
      const bend = percussive ? null : bendsFor(T, n, this.rate, t0);
      if (this.voices.size >= this.voiceLimit) { let oldest = null; for (const v of this.voices) { oldest = v; break; } if (oldest) { oldest.kill(ctx.currentTime); this.voices.delete(oldest); } }
      const vel = n.velocity / 127;
      const v = buildNote(ctx, bus.g, inst, { pitch: n.pitch, vel: vel * vel * 0.4 + vel * 0.6, t0, tOff: t0 + sound, bend, mul: clamp(mul, 0, 1.5) });
      this.voices.add(v); v.srcs[0].onended = () => { v.dispose(); this.voices.delete(v); };
      this.scheduled++;
    }
    killAll() { if (!this.ctx) return; const now = this.ctx.currentTime; for (const v of this.voices) v.kill(now); this.voices.clear(); }
    pause() { if (!this.playing) return; this.pos = this.position; this.playing = false; this.stopTimer(); this.killAll(); this.emit('state', 'paused'); }
    stop() { const was = this.playing; this.pos = 0; this.playing = false; this.stopTimer(); this.killAll(); this.idx = 0; if (was || true) this.emit('state', 'stopped'); }
    seek(sec) { sec = clamp(sec, 0, this.duration || 0); if (this.playing) this.jump(sec); else this.pos = sec; this.emit('seek', sec); }
    /** Audition one pitch with the selected instrument of a track, without touching the transport. */
    async audition(ti, pitch, vel) {
      const ctx = this.ensureContext(); if (ctx.state !== 'running') await ctx.resume(); this.makeBus(ti); const bus = this.buses[ti]; if (!bus) return; this.applyBus(ti);
      const inst = this.instrumentOf(ti, this.settings[ti] && this.settings[ti].autoInstrument === 'drums' ? 9 : 0);
      const t0 = ctx.currentTime + 0.01; const v = buildNote(ctx, bus.g, inst, { pitch, vel: vel || 0.8, t0, tOff: t0 + 0.6, bend: null, mul: 1 }); this.voices.add(v); v.srcs[0].onended = () => { v.dispose(); this.voices.delete(v); };
    }
    destroy() { this.stop(); if (this.ctx) { try { this.ctx.close(); } catch (e) {} this.ctx = null; this.buses = {}; } }
  }

  /** Offline render of the current mix to 16-bit stereo WAV. Throws rather than returning a silent file. */
  async function renderWav(engine, opts) {
    opts = opts || {};
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext; if (!OAC) throw new Error('Offline audio rendering is not supported in this browser.');
    const seq = engine.seq; if (!seq || !seq.notes.length) throw new Error('There are no notes to render.');
    const sr = opts.sampleRate || 44100, tail = 3, dur = seq.musicalEndSec + tail;
    if (dur > 600) throw new Error(`This piece is ${Math.round(dur / 60)} minutes long; offline rendering is limited to 10 minutes to protect browser memory.`);
    const ctx = new OAC(2, Math.ceil(dur * sr), sr);
    const chain = buildMaster(ctx, engine.masterVol); chain.out.connect(ctx.destination);
    const buses = {}; const anySolo = Object.values(engine.settings).some(s => s.solo);
    for (const t of seq.musicalTracks) {
      const s = engine.settings[t.index]; const aud = !s.mute && (!anySolo || s.solo);
      const g = ctx.createGain(); g.gain.value = aud ? s.volume * s.volume : 0; const pan = ctx.createStereoPanner(); pan.pan.value = s.pan; g.connect(pan); pan.connect(chain.master); buses[t.index] = g;
    }
    const trk = prepareTracks(seq); let count = 0;
    for (const n of seq.notes) {
      const s = engine.settings[n.track]; if (!s || s.mute || (anySolo && !s.solo)) continue;
      const inst = engine.instrumentOf(n.track, n.channel), perc = inst === 'drums', T = trk[n.track];
      const t0 = n.startSec, sound = Math.max(0.03, perc ? n.durSec : n.soundEndSec - n.startSec);
      const mul = Math.pow(T.vol(n.channel)(n.startTick, 100) / 100, 1.5) * Math.pow(T.expr(n.channel)(n.startTick, 127) / 127, 1.5);
      const bend = perc ? null : bendsFor(T, n, 1, t0);
      const vel = n.velocity / 127;
      buildNote(ctx, buses[n.track], inst, { pitch: n.pitch, vel: vel * vel * 0.4 + vel * 0.6, t0, tOff: t0 + sound, bend, mul: clamp(mul, 0, 1.5) }); count++;
      if (opts.onProgress && count % 400 === 0) opts.onProgress(count / seq.notes.length);
    }
    const buf = await ctx.startRendering();
    const ch = [buf.getChannelData(0), buf.getChannelData(1)];
    const wav = encodeWav(ch, sr);
    if (wav.peak < 0.001 || wav.nonSilentSamples < sr * 0.05) throw new Error('The render came out silent, so no file was produced. Check that at least one track is audible.');
    return { bytes: wav.bytes, peak: wav.peak, seconds: buf.duration, sampleRate: sr, bitDepth: 16, channels: 2, notes: count };
  }

  FO.audio = { Engine, INSTRUMENTS, INSTR_BY_ID, programToInstrument, encodeWav, renderWav, buildNote, buildMaster };
  if (typeof module !== 'undefined' && module.exports) module.exports = FO.audio;
})();
