'use strict';
/* LofiEngine v2 — deterministic generative-free lo-fi player.
   Every loop is bit-identical: fixed composed melodies, fixed velocities,
   fixed timing (swing is part of the groove, not randomness), and a seeded
   PRNG for the vinyl bed so it sounds the same on every play.
   No samples, no network — all synthesized with the Web Audio API. */

/* Fixed-seed PRNG (mulberry32) so the vinyl bed is identical every load. */
function _seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _noteMidi(n) {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(n);
  if (!m) throw new Error('bad note ' + n);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  let s = base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  let oct = parseInt(m[3], 10);
  if (s < 0) { s += 12; oct -= 1; }
  if (s > 11) { s -= 12; oct += 1; }
  return (oct + 1) * 12 + s;
}
function _freq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

function _driveCurve(k) {
  const n = 512, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}
function _noiseBuffer(ctx, seconds, rand) {
  const len = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = rand() * 2 - 1;
  return buf;
}

var LOOP_BARS = 8; // melodies are composed over 8 bars; chords loop every 4.

function LofiPlayer(song) {
  this.song = song;
  this.playing = false;
  this.onBar = null;
  this.onState = null;
  this.rand = _seeded(1337);
}

LofiPlayer.prototype.play = function () {
  const S = this.song;
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  this.ctx = ctx;
  this.rand = _seeded(1337); // same vinyl + accents on every play
  const stepDur = 60 / S.bpm / 4;
  this.voices = [];

  // Master: gentle glue compressor + analyser for the visualizer.
  this.master = ctx.createGain(); this.master.gain.value = 0.9;
  this.comp = ctx.createDynamicsCompressor();
  this.comp.threshold.value = -18; this.comp.ratio.value = 4;
  this.comp.attack.value = 0.008; this.comp.release.value = 0.24;
  this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 64;
  this.master.connect(this.comp); this.comp.connect(this.analyser);
  this.analyser.connect(ctx.destination);

  // Music bus: lo-fi dullness (lowpass) + a whisper of tape saturation.
  this.bus = ctx.createGain();
  this.dull = ctx.createBiquadFilter();
  this.dull.type = 'lowpass'; this.dull.frequency.value = S.tone || 3200; this.dull.Q.value = 0.4;
  this.shaper = ctx.createWaveShaper(); this.shaper.curve = _driveCurve(1.6);
  this.bus.connect(this.dull); this.dull.connect(this.shaper); this.shaper.connect(this.master);

  // Chord bus runs through a ducking gain so kicks pump the keys.
  this.chordBus = ctx.createGain();
  this.duck = ctx.createGain();
  this.chordBus.connect(this.duck); this.duck.connect(this.bus);

  // Dotted-eighth feedback delay with slow tape-wow wobble (deterministic LFO).
  this.dly = ctx.createDelay(2.0); this.dly.delayTime.value = stepDur * 3;
  this.fb = ctx.createGain(); this.fb.gain.value = 0.36;
  this.wet = ctx.createGain(); this.wet.gain.value = (S.delayMix != null ? S.delayMix : 0.22);
  this.send = ctx.createGain();
  this.send.connect(this.dly); this.dly.connect(this.fb); this.fb.connect(this.dly);
  this.dly.connect(this.wet); this.wet.connect(this.master);
  const wow = ctx.createOscillator(); wow.frequency.value = 0.13;
  const wowG = ctx.createGain(); wowG.gain.value = 0.004;
  wow.connect(wowG); wowG.connect(this.dly.delayTime); wow.start();
  this.voices.push(wow);

  this.noiseBuf = _noiseBuffer(ctx, 1, this.rand);

  // Pre-bake the vinyl pops for the whole 8-bar loop: fixed schedule, fixed gain.
  this.pops = {};
  const total = LOOP_BARS * 16;
  for (let st = 0; st < total; st++) {
    if (this.rand() < 0.05) this.pops[st] = 0.03 + this.rand() * 0.07;
  }

  this._startVinyl(S.vinyl != null ? S.vinyl : 0.5);
  if (S.rain) this._startRain(S.rain);

  this.step = 0;
  this.nextT = ctx.currentTime + 0.08;
  if (ctx.state === 'suspended') ctx.resume();
  const self = this;
  this.timer = setInterval(function () { self._pump(); }, 25);
  this._pump();
  this._visual();
  this.playing = true;
  if (this.onState) this.onState(true);
};

LofiPlayer.prototype.stop = function () {
  if (this.timer) clearInterval(this.timer);
  this.timer = null;
  if (this.raf) cancelAnimationFrame(this.raf);
  this.raf = null;
  const ctx = this.ctx;
  this.ctx = null;
  if (this.voices) {
    this.voices.forEach(function (n) { try { n.stop(); } catch (e) {} });
    this.voices = [];
  }
  this.playing = false;
  if (this.onState) this.onState(false);
  if (ctx) setTimeout(function () { try { ctx.close(); } catch (e) {} }, 150);
};

LofiPlayer.prototype.toggle = function () {
  if (this.playing) this.stop(); else this.play();
};

LofiPlayer.prototype._pump = function () {
  if (!this.ctx) return;
  const stepDur = 60 / this.song.bpm / 4;
  let guard = 0;
  while (this.nextT < this.ctx.currentTime + 0.14 && guard++ < 32) {
    this._scheduleStep(this.step, this.nextT, stepDur);
    this.nextT += stepDur;
    this.step++;
  }
};

LofiPlayer.prototype._scheduleStep = function (step, t, stepDur) {
  const S = this.song, ctx = this.ctx;
  if (!ctx) return;
  const loopLen = LOOP_BARS * 16;
  const gstep = step % loopLen;
  const s16 = gstep % 16, bar = Math.floor(gstep / 16); // 0..7 melody bar
  const cbar = bar % S.chords.length; // 0..3 chord bar
  let tt = t;
  // Fixed MPC-style swing: off-beat 8ths sit late. No humanize — on repeat means on repeat.
  if (s16 % 4 === 2) tt += ((S.swing || 56) - 50) / 100 * 2 * stepDur;
  const barDur = stepDur * 16;

  if (s16 === 0) {
    this._pad(S.bass[cbar], tt, barDur);
    const name = S.chordNames[cbar], loop = Math.floor(step / loopLen) + 1, self = this;
    const dt = Math.max(0, (tt - ctx.currentTime) * 1000);
    setTimeout(function () { if (self.onBar) self.onBar(name, bar, loop); }, dt);
  }
  if ((S.chordHits || [0]).indexOf(s16) >= 0) {
    this._rhodes(S.chords[cbar], tt, barDur * (S.chordLen || 0.9));
    if (S.duck) this._pumpDuck(tt);
  }
  const hits = S.bassHits || [{ s: 0, len: 12 }];
  for (let i = 0; i < hits.length; i++) {
    if (hits[i].s === s16) {
      this._bass(_noteMidi(S.bass[cbar]) + (hits[i].semis || 0), tt, stepDur * (hits[i].len || 10));
    }
  }
  const kv = (S.kick || {})[s16];
  if (kv) { this._kick(tt, kv); if (S.duck) this._pumpDuck(tt); }
  const sv = (S.snare || {})[s16];
  if (sv) this._snare(tt, sv);
  const hv = (S.hat || {})[s16];
  if (hv) this._hat(tt, hv, s16, (S.openHat || []).indexOf(s16) >= 0);
  // Fixed composed melody — identical every loop.
  const mel = S.melody || [];
  for (let m = 0; m < mel.length; m++) {
    if (mel[m].b === bar && mel[m].s === s16) {
      this._lead(mel[m].n, tt, stepDur * (mel[m].l || 4), mel[m].v || 1);
    }
  }
  const pv = this.pops[gstep];
  if (pv) this._pop(tt, pv);
};

/* Electric piano: triangle body + octave shimmer + short tine ping. */
LofiPlayer.prototype._rhodes = function (notes, t, dur) {
  const S = this.song, ctx = this.ctx;
  const atk = S.attack || 0.025, peak = 0.15;
  for (let i = 0; i < notes.length; i++) {
    const f = _freq(_noteMidi(notes[i]));
    const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
    o1.detune.value = (i % 2 ? 4 : -4);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
    o2.detune.value = ((i % 3) - 1) * 3;
    const g2 = ctx.createGain(); g2.gain.value = 0.22;
    const tine = ctx.createOscillator(); tine.type = 'sine'; tine.frequency.value = f * 4.01;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.05, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = 750 + i * 160;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.setTargetAtTime(peak * 0.55, t + atk, Math.max(0.1, dur * 0.3));
    g.gain.setTargetAtTime(0.0001, t + dur, 0.12);
    o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(lp);
    tine.connect(tg); tg.connect(lp); lp.connect(this.chordBus);
    o1.start(t); o2.start(t); tine.start(t);
    o1.stop(t + dur + 0.9); o2.stop(t + dur + 0.9); tine.stop(t + 0.15);
  }
};

/* Warm root+fifth+octave pad swell under each bar — the glue. */
LofiPlayer.prototype._pad = function (bassNote, t, dur) {
  const ctx = this.ctx, root = _noteMidi(bassNote);
  const midis = [root, root + 7, root + 12];
  for (let i = 0; i < midis.length; i++) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = _freq(midis[i]);
    o.detune.value = (i % 2 ? 3 : -3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.5);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.9, 0.18);
    o.connect(g); g.connect(this.chordBus);
    o.start(t); o.stop(t + dur + 0.8);
  }
};

LofiPlayer.prototype._bass = function (midi, t, dur) {
  const ctx = this.ctx, f = _freq(midi);
  const o1 = ctx.createOscillator(); o1.type = 'sine';
  o1.frequency.setValueAtTime(f * 1.03, t);
  o1.frequency.exponentialRampToValueAtTime(f, t + 0.05);
  const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f;
  const g2 = ctx.createGain(); g2.gain.value = 0.3;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.32, t + 0.012);
  g.gain.setTargetAtTime(0.18, t + 0.02, Math.max(0.08, dur * 0.4));
  g.gain.setTargetAtTime(0.0001, t + dur, 0.09);
  o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(this.bus);
  o1.start(t); o2.start(t);
  o1.stop(t + dur + 0.6); o2.stop(t + dur + 0.6);
};

/* Kick: sub thump + fixed click transient. */
LofiPlayer.prototype._kick = function (t, v) {
  const ctx = this.ctx;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(160, t);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.9 * v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
  o.connect(g); g.connect(this.bus);
  o.start(t); o.stop(t + 0.3);
  const click = ctx.createBufferSource(); click.buffer = this.noiseBuf;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.22 * v, t);
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  click.connect(hp); hp.connect(cg); cg.connect(this.bus);
  click.start(t); click.stop(t + 0.06);
};

/* Snare: noise crack + 190Hz body + a breath of delay-room. */
LofiPlayer.prototype._snare = function (t, v) {
  const ctx = this.ctx;
  const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
  src.playbackRate.value = 1.0;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(v * 0.5, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  src.connect(bp); bp.connect(g); g.connect(this.bus);
  src.start(t); src.stop(t + 0.25);
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 190;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(v * 0.32, t);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  o.connect(g2); g2.connect(this.bus);
  const room = ctx.createGain(); room.gain.value = 0.07;
  g2.connect(room); room.connect(this.send);
  o.start(t); o.stop(t + 0.12);
};

LofiPlayer.prototype._hat = function (t, v, s16, open) {
  const ctx = this.ctx;
  const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
  src.playbackRate.value = 1.4;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass';
  hp.frequency.value = 7000 + (s16 % 2) * 1200;
  const g = ctx.createGain();
  const dec = open ? 0.32 : 0.045;
  g.gain.setValueAtTime(v * 0.26, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
  src.connect(hp); hp.connect(g); g.connect(this.bus);
  src.start(t); src.stop(t + dec + 0.05);
};

LofiPlayer.prototype._pop = function (t, v) {
  const ctx = this.ctx;
  if (!ctx) return;
  const o = ctx.createOscillator(); o.type = 'square';
  o.frequency.value = 2600;
  const g = ctx.createGain();
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.008);
  o.connect(g); g.connect(this.master);
  o.start(t); o.stop(t + 0.02);
};

/* Fixed lead voice: warm pluck with sustain for long notes. */
LofiPlayer.prototype._lead = function (note, t, dur, v) {
  const ctx = this.ctx, f = _freq(_noteMidi(note));
  const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
  const g2 = ctx.createGain(); g2.gain.value = 0.18;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.2 * v, t + 0.008);
  g.gain.setTargetAtTime(0.1 * v, t + 0.02, 0.22);
  g.gain.setTargetAtTime(0.0001, t + dur, 0.12);
  o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(lp);
  lp.connect(this.bus); lp.connect(this.send);
  o1.start(t); o2.start(t);
  o1.stop(t + dur + 0.8); o2.stop(t + dur + 0.8);
};

LofiPlayer.prototype._pumpDuck = function (t) {
  this.duck.gain.setValueAtTime(0.55, t);
  this.duck.gain.linearRampToValueAtTime(1.0, t + 0.28);
};

LofiPlayer.prototype._startVinyl = function (level) {
  const ctx = this.ctx, rand = this.rand;
  const len = 2 * ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = rand() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.2 + w * 0.012;
  }
  for (let k = 0; k < 14; k++) {
    const p = (rand() * len) | 0, amp = 0.08 + rand() * 0.2, dec = 30 + ((rand() * 120) | 0);
    const sign = rand() < 0.5 ? -1 : 1;
    for (let j = 0; j < dec && p + j < len; j++) d[p + j] += amp * (1 - j / dec) * sign;
  }
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 5200;
  const g = ctx.createGain(); g.gain.value = 0.02 + 0.16 * level;
  src.connect(f); f.connect(g); g.connect(this.bus);
  src.start();
  this.voices.push(src);
};

LofiPlayer.prototype._startRain = function (level) {
  const ctx = this.ctx;
  const src = ctx.createBufferSource(); src.buffer = _noiseBuffer(ctx, 3, this.rand); src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100;
  const g = ctx.createGain(); g.gain.value = 0.05 * level;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lg = ctx.createGain(); lg.gain.value = 0.018 * level;
  lfo.connect(lg); lg.connect(g.gain);
  src.connect(f); f.connect(g); g.connect(this.master);
  src.start(); lfo.start();
  this.voices.push(src); this.voices.push(lfo);
};

LofiPlayer.prototype._visual = function () {
  const canvas = this.canvas;
  if (!canvas || !this.analyser) return;
  const ctx2d = canvas.getContext('2d');
  const data = new Uint8Array(this.analyser.frequencyBinCount);
  const accent = (this.song && this.song.accent) || '#b3541e';
  const self = this;
  function frame() {
    if (!self.ctx) return;
    self.raf = requestAnimationFrame(frame);
    self.analyser.getByteFrequencyData(data);
    const w = canvas.width, h = canvas.height;
    ctx2d.clearRect(0, 0, w, h);
    const n = data.length, bw = w / n;
    for (let i = 0; i < n; i++) {
      const v = data[i] / 255, bh = Math.max(2, v * h);
      ctx2d.fillStyle = accent;
      ctx2d.globalAlpha = 0.35 + v * 0.65;
      ctx2d.fillRect(i * bw + 1, h - bh, Math.max(1, bw - 2), bh);
    }
    ctx2d.globalAlpha = 1;
  }
  frame();
};

/* Builds the demo page UI inside #player for a SONG config. */
function mountPlayer(SONG) {
  const root = document.getElementById('player');
  const accent = SONG.accent || '#b3541e';
  const style = document.createElement('style');
  style.textContent =
    'body{background:#f5f3ef;color:#26241f;font-family:"Segoe UI",system-ui,sans-serif;' +
    'display:flex;justify-content:center;padding:48px 16px;margin:0}' +
    '.card{width:520px;max-width:92vw;background:#fffdf8;border:1px solid #e3ddd1;' +
    'border-radius:14px;padding:28px 28px 24px;box-shadow:0 12px 40px rgba(60,50,35,.10)}' +
    '.kicker{font-size:11px;letter-spacing:.22em;color:' + accent + ';font-weight:700}' +
    'h1{font-size:30px;margin:6px 0 4px;font-weight:650}' +
    '.mood{color:#8a8474;font-size:14px;margin:0 0 16px;line-height:1.5}' +
    'canvas{width:100%;height:64px;background:#f5f3ef;border:1px solid #e8e2d4;border-radius:8px}' +
    '.row{display:flex;align-items:center;gap:12px;margin-top:16px}' +
    '#transport{flex:1;border:none;cursor:pointer;color:#fffdf8;font-size:15px;font-weight:650;' +
    'padding:12px;border-radius:10px;background:' + accent + '}' +
    '#transport:hover{filter:brightness(1.07)}' +
    '#chord{min-width:86px;text-align:center;font-weight:700;font-size:15px;' +
    'border:1px solid #e3ddd1;border-radius:10px;padding:11px 10px;background:#f5f3ef}' +
    '#loop{font-size:11px;color:#aaa294;letter-spacing:.18em;font-weight:700}' +
    '.meta{margin-top:14px;font-size:12.5px;color:#8a8474;line-height:1.7}' +
    '.meta b{color:#57503f}' +
    '.tip{margin-top:10px;font-size:12px;color:#aaa294}';
  document.head.appendChild(style);

  root.className = 'card';
  root.innerHTML =
    '<div class="kicker">LO-FI DEMO · ORIGINAL · FIXED LOOP</div><h1></h1><p class="mood"></p>' +
    '<canvas width="460" height="64"></canvas>' +
    '<div class="row"><button id="transport">▶&nbsp; Play</button><div id="chord">—</div></div>' +
    '<div class="row"><div id="loop">LOOP —</div></div>' +
    '<div class="meta"></div><div class="tip">Fixed loop — identical every time. Keep the tab visible for smooth timing.</div>';
  root.querySelector('h1').textContent = SONG.title;
  root.querySelector('.mood').textContent = SONG.mood;
  root.querySelector('.meta').innerHTML =
    '<b>Key</b> ' + SONG.key + ' &nbsp;·&nbsp; <b>Tempo</b> ' + SONG.bpm + ' BPM' +
    ' &nbsp;·&nbsp; <b>Swing</b> ' + (SONG.swing || 56) + '%<br><b>Progression</b> ' + SONG.progression;

  const player = new LofiPlayer(SONG);
  player.canvas = root.querySelector('canvas');
  const btn = root.querySelector('#transport');
  const badge = root.querySelector('#chord');
  const loopEl = root.querySelector('#loop');
  player.onBar = function (name, bar, loop) {
    badge.textContent = name;
    loopEl.textContent = 'LOOP ' + loop + ' · BAR ' + (bar + 1) + '/8';
  };
  player.onState = function (on) {
    btn.innerHTML = on ? '⏸&nbsp; Stop' : '▶&nbsp; Play';
    if (!on) { badge.textContent = '—'; loopEl.textContent = 'LOOP —'; }
  };
  btn.addEventListener('click', function () { player.toggle(); });
}
