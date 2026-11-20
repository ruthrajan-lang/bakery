// BakeryCritters: the customers, drawn entirely in code (like the koi) in the style of the character lineup:
// big round heads, small bean bodies with a light belly, stubby arms, little paw feet.
// Everything is vector, so they're crisp at any size, and floppy bits (ears, tufts, tails, arms) ride on springs.
(() => {
  const INK = '#5d5049', PI = Math.PI, S = Math.sin, TAU = PI*2;
  const SPECIES = {
    cat:      {body: '#fcd8bd', belly: '#fdeadb', blush: '#f9a9a6', feet: '#f6b39a', ear: '#f9b3b0', stripe: '#eda66b'},
    bunny:    {body: '#fffdf9', belly: '#fbeee0', blush: '#f9b4b4', feet: '#f6b8ae', ear: '#f7a9b2', nose: '#f7a9b2'},
    hedgehog: {body: '#fbe3c9', belly: '#f7d5bd', blush: '#f8a9a8', feet: '#f6b8ae', ear: '#f7b0ac', mane: '#b8877a'},
    bear:     {body: '#e3a87e', belly: '#fbe8d2', blush: '#f8a7a6', feet: '#f6b39a', ear: '#f7b0ac', muzzle: '#fbe8d2'},
    frog:     {body: '#bfe8b5', belly: '#fbf0d9', blush: '#f8a7a6', feet: '#bfe8b5'},
    duck:     {body: '#fdf0b4', belly: '#fbf0dc', blush: '#f9a9ab', feet: '#f6a868', beak: '#f6a868'},
  };
  // units: the character is 1000 tall from the feet (y = 0) to the top of the head
  const HR = 372, HV = 318, HCY = -680, BW = 248, BTOP = -420, LW = 14;
  const bob = x => (1 - Math.cos(x))/2;
  // each action: rock (rad), dy (units, − is up), arms al/ar (rad, + hangs, − raises), tilt (rad), face, steps, look (−1..1)
  const ACT = {
    idle: t => ({rock: .02*S(TAU*t*.5), al: .3 + .05*S(TAU*t*.5), ar: .3 - .05*S(TAU*t*.5), breathe: .015*S(TAU*t*.5), tilt: .03*S(TAU*t*.4)}),
    walk: t => { const s = S(TAU*t*1.6); return {sqk: .25, rock: .1*s, dy: -14*bob(TAU*t*3.2), al: .15 + .35*s, ar: .15 - .35*s, stepL: Math.max(0, s), stepR: Math.max(0, -s), tilt: -.04*s}; },
    wave: t => ({rock: .03*S(TAU*t*.8), al: .3, ar: -1.35 + .3*S(TAU*t*2.2), tilt: .08, look: .15}),
    hop: t => { const k = Math.max(0, S(TAU*t*.9)); return {dy: -170*k*k, al: -1*k, ar: -1*k, face: k > .4 ? 'joy' : 'happy'}; },
    cheer: t => ({dy: -50*bob(TAU*t*1.6), al: -1.7 + .2*S(TAU*t*3.2), ar: -1.7 - .2*S(TAU*t*3.2), face: 'joy'}),
    dance: t => { const s = S(TAU*t*.75); return {sqk: .3, rock: .15*s, dy: -18*bob(TAU*t*1.5), al: -.8 + .8*s, ar: -.8 - .8*s, face: 'joy', stepL: .5*Math.max(0, s), stepR: .5*Math.max(0, -s), tilt: -.1*s, look: .3*s}; },
    excited: t => { const s = S(TAU*t*3); return {dy: -26*bob(TAU*t*3), rock: .05*s, al: -1.2 + .5*s, ar: -1.2 - .5*s, face: 'joy'}; },
    impatient: t => ({rock: .03*S(TAU*t*2), stepR: Math.max(0, S(TAU*t*4))*.6, al: .5, ar: .5, face: 'cross', tilt: .05*S(TAU*t*2)}),
    bow: t => { const k = bob(TAU*Math.min(1, t*.8)); return {tilt: .3*k, rock: .08*k, al: .3, ar: .3, face: k > .5 ? 'shut' : 'happy'}; },
    doze: t => ({rock: .04*S(TAU*t*.3), al: .3, ar: .3, face: 'sleep', breathe: .03*S(TAU*t*.3), tilt: .14 + .04*S(TAU*t*.3)}),
    shy: t => ({rock: -.05 + .02*S(TAU*t*.6), al: .7, ar: .7, face: 'shy', look: -.4, tilt: -.13}),
    lookAround: t => { const l = S(TAU*t*.5); return {look: l*.9, tilt: .08*l, al: .2, ar: .2, face: Math.abs(l) < .2 ? 'shut' : 'happy'}; },
  };
  ACT.turn = ACT.lookAround; ACT.spin = ACT.dance; ACT.walkSide = ACT.walk; ACT.walkAway = ACT.walk; ACT.sleepy = ACT.doze; ACT.waddle = ACT.walk;

  const spring = (k, d) => ({x: 0, v: 0, step(target, dt) { this.v += ((target - this.x)*k - this.v*d)*dt; this.x += this.v*dt; return this.x; }});
  class Critter {
    constructor(kind) {
      this.kind = SPECIES[kind] ? kind : 'bear';
      this.s = {tuft: spring(140, 9), earL: spring(120, 8), earR: spring(110, 8), tail: spring(70, 6), armL: spring(130, 13), armR: spring(130, 13), y: spring(200, 16), rock: spring(120, 13), head: spring(80, 11), look: spring(60, 10)};
      this.blink = 0; this.next = 1 + Math.random()*3; this.prevDy = 0; this.poke = 0;
    }
    // draw doing `action` (time t in seconds) with the feet at (x, feet), `h` pixels tall; dir −1 faces left (looks that way)
    draw(g, action, t, dt, x, feet, h, dir = 0) {
      const p = (ACT[action] || ACT.idle)(t), k = this.kind, c = SPECIES[k], s = this.s; dt = Math.min(.05, Math.max(0, dt));
      const v = ((p.dy || 0) - this.prevDy)/Math.max(dt, .001); this.prevDy = p.dy || 0; this.poke = Math.max(0, this.poke - dt*1.6);
      const by = s.y.step(p.dy || 0, dt), rk = s.rock.step(p.rock || 0, dt), hd = s.head.step((p.tilt || 0) - rk*.35, dt);
      const sq = Math.max(-.1, Math.min(.08, -v*.0005))*(p.sqk ?? 1) + (p.breathe || 0) + S(t*26)*.05*this.poke*this.poke;
      const tf = s.tuft.step(-rk*1.5 - hd*.8 + v*.0008, dt), el = s.earL.step(-rk*1.3 - hd + v*.0009, dt), er = s.earR.step(-rk*1.3 - hd - v*.0009, dt), tl = s.tail.step(rk*2 + v*.0006, dt);
      const al = s.armL.step(p.al, dt), ar = s.armR.step(p.ar, dt), lk = s.look.step((p.look || 0) + dir*.35, dt);
      if ((this.next -= dt) < 0) { this.blink = .13; this.next = 2 + Math.random()*3; } this.blink = Math.max(0, this.blink - dt);
      if (this.giggle > 0) { this.giggle -= dt; p.face = 'joy'; p.rock = (p.rock || 0) + S(t*38)*.06*Math.min(1, this.giggle*2); }
      const face = p.face || 'happy', A = window.CRITTER_ART && CRITTER_ART[k]; if (!A) return {top: feet - h};
      const sc = h/950, ink = '#5d463a';
      if (!A._p) for (const q of A.parts) { q.O = new Path2D(q.o); q.F = new Path2D(q.f); q.D = q.d.map(([col, d]) => [col, new Path2D(d)]); q.K = q.k ? new Path2D(q.k) : null; } A._p = 1;
      const part = n => A.parts.find(q => q.n === n);
      const paint = (q, face2) => { g.fillStyle = ink; g.fill(q.O, 'evenodd'); g.fillStyle = q.fc; g.fill(q.F, 'evenodd');
        if (face2) { g.save(); g.clip(q.F, 'evenodd'); g.translate(face2.lx, 0); }
        for (const [col, d] of q.D) { g.fillStyle = col; g.fill(d, 'evenodd'); }
        if (q.K) { g.fillStyle = ink; g.fill(q.K, 'evenodd'); }
        if (face2) { face2.draw(q); g.restore(); } };
      const about = (q, ang, fn) => { g.save(); g.translate(q.piv[0], q.piv[1]); g.rotate(ang); g.translate(-q.piv[0], -q.piv[1]); fn(); g.restore(); };

      g.save(); g.translate(x, feet); g.scale(sc, sc);
      const air = Math.min(1, -by/200); g.fillStyle = `rgba(93,80,73,${.13*(1 - air*.6)})`; g.beginPath(); g.ellipse(0, 6, 230*(1 - air*.3), 26*(1 - air*.3), 0, 0, TAU); g.fill();
      g.translate(0, by); g.rotate(rk); g.scale(1 - sq*.7, 1 + sq);
      const REST = .3, armAng = {armL: -(al - REST)*.9, armR: (ar - REST)*.9};
      let q;
      if ((q = part('mane'))) about(q, hd*.25, () => paint(q));
      if ((q = part('tail'))) about(q, tl*.5, () => paint(q));
      for (const n of ['armL', 'armR']) if ((q = part(n))) {   // arms: soft rounded nubs at the traced size, colour and line weight, hinged at the shoulder
        const sd = n === 'armL' ? -1 : 1, [cw, ch] = q.cap, Wd = cw*1.02, L = ch*1.12;
        g.save(); g.translate(q.piv[0] + sd*cw*.22, q.piv[1] + ch*.05); g.rotate(-sd*.3 + armAng[n]);
        g.beginPath(); g.roundRect(-Wd/2, -L*.22, Wd, L, Wd/2);
        g.fillStyle = q.fc; g.fill(); g.lineWidth = A.lw; g.strokeStyle = ink; g.stroke();
        g.restore(); }
      if ((q = part('body'))) paint(q);
      for (const [n, st] of [['footL', p.stepL || 0], ['footR', p.stepR || 0]]) if ((q = part(n))) { g.save(); g.translate(0, -st*34); paint(q); g.restore(); }
      if ((q = part('tuft'))) { const hq = part('head'); about(hq, hd, () => about(q, tf*.5, () => paint(q))); }
      if ((q = part('head'))) about(q, hd, () => paint(q, {lx: lk*26, draw: hq => {   // expressions drawn over the traced eyes
        if (face === 'happy' && this.blink <= 0 || face === 'cross' || face === 'shy') return;
        for (const [ex, ey, r] of hq.eyes) {
          g.fillStyle = hq.fc; g.beginPath(); g.ellipse(ex, ey, r*1.35, r*1.35, 0, 0, TAU); g.fill();
          g.strokeStyle = ink; g.lineWidth = r*.42; g.lineCap = 'round'; g.beginPath();
          if (face === 'joy') { g.moveTo(ex - r*1.05, ey + r*.35); g.quadraticCurveTo(ex, ey - r*1.1, ex + r*1.05, ey + r*.35); }
          else { g.moveTo(ex - r*1.05, ey - r*.1); g.quadraticCurveTo(ex, ey + r*.75, ex + r*1.05, ey - r*.1); }
          g.stroke(); }
      }}));
      g.restore();
      return {top: feet - h*(1 + (by < 0 ? -by/1000 : 0))};
    }
  }
  window.BakeryCritters = {Critter, SPECIES: Object.keys(SPECIES), ACTIONS: Object.keys(ACT)};
})();
