// BakeryMusic: original, gentle pieces played live with Web Audio (no files). Quiet by design.
// Each track: tempo, meter, chord progression (one chord per bar), melody per bar ([beat, note, beats]), and a timbre.
(() => {
  const mid = n => 440*Math.pow(2, (n - 69)/12);
  const TRACKS = {
    waltz: {name: 'Morning Waltz', desc: 'A warm little waltz for opening the shop', bpm: 84, beats: 3, hours: 0, tone: 'piano',
      ch: [[53, 57, 60], [57, 60, 64], [58, 62, 65], [60, 64, 67], [62, 65, 69], [58, 62, 65], [57, 60, 65], [60, 64, 67], [58, 62, 65], [60, 64, 67], [57, 60, 64], [62, 65, 69], [55, 58, 62], [60, 64, 67], [53, 57, 60], [53, 57, 60]],
      mel: [[[0, 72, 2], [2, 74, 1]], [[0, 76, 2], [2, 72, 1]], [[0, 74, 1.5], [1.5, 72, .5], [2, 70, 1]], [[0, 72, 3]], [[0, 69, 2], [2, 72, 1]], [[0, 74, 2], [2, 77, 1]], [[0, 76, 1], [1, 74, 1], [2, 72, 1]], [[0, 76, 3]],
            [[0, 77, 2], [2, 76, 1]], [[0, 74, 1.5], [1.5, 72, 1.5]], [[0, 72, 1], [1, 69, 2]], null, [[0, 70, 2], [2, 72, 1]], [[0, 74, 1], [1, 76, 1], [2, 79, 1]], [[0, 77, 3]], null]},
    rain: {name: 'Rainy Window', desc: 'Soft and wistful, for grey afternoons', bpm: 66, beats: 4, hours: 2, tone: 'box', rain: true,
      ch: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]],
      mel: [[[0, 76, 1.5], [1.5, 74, .5], [2, 72, 2]], [[0, 69, 3]], [[0, 72, 1], [1, 74, 1], [2, 76, 2]], [[0, 74, 4]], [[0, 76, 1], [1, 79, 1], [2, 77, 1], [3, 76, 1]], [[0, 72, 3]], [[0, 74, 1.5], [1.5, 72, .5], [2, 71, 2]], null]},
    lantern: {name: 'Lantern Night', desc: 'A sleepy lullaby under string lights', bpm: 58, beats: 3, hours: 5, tone: 'box',
      ch: [[50, 57, 62], [55, 59, 62], [52, 55, 59], [57, 61, 64], [50, 57, 62], [47, 50, 55], [55, 59, 62], [57, 61, 64]],
      mel: [[[0, 74, 2], [2, 78, 1]], [[0, 79, 3]], [[0, 76, 2], [2, 74, 1]], [[0, 73, 3]], [[0, 74, 1], [1, 76, 1], [2, 78, 1]], [[0, 79, 2], [2, 81, 1]], [[0, 79, 1.5], [1.5, 78, 1.5]], null]},
    picnic: {name: 'Meadow Picnic', desc: 'A bouncy tune for sunny days with friends', bpm: 104, beats: 4, hours: 10, tone: 'pluck',
      ch: [[55, 59, 62], [52, 55, 59], [48, 52, 55], [50, 54, 57], [55, 59, 62], [52, 55, 59], [48, 52, 55], [50, 54, 57]],
      mel: [[[0, 79, 1], [1, 81, 1], [2, 83, 1], [3, 79, 1]], [[0, 76, 2], [2, 79, 2]], [[0, 76, 1], [1, 74, 1], [2, 72, 2]], [[0, 74, 3]], [[0, 79, 1], [1, 83, 1], [2, 86, 2]], [[0, 84, 1], [1, 83, 1], [2, 79, 2]], [[0, 76, 1], [1, 78, 1], [2, 79, 1], [3, 81, 1]], [[0, 79, 4]]]},
  };
  let ctx = null, out = null, pad = null, timer = null, next = 0, step = 0, on = false, bar = 0, T = TRACKS.waltz, rainNode = null;
  function voice(type, f, t, dur, vol, attack = .02, release = .6, dest = out) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.setTargetAtTime(0, t + Math.max(attack, dur - .05), release/3);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + release*2);
  }
  function lead(f, t, dur, vol) {
    if (T.tone === 'box') { voice('sine', f*2, t, dur*.5, vol*.8, .004, 1.8); voice('sine', f*4, t, dur*.2, vol*.12, .003, .6); }   // music box
    else if (T.tone === 'pluck') { voice('triangle', f, t, dur*.4, vol*.9, .005, .4); voice('sine', f*2, t, dur*.2, vol*.2, .004, .3); }
    else { voice('sine', f, t, dur, vol, .008, 1.4); voice('sine', f*2, t, dur*.4, vol*.18, .005, .5); voice('triangle', f, t, dur*.6, vol*.12, .01, .8); }   // soft piano
  }
  function schedule() {
    const BEAT = 60/T.bpm, n = T.ch.length;
    while (next < ctx.currentTime + .25) {
      const b = bar % n, beat = step % T.beats, t = next, ch = T.ch[b], vary = Math.floor(bar/n) % 2;
      if (beat === 0) {
        for (const x of ch) voice('triangle', mid(x), t, BEAT*T.beats, .026, .5, 1.6, pad);
        voice('sine', mid(ch[0] - 12), t, BEAT*Math.min(2.2, T.beats - .5), .085, .02, .9);
        for (const [at, x, len] of T.mel[b] || []) lead(mid(x + (vary && x > 76 ? -12 : 0)), t + at*BEAT, len*BEAT, .065);
      } else if (T.beats === 3 || beat === 2) voice('sine', mid(ch[1 + beat % 2]), t, BEAT*.8, .02, .01, .5);
      next += BEAT; step++; if (step % T.beats === 0) bar++;
    }
  }
  function startRain() {   // gentle filtered noise for the rainy track
    const len = ctx.sampleRate*2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random()*2 - 1)*.5;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); src.buffer = buf; src.loop = true;
    f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = .6; g.gain.value = .05; src.connect(f).connect(g).connect(out); src.start(); rainNode = src;
  }
  function start(audioCtx, id) {
    if (on && (!id || TRACKS[id] === T)) return;
    if (on) stop(true);
    ctx = audioCtx; on = true; T = TRACKS[id] || T;
    out = ctx.createGain(); out.gain.value = 0; out.connect(ctx.destination); out.gain.setTargetAtTime(.55, ctx.currentTime, 1.2);
    pad = ctx.createBiquadFilter(); pad.type = 'lowpass'; pad.frequency.value = 900; pad.connect(out);
    if (T.rain) startRain();
    next = ctx.currentTime + .1; step = 0; bar = 0; timer = setInterval(schedule, 60); schedule();
  }
  function stop(fast) {
    if (!on) return; on = false; clearInterval(timer);
    const o = out, r = rainNode; rainNode = null; o.gain.setTargetAtTime(0, ctx.currentTime, fast ? .15 : .4); setTimeout(() => { try { r && r.stop(); } catch (e) {} o.disconnect(); }, fast ? 800 : 2500);
  }
  window.BakeryMusic = {start, stop, TRACKS, get on() { return on; }, get track() { return Object.keys(TRACKS).find(k => TRACKS[k] === T); }};
})();
