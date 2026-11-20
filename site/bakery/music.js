// BakeryMusic: an original, gentle waltz played live with Web Audio (no files).
// Warm pad + soft music-box/piano melody + low bass, in F major, ~84 bpm, looping through a few phrases
// with small variations so it doesn't feel repetitive. Quiet by design.
(() => {
  let ctx = null, out = null, timer = null, next = 0, step = 0, on = false, bar = 0;
  const BPM = 84, BEAT = 60/BPM, LOOK = .25;
  const mid = n => 440*Math.pow(2, (n - 69)/12);
  // chord progression (one chord per 3/4 bar): F  Am  Bb  C | Dm  Bb  F/A  C | Bb  C  Am  Dm | Gm  C  F  F
  const CH = [[53, 57, 60], [57, 60, 64], [58, 62, 65], [60, 64, 67], [62, 65, 69], [58, 62, 65], [57, 60, 65], [60, 64, 67],
              [58, 62, 65], [60, 64, 67], [57, 60, 64], [62, 65, 69], [55, 58, 62], [60, 64, 67], [53, 57, 60], [53, 57, 60]];
  // melody per bar: [beat, note, beats long]; null bars rest so it breathes
  const MEL = [
    [[0, 72, 2], [2, 74, 1]], [[0, 76, 2], [2, 72, 1]], [[0, 74, 1.5], [1.5, 72, .5], [2, 70, 1]], [[0, 72, 3]],
    [[0, 69, 2], [2, 72, 1]], [[0, 74, 2], [2, 77, 1]], [[0, 76, 1], [1, 74, 1], [2, 72, 1]], [[0, 76, 3]],
    [[0, 77, 2], [2, 76, 1]], [[0, 74, 1.5], [1.5, 72, 1.5]], [[0, 72, 1], [1, 69, 2]], null,
    [[0, 70, 2], [2, 72, 1]], [[0, 74, 1], [1, 76, 1], [2, 79, 1]], [[0, 77, 3]], null];
  function voice(type, f, t, dur, vol, attack = .02, release = .6, dest = out) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.setTargetAtTime(0, t + Math.max(attack, dur - .05), release/3);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + release*2);
  }
  function bell(f, t, dur, vol) {   // soft piano/music-box: a sine with a quiet octave and quick decay
    voice('sine', f, t, dur, vol, .008, 1.4); voice('sine', f*2, t, dur*.4, vol*.18, .005, .5); voice('triangle', f, t, dur*.6, vol*.12, .01, .8);
  }
  function schedule() {
    while (next < ctx.currentTime + LOOK) {
      const b = bar % 16, beat = step % 3, t = next, ch = CH[b], vary = Math.floor(bar/16) % 2;
      if (beat === 0) {
        for (const n of ch) voice('triangle', mid(n), t, BEAT*3, .028, .5, 1.6, pad);   // pad swells in
        voice('sine', mid(ch[0] - 12), t, BEAT*2.2, .09, .02, .9);                      // bass on 1
        for (const [at, n, len] of MEL[b] || []) bell(mid(n + (vary && n > 74 ? -12 : 0)), t + at*BEAT, len*BEAT, .07);
      } else voice('sine', mid(ch[1 + (beat - 1) % 2]), t, BEAT*.8, .022, .01, .5);    // waltz "pah pah"
      next += BEAT; step++; if (step % 3 === 0) bar++;
    }
  }
  let pad;
  function start(audioCtx) {
    if (on) return; ctx = audioCtx; on = true;
    out = ctx.createGain(); out.gain.value = 0; out.connect(ctx.destination); out.gain.setTargetAtTime(.55, ctx.currentTime, 1.2);   // fade in
    pad = ctx.createBiquadFilter(); pad.type = 'lowpass'; pad.frequency.value = 900; pad.connect(out);
    next = ctx.currentTime + .1; step = 0; bar = 0; timer = setInterval(schedule, 60); schedule();
  }
  function stop() {
    if (!on) return; on = false; clearInterval(timer);
    const o = out; o.gain.setTargetAtTime(0, ctx.currentTime, .4); setTimeout(() => o.disconnect(), 2500);
  }
  window.BakeryMusic = {start, stop, get on() { return on; }};
})();
