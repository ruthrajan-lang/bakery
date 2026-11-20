// Character rig: one character sheet (T-pose body + face variants, transparent or plain background)
// is cut into parts (head, torso, arms, legs) and played through a library of actions.
// Face order on the sheet, left to right: happy, blink, impatient, delighted.
(function () {
  const FACE = {happy:0, blink:1, impatient:2, delighted:3};

  // ---------- 1. find the separate shapes on the sheet ----------
  function maskOf(cv, keyRGB, tol) {
    const g = cv.getContext('2d'), d = g.getImageData(0, 0, cv.width, cv.height).data, m = new Uint8Array(cv.width*cv.height);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      if (keyRGB) m[p] = Math.hypot(d[i] - keyRGB[0], d[i + 1] - keyRGB[1], d[i + 2] - keyRGB[2]) > tol && d[i + 3] > 40 ? 1 : 0;
      else m[p] = d[i + 3] > 6 ? 1 : 0;   // keep the soft anti-aliased edge with its shape
    }
    return m;
  }
  function components(m, w, h) {
    const lab = new Int32Array(w*h), out = []; let n = 0; const st = [];
    for (let s = 0; s < w*h; s++) {
      if (!m[s] || lab[s]) continue;
      n++; let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0; st.push(s); lab[s] = n;
      while (st.length) {
        const p = st.pop(), x = p % w, y = (p/w)|0; area++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const q of [p - 1, p + 1, p - w, p + w]) if (q >= 0 && q < w*h && m[q] && !lab[q] && Math.abs((q % w) - x) <= 1) { lab[q] = n; st.push(q); }
      }
      out.push({id:n, area, box:[x0, y0, x1 + 1, y1 + 1]});
    }
    return {lab, comps:out.filter(c => c.area > 400)};
  }
  // copy one labelled shape (or a pixel test within it) into its own canvas
  // thin the dark outline from the outside (a min-filter on alpha over dark pixels keeps the edge smooth),
  // so customers' lines match Bingsu's at game size
  const THIN = {px:0, w:0};
  // even line weight: every ink line loses the same amount from BOTH sides (eyes, mouths and other small
  // features are left alone), and faint specks floating outside the shape are cleared
  function thinInk(d, w, h, W) {
    const N = w*h, ink = new Uint8Array(N), dist = new Float32Array(N), D = 1.4142;
    for (let p = 0; p < N; p++) { const i = p*4; ink[p] = d[i + 3] > 0 && d[i] + d[i + 1] + d[i + 2] < 330 ? 1 : 0; dist[p] = ink[p] ? 1e9 : 0; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y*w + x; if (!ink[p]) continue; let m = dist[p];   // chamfer distance to the nearest non-ink pixel
      m = Math.min(m, x > 0 ? dist[p - 1] + 1 : 1, y > 0 ? dist[p - w] + 1 : 1, x > 0 && y > 0 ? dist[p - w - 1] + D : 1, x < w - 1 && y > 0 ? dist[p - w + 1] + D : 1); dist[p] = m; }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const p = y*w + x; if (!ink[p]) continue; let m = dist[p];
      m = Math.min(m, x < w - 1 ? dist[p + 1] + 1 : 1, y < h - 1 ? dist[p + w] + 1 : 1, x < w - 1 && y < h - 1 ? dist[p + w + 1] + D : 1, x > 0 && y < h - 1 ? dist[p + w - 1] + D : 1); dist[p] = m; }
    const R = Math.ceil(W*.6) + 1, tmp = new Float32Array(N), lm = new Float32Array(N);   // local half-width of the line each pixel belongs to
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.max(0, x - R); k <= Math.min(w - 1, x + R); k++) m = Math.max(m, dist[y*w + k]); tmp[y*w + x] = m; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.max(0, y - R); k <= Math.min(h - 1, y + R); k++) m = Math.max(m, tmp[k*w + x]); lm[y*w + x] = m; }
    const T = .2*W, big = .75*W, kill = new Uint8Array(N); let todo = 0;
    for (let p = 0; p < N; p++) if (ink[p] && lm[p] <= big && dist[p] <= lm[p] - T) { kill[p] = 1; todo++; }
    const done = new Uint8Array(N), nb = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1];
    for (let sweep = 0; sweep < 12 && todo; sweep++) {   // peel from the edges inward, taking the colour next door (fill inside, clear outside)
      const now = [];
      for (let p = 0; p < N; p++) { if (!kill[p] || done[p]) continue; const x = p % w;
        for (const o of nb) { const q = p + o; if (q < 0 || q >= N || Math.abs((q % w) - x) > 1) continue; if ((!ink[q] || done[q]) && !(kill[q] && !done[q])) { now.push([p, q]); break; } } }
      if (!now.length) break;
      for (const [p, q] of now) { const i = p*4, j = q*4; if (d[j + 3] < 8) d[i + 3] = 0; else { d[i] = d[j]; d[i + 1] = d[j + 1]; d[i + 2] = d[j + 2]; d[i + 3] = d[j + 3]; } done[p] = 1; todo--; }
    }
    for (let p = 0; p < N; p++) { const i = p*4; if (!d[i + 3] || d[i + 3] > 110) continue; const x = p % w; let solid = false;   // clear fuzz
      for (const o of nb) { const q = p + o; if (q >= 0 && q < N && Math.abs((q % w) - x) <= 1 && d[q*4 + 3] > 200) { solid = true; break; } }
      if (!solid) d[i + 3] = 0; }
    for (let p = 0; p < N; p++) { const i = p*4; if (d[i + 3] < 200 || !ink[p] || done[p]) continue; const x = p % w;   // soften the new outer edge
      for (const o of [-1, 1, -w, w]) { const q = p + o; if (q >= 0 && q < N && Math.abs((q % w) - x) <= 1 && d[q*4 + 3] === 0) { d[i + 3] = 170; break; } } }
  }
  function thinOutline(d, w, h, passes) {
    const dark = i => d[i] + d[i + 1] + d[i + 2] < 330;   // the ink line only, not dark fur (Hazel's spikes)
    for (let n = 0; n < passes; n++) {
      const a = new Uint8Array(w*h); for (let i = 0; i < w*h; i++) a[i] = d[i*4 + 3];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = y*w + x; if (!a[p] || !dark(p*4)) continue;
        let m = a[p];
        if (x > 0 && a[p - 1] < m) m = a[p - 1]; if (x < w - 1 && a[p + 1] < m) m = a[p + 1];
        if (y > 0 && a[p - w] < m) m = a[p - w]; if (y < h - 1 && a[p + w] < m) m = a[p + w];
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) m = 0;
        d[p*4 + 3] = m;
      }
    }
  }
  // outline thickness of a sheet: dark run at the left edge of the biggest shape's middle row
  function outlineWidth(sheet, comp) {
    const [x0, y0, x1, y1] = comp.box, y = (y0 + y1) >> 1, d = sheet.getContext('2d').getImageData(x0, y, x1 - x0, 1).data; let n = 0, on = false;
    for (let i = 0; i < d.length; i += 4) { const dk = d[i + 3] > 128 && d[i] + d[i + 1] + d[i + 2] < 330; if (dk) { n++; on = true; } else if (on) break; }
    return Math.min(n, 12);   // a solid dark shape isn't an outline
  }
  function extract(src, lab, id, box, test) {
    const [x0, y0, x1, y1] = box, w = x1 - x0, h = y1 - y0, c = document.createElement('canvas'); c.width = w; c.height = h;
    const sd = src.getContext('2d').getImageData(x0, y0, w, h), d = sd.data, W = src.width;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y*w + x)*4; if (lab[(y + y0)*W + x + x0] !== id || (test && !test(x + x0, y + y0))) d[i + 3] = 0; }
    if (THIN.w) thinInk(d, w, h, THIN.w);
    c.getContext('2d').putImageData(sd, 0, 0); return c;
  }

  // ---------- 2. split the T-pose body into parts ----------
  function rigFromSheet(sheet, keyRGB, tol) {
    const W = sheet.width, H = sheet.height, m = maskOf(sheet, keyRGB, tol), {lab, comps} = components(m, W, H);
    if (!comps.length) return null;
    comps.sort((a, b) => b.area - a.area);
    THIN.w = outlineWidth(sheet, comps[0]);
    const body = comps[0], faces = comps.slice(1).filter(c => c.area > body.area*.08).sort((a, b) => a.box[0] - b.box[0]).slice(0, 4);
    const [bx0, by0, bx1, by1] = body.box, bh = by1 - by0, bw = bx1 - bx0;
    const inBody = (x, y) => lab[y*W + x] === body.id;
    const runs = y => { const r = []; let s = -1; for (let x = bx0; x <= bx1; x++) { const on = x < bx1 && inBody(x, y); if (on && s < 0) s = x; if (!on && s >= 0) { r.push([s, x]); s = -1; } } return r; };
    const width = y => { const r = runs(y); return r.length ? r[r.length - 1][1] - r[0][0] : 0; };
    // legs: from the bottom up, rows where the body splits into two runs
    let crotch = by1 - 1, legGap = (bx0 + bx1)/2;
    for (let y = by1 - 2; y > by0 + bh*.5; y--) { const r = runs(y); if (r.length >= 2) { crotch = y; legGap = (r[0][1] + r[r.length - 1][0])/2; } else if (crotch < by1 - 4) break; }
    // torso extents just above the legs
    const ty = Math.max(by0, crotch - Math.round(bh*.08)), tr = runs(ty), tx0 = tr.length ? tr[0][0] : bx0, tx1 = tr.length ? tr[tr.length - 1][1] : bx1, tw = tx1 - tx0;
    // arms: the widest rows (the outstretched arms), grown up and down while still wider than the torso
    let armY = by0, best = 0;
    for (let y = by0 + Math.round(bh*.25); y < crotch; y++) { const wd = width(y); if (wd > best) { best = wd; armY = y; } }
    let a0 = armY, a1 = armY;
    while (a0 > by0 && width(a0 - 1) > tw*1.12) a0--;
    while (a1 < crotch && width(a1 + 1) > tw*1.12) a1++;
    // neck: narrowest row between the top third and the arms
    let neck = a0 - 2, nw = 1e9;
    for (let y = by0 + Math.round(bh*.3); y < a0 - 2; y++) { const wd = width(y); if (wd > 0 && wd < nw) { nw = wd; neck = y; } }
    const shoulderL = [tx0 + tw*.08, (a0 + a1)/2], shoulderR = [tx1 - tw*.08, (a0 + a1)/2];
    const armL = (x, y) => y >= a0 - 3 && y <= a1 + 3 && x < tx0 + tw*.12, armR = (x, y) => y >= a0 - 3 && y <= a1 + 3 && x > tx1 - tw*.12;
    const legL = (x, y) => y > crotch - 6 && x < legGap, legR = (x, y) => y > crotch - 6 && x >= legGap;
    const head = (x, y) => y < neck + 4;
    const torso = (x, y) => y >= neck - 2 && !(y >= a0 - 5 && y <= a1 + 5 && (x < tx0 || x > tx1)) && y <= crotch + 4;
    // outline colour and thickness, read off the torso's left edge, to close the body where the arms were cut away
    const sd = sheet.getContext('2d').getImageData(tx0, ty, Math.max(1, Math.round(tw/4)), 1).data; let ow = 0, oc = [93, 80, 73];
    for (let i = 0; i < sd.length; i += 4) { if (sd[i] + sd[i + 1] + sd[i + 2] < 400) { ow++; if (ow === 1) oc = [sd[i], sd[i + 1], sd[i + 2]]; } else if (ow) break; }
    // where each side of the torso meets the arm rows, just above and below them
    const edgeX = (y, left) => { const r = runs(y); if (!r.length) return left ? tx0 : tx1; if (left) { for (const q of r) if (q[1] > tx0) return Math.max(q[0], tx0 - tw*.04); return tx0; } for (let i = r.length - 1; i >= 0; i--) if (r[i][0] < tx1) return Math.min(r[i][1], tx1 + tw*.04); return tx1; };
    const part = (test, pivot) => ({img:extract(sheet, lab, body.id, body.box, test), pivot:[pivot[0] - bx0, pivot[1] - by0]});
    const r = {
      w:bw, h:bh, crotch:crotch - by0, neck:neck - by0,
      parts:{
        legL:part(legL, [(tx0 + legGap)/2, crotch]), legR:part(legR, [(legGap + tx1)/2, crotch]),
        armL:part(armL, shoulderL), armR:part(armR, shoulderR),
        torso:part(torso, [(bx0 + bx1)/2, crotch]), head:part(head, [(bx0 + bx1)/2, neck])
      },
      faces:faces.map(f => extract(sheet, lab, f.id, f.box)), headBox:null,
      outline:{w:Math.max(2, ow), c:`rgb(${oc.join(',')})`, L:[[edgeX(a0 - 6, true) - bx0, a0 - 6 - by0], [edgeX(a1 + 6, true) - bx0, a1 + 6 - by0]], R:[[edgeX(a0 - 6, false) - bx0, a0 - 6 - by0], [edgeX(a1 + 6, false) - bx0, a1 + 6 - by0]]}
    };
    // head bounding box (to line the face variants up with it)
    let hx0 = 1e9, hx1 = -1, hy0 = 1e9;
    for (let y = by0; y < neck; y++) { const rr = runs(y); if (rr.length) { hx0 = Math.min(hx0, rr[0][0]); hx1 = Math.max(hx1, rr[rr.length - 1][1]); hy0 = Math.min(hy0, y); } }
    r.headBox = [hx0 - bx0, hy0 - by0, hx1 - bx0, neck - by0];
    return r;
  }

  // ---------- 3. actions: each returns the pose at time t (0..1 loop) ----------
  // arm angles in degrees: 0 = straight out (T-pose), + = down, - = up.  legs: + = outward
  const S = Math.sin, PI = Math.PI;
  const ACTIONS = {
    idle:     t => ({arm:[62 + 3*S(2*PI*t), 62 + 3*S(2*PI*t)], breathe:.025*S(2*PI*t), face:(t > .82 && t < .9) ? 'blink' : 'happy'}),
    wave:     t => ({arm:[64, -55 + 28*S(4*PI*t)], head:5*S(2*PI*t), face:'happy', breathe:.015*S(2*PI*t)}),
    walk:     t => ({leg:[18*S(2*PI*t), -18*S(2*PI*t)], arm:[60 + 18*S(2*PI*t), 60 - 18*S(2*PI*t)], dy:-.035*Math.abs(S(2*PI*t)), lean:3*S(2*PI*t), face:'happy'}),
    cheer:    t => ({arm:[-32 + 14*S(4*PI*t), -32 + 14*S(4*PI*t)], dy:-.13*Math.abs(S(2*PI*t)), leg:[8, 8], face:'delighted'}),
    hop:      t => { const k = Math.abs(S(2*PI*t)); return {arm:[50 - 40*k, 50 - 40*k], dy:-.18*k, breathe:-.04*(1 - k) + .03*k, leg:[6*k, 6*k], face:k > .5 ? 'delighted' : 'happy'}; },
    impatient:t => ({arm:[78, 78], leg:[0, -14*Math.max(0, S(8*PI*t))], head:3*S(4*PI*t), face:'impatient'}),
    bow:      t => { const k = Math.max(0, S(2*PI*t)); return {arm:[72, 72], lean:0, head:16*k, dy:.02*k, breathe:-.03*k, face:k > .5 ? 'blink' : 'happy'}; },
    dance:    t => ({arm:[30 + 60*S(4*PI*t), 30 - 60*S(4*PI*t)], lean:9*S(2*PI*t), leg:[10*S(4*PI*t), -10*S(4*PI*t)], dy:-.05*Math.abs(S(4*PI*t)), face:'delighted'}),
    doze:     t => ({arm:[74, 74], head:12 + 3*S(2*PI*t), lean:2*S(2*PI*t), breathe:.03*S(2*PI*t), face:'blink'}),
    excited:  t => ({arm:[20 + 45*S(8*PI*t), 20 - 45*S(8*PI*t)], dy:-.03*Math.abs(S(8*PI*t)), face:'delighted'})
  };

  // ---------- 4. draw one frame ----------
  function drawPose(rig, pose, g, W, H) {
    const {w, h, parts:P} = rig, sc = Math.min(W/(w*1.7), H/(h*1.45)), feetY = H*.9;
    g.save(); g.translate(W/2, feetY + (pose.dy || 0)*h*sc); g.scale(sc, sc);
    const br = pose.breathe || 0; g.scale(1 - br*.5, 1 + br); g.translate(-w/2, -h);
    g.translate(w/2, rig.crotch); g.rotate((pose.lean || 0)*PI/180); g.translate(-w/2, -rig.crotch);
    const limb = (p, deg) => { g.save(); g.translate(p.pivot[0], p.pivot[1]); g.rotate(deg*PI/180); g.translate(-p.pivot[0], -p.pivot[1]); g.drawImage(p.img, 0, 0); g.restore(); };
    const leg = pose.leg || [0, 0], arm = pose.arm || [62, 62];
    limb(P.legL, leg[0]); limb(P.legR, -leg[1]);
    limb(P.armL, -arm[0]); limb(P.armR, arm[1]);
    g.drawImage(P.torso.img, 0, 0);
    // close the torso's sides where the arms were cut off (arms tuck in behind this line)
    const o = rig.outline; g.strokeStyle = o.c; g.lineWidth = o.w; g.lineCap = 'round';
    for (const [p0, p1] of [o.L, o.R]) { const bulge = (p0[0] < rig.w/2 ? -1 : 1)*o.w*1.5; g.beginPath(); g.moveTo(p0[0] - (p0[0] < rig.w/2 ? -o.w/2 : o.w/2), p0[1]); g.quadraticCurveTo((p0[0] + p1[0])/2 + bulge, (p0[1] + p1[1])/2, p1[0] - (p0[0] < rig.w/2 ? -o.w/2 : o.w/2), p1[1]); g.stroke(); }
    // head: the matching face variant (or the body's own head), tilted around the neck
    g.save(); g.translate(P.head.pivot[0], P.head.pivot[1]); g.rotate((pose.head || 0)*PI/180); g.translate(-P.head.pivot[0], -P.head.pivot[1]);
    const f = rig.faces[FACE[pose.face || 'happy']] || null;
    if (f) { const [x0, y0, x1] = rig.headBox, fw = x1 - x0, fh = fw*f.height/f.width; g.drawImage(f, x0, y0 - 2, fw, fh); }
    else g.drawImage(P.head.img, 0, 0);
    g.restore(); g.restore();
  }
  function framesFor(rig, action, n, size) {
    const fn = ACTIONS[action], out = [];
    for (let i = 0; i < n; i++) { const c = document.createElement('canvas'); c.width = size; c.height = size; drawPose(rig, fn(i/n), c.getContext('2d'), size, size); out.push(c); }
    return out;
  }

  // ================= parts sheets: every part drawn separately, in rows (front / side / back) =================
  // Row 1 FRONT: 4 heads (happy, blink, impatient, delighted), torso, left arm, right arm, left leg, right leg
  // Row 2 SIDE (facing right): 3 heads (happy, blink, delighted), torso, near arm, far arm, near leg, far leg
  // Row 3 BACK: head, torso, left arm, right arm, left leg, right leg
  // soften the shoulder end of an arm: the ink line across its top turns into the arm's own colour,
  // so where it overlaps the body it reads as one shape instead of a sticker
  function openCap(c, frac = .34) {
    const g = c.getContext('2d'), w = c.width, h = c.height, im = g.getImageData(0, 0, w, h), d = im.data;
    const fills = []; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] + d[i + 1] + d[i + 2] > 430) fills.push(i);
    if (!fills.length) return c;
    const mid = fills.sort((a, b) => (d[a] + d[a + 1] + d[a + 2]) - (d[b] + d[b + 1] + d[b + 2]))[fills.length >> 1], F = [d[mid], d[mid + 1], d[mid + 2]];
    const cap = h*frac, fade = h*.12;
    for (let y = 0; y < Math.min(h, cap + fade); y++) {
      const k = y < cap ? 1 : 1 - (y - cap)/fade;
      for (let x = 0; x < w; x++) { const i = (y*w + x)*4; if (!d[i + 3] || d[i] + d[i + 1] + d[i + 2] > 500) continue;
        for (let n = 0; n < 3; n++) d[i + n] = Math.round(d[i + n] + (F[n] - d[i + n])*k); }
    }
    g.putImageData(im, 0, 0); return c;
  }
  // parts are rebuilt at 2x: lines are thinned evenly with a smooth threshold, so edges stay anti-aliased
  // (and phones, which show characters ~2.5x bigger than the sheet, get twice the detail)
  function blur(src, w, h, r) {
    const a = new Float32Array(src), b = new Float32Array(src.length), n = 2*r + 1;
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++) { let s = 0; const o = y*w; for (let x = -r; x <= r; x++) s += a[o + Math.min(w - 1, Math.max(0, x))];
        for (let x = 0; x < w; x++) { b[o + x] = s/n; s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; } }
      for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += b[Math.min(h - 1, Math.max(0, y))*w + x];
        for (let y = 0; y < h; y++) { a[y*w + x] = s/n; s += b[Math.min(h - 1, y + r + 1)*w + x] - b[Math.max(0, y - r)*w + x]; } }
    }
    return a;
  }
  function refine2x(src, lineW) {
    const sc = 2, pad = 4, w = src.width*sc + pad*2, h = src.height*sc + pad*2, c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, pad, pad, src.width*sc, src.height*sc);
    if (!lineW) return c;
    const im = g.getImageData(0, 0, w, h), d = im.data, N = w*h, Wl = lineW*sc, cl = v => v < 0 ? 0 : v > 1 ? 1 : v;
    const a = new Float32Array(N), cov = new Float32Array(N), fw = new Float32Array(N), fr = new Float32Array(N), fg = new Float32Array(N), fb = new Float32Array(N);
    let ir = 0, ig = 0, ib = 0, ni = 0;
    for (let p = 0; p < N; p++) { const i = p*4, al = d[i + 3]/255, k = cl((400 - d[i] - d[i + 1] - d[i + 2])/110);
      a[p] = al; const f = al > .9 ? (1 - k)**4 : 0; fw[p] = f; fr[p] = d[i]*f; fg[p] = d[i + 1]*f; fb[p] = d[i + 2]*f;
      if (k > .99 && al > .9) { ir += d[i]; ig += d[i + 1]; ib += d[i + 2]; ni++; } }
    if (!ni) return c; ir /= ni; ig /= ni; ib /= ni;
    const R2 = Math.max(2, Math.round(Wl*.8)), Fw = blur(fw, w, h, R2), Fr = blur(fr, w, h, R2), Fg = blur(fg, w, h, R2), Fb = blur(fb, w, h, R2);
    const Fc = p => Fw[p] > .01 ? [Fr[p]/Fw[p], Fg[p]/Fw[p], Fb[p]/Fw[p]] : [ir, ig, ib];
    for (let p = 0; p < N; p++) { if (!a[p]) continue; const i = p*4, F = Fc(p), ex = F[0] - ir, ey = F[1] - ig, ez = F[2] - ib, L = ex*ex + ey*ey + ez*ez;   // how far this pixel sits from its local fill toward ink
      cov[p] = a[p]*(L < 900 ? 0 : cl(((F[0] - d[i])*ex + (F[1] - d[i + 1])*ey + (F[2] - d[i + 2])*ez)/L)); }
    // nearest fill colour on this pixel's own side of a line: clean fill pixels grow outward into the ink
    const NR = new Float32Array(N), NG = new Float32Array(N), NB = new Float32Array(N), has = new Uint8Array(N), lit = p => cov[p] < .06 && d[p*4 + 3] > 230;   // no ink tint at all
    for (let p = 0; p < N; p++) { const x = p % w; if (!lit(p) || (x && !lit(p - 1)) || (x < w - 1 && !lit(p + 1)) || (p >= w && !lit(p - w)) || (p < N - w && !lit(p + w))) continue;
      NR[p] = d[p*4]; NG[p] = d[p*4 + 1]; NB[p] = d[p*4 + 2]; has[p] = 1; }
    for (let it = 0; it < Wl + 4; it++) { const add = [];
      for (let p = 0; p < N; p++) { if (has[p] || !d[p*4 + 3]) continue; const x = p % w; let n = 0, R = 0, G = 0, Bb = 0;
        for (const q of [x ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (q >= 0 && q < N && has[q] === 1) { n++; R += NR[q]; G += NG[q]; Bb += NB[q]; }
        if (n) add.push([p, R/n, G/n, Bb/n]); }
      if (!add.length) break; for (const [p, R, G, Bb] of add) { NR[p] = R; NG[p] = G; NB[p] = Bb; has[p] = 2; } for (const [p] of add) has[p] = 1; }
    const Fn = p => has[p] ? [NR[p], NG[p], NB[p]] : Fc(p);
    const dark = new Float32Array(N); for (let p = 0; p < N; p++) { const i = p*4; dark[p] = d[i + 3] > 200 && d[i] + d[i + 1] + d[i + 2] < 330 ? 1 : 0; }
    { const sn = new Uint8Array(N); for (let p0 = 0; p0 < N; p0++) { if (sn[p0] || !dark[p0]) continue; const st = [p0], list = []; sn[p0] = 1; let x0 = w, x1 = 0, y0 = h, y1 = 0;   // eyes/noses don't count
      while (st.length) { const p = st.pop(), x = p % w, y = (p - x)/w; list.push(p); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (const q of [p - 1, p + 1, p - w, p + w]) if (q >= 0 && q < N && !sn[q] && dark[q] && Math.abs((q % w) - x) <= 1) { sn[q] = 1; st.push(q); } }
      if (x1 - x0 < Wl*4 && y1 - y0 < Wl*4) for (const p of list) dark[p] = 0; } }
    const realInk = blur(dark, w, h, Math.max(1, Math.round(Wl*.22)));   // colour edges with no outline nearby (a bear's cream belly) aren't ink
    for (let p = 0; p < N; p++) { if (!a[p]) continue; if (realInk[p] < .1) { cov[p] = 0; continue; } if (!has[p]) continue;   // re-measure ink against this side's own colour
      const i = p*4, F = Fn(p), ex = F[0] - ir, ey = F[1] - ig, ez = F[2] - ib, L = ex*ex + ey*ey + ez*ez;
      cov[p] = a[p]*(L < 900 ? 0 : cl(((F[0] - d[i])*ex + (F[1] - d[i + 1])*ey + (F[2] - d[i + 2])*ez)/L)); }
    const r = Math.max(1, Math.round(Wl*.35)), bc = blur(cov, w, h, r), ba = blur(a, w, h, r), near = blur(cov, w, h, r*2);
    const pk = new Float32Array(N), tm = new Float32Array(N), M = Math.max(2, Math.round(Wl*.7));   // local peak (max filter): thin features like mouths keep a lower threshold
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.max(0, x - M); k <= Math.min(w - 1, x + M); k++) if (bc[y*w + k] > m) m = bc[y*w + k]; tm[y*w + x] = m; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.max(0, y - M); k <= Math.min(h - 1, y + M); k++) if (tm[k*w + x] > m) m = tm[k*w + x]; pk[y*w + x] = m; }
    const keep = new Uint8Array(N), seen = new Uint8Array(N), lim = Wl*4;   // small separate ink shapes (eyes, nose, mouth) are left as drawn
    for (let p0 = 0; p0 < N; p0++) { if (seen[p0] || cov[p0] < .5) continue; const st = [p0], list = []; seen[p0] = 1; let x0 = w, x1 = 0, y0 = h, y1 = 0;
      while (st.length) { const p = st.pop(), x = p % w, y = (p - x)/w; list.push(p); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const q of [p - 1, p + 1, p - w, p + w]) if (q >= 0 && q < N && !seen[q] && cov[q] >= .5 && Math.abs((q % w) - x) <= 1) { seen[q] = 1; st.push(q); } }
      if (x1 - x0 < lim && y1 - y0 < lim) for (const p of list) keep[p] = 1; }
    { // ink thicker (noses) or thinner (mouths) than the outline is a feature, not an outline: keep it too
      const D = new Float32Array(N), S2 = 1.4142;
      for (let p = 0; p < N; p++) D[p] = cov[p] >= .5 ? 1e9 : 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y*w + x; if (!D[p]) continue; D[p] = Math.min(D[p], x ? D[p - 1] + 1 : 1, y ? D[p - w] + 1 : 1, x && y ? D[p - w - 1] + S2 : 1, x < w - 1 && y ? D[p - w + 1] + S2 : 1); }
      for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const p = y*w + x; if (!D[p]) continue; D[p] = Math.min(D[p], x < w - 1 ? D[p + 1] + 1 : 1, y < h - 1 ? D[p + w] + 1 : 1, x < w - 1 && y < h - 1 ? D[p + w + 1] + S2 : 1, x && y < h - 1 ? D[p + w - 1] + S2 : 1); }
      const Rm = Math.max(2, Math.round(Wl*.45)), lm = new Float32Array(N);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.max(0, x - Rm); k <= Math.min(w - 1, x + Rm); k++) if (D[y*w + k] > m) m = D[y*w + k]; tm[y*w + x] = m; }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.max(0, y - Rm); k <= Math.min(h - 1, y + Rm); k++) if (tm[k*w + x] > m) m = tm[k*w + x]; lm[y*w + x] = m; }
      for (let p = 0; p < N; p++) if (cov[p] >= .5 && (lm[p] < Wl*.3 || lm[p] > Wl*.75)) keep[p] = 1;
    }
    const keepN = blur(Float32Array.from(keep), w, h, r + 1);
    const T = .9, ss = (e0, e1, x) => { const t = cl((x - e0)/(e1 - e0)); return t*t*(3 - 2*t); };
    for (let p = 0; p < N; p++) {
      if ((cov[p] < .02 && near[p] < .02) || keepN[p] > .05) continue;
      const i = p*4, t = Math.min(T, Math.max(.3, pk[p]*.88)), nc = Math.min(cov[p], ss(t - .1, t + .1, bc[p]));
      const sil = ss(t - .1, t + .1, ba[p]), na = Math.min(a[p], a[p] - (a[p] - Math.min(a[p], sil))*cl(near[p]*3));
      if (na <= .004) { d[i + 3] = 0; continue; }
      { const q = cl(nc/na), F = Fn(p);
        d[i] = F[0] + (ir - F[0])*q; d[i + 1] = F[1] + (ig - F[1])*q; d[i + 2] = F[2] + (ib - F[2])*q; }
      d[i + 3] = na*255;
    }
    g.putImageData(im, 0, 0); return c;
  }
  // an arm with no outline: its fill colour, shrunk to inside the ink line (used to erase the body's outline where the arm joins)
  function fillOnly(src, lw) {
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; const g = c.getContext('2d'); g.drawImage(src, 0, 0);
    const w = c.width, h = c.height, im = g.getImageData(0, 0, w, h), d = im.data, N = w*h;
    const fills = []; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 230 && d[i] + d[i + 1] + d[i + 2] > 430) fills.push(i);
    if (!fills.length) return c;
    const m = fills.sort((a, b) => (d[a] + d[a + 1] + d[a + 2]) - (d[b] + d[b + 1] + d[b + 2]))[fills.length >> 1], F = [d[m], d[m + 1], d[m + 2]];
    let A = new Uint8Array(N); for (let p = 0; p < N; p++) A[p] = d[p*4 + 3] > 128 && d[p*4] + d[p*4 + 1] + d[p*4 + 2] > 430 ? 1 : 0;   // fill pixels only
    for (let it = 0; it < Math.ceil(lw*.5); it++) { const B = new Uint8Array(N); for (let p = 0; p < N; p++) { const x = p % w; B[p] = A[p] && (x ? A[p - 1] : 0) && (x < w - 1 ? A[p + 1] : 0) && (p >= w ? A[p - w] : 0) && (p < N - w ? A[p + w] : 0); } A = B; }
    for (let it = 0; it < Math.ceil(lw*.6); it++) { const B = new Uint8Array(A); for (let p = 0; p < N; p++) { if (A[p]) continue; const x = p % w; if ((x && A[p - 1]) || (x < w - 1 && A[p + 1]) || (p >= w && A[p - w]) || (p < N - w && A[p + w])) B[p] = 1; } A = B; }   // grow back over the inner half of the line
    for (let p = 0; p < N; p++) { const i = p*4; d[i] = F[0]; d[i + 1] = F[1]; d[i + 2] = F[2]; d[i + 3] = A[p] ? 255 : 0; }
    g.putImageData(im, 0, 0); g.filter = 'blur(1px)'; const c2 = document.createElement('canvas'); c2.width = w; c2.height = h; c2.getContext('2d').filter = 'blur(1px)'; c2.getContext('2d').drawImage(c, 0, 0); return c2;
  }
  // the body's outline band: its silhouette minus the silhouette shrunk by k px (where the arm's fill may cover the outline)
  function bandOf(src, k) {
    const w = src.width, h = src.height, N = w*h, d = src.getContext('2d').getImageData(0, 0, w, h).data;
    let A = new Uint8Array(N); for (let p = 0; p < N; p++) A[p] = d[p*4 + 3] > 40 ? 1 : 0;
    const A0 = new Uint8Array(N); for (let p = 0; p < N; p++) { const x = p % w; A0[p] = d[p*4 + 3] > 0 || (x && d[p*4 - 1] > 0) || (x < w - 1 && d[p*4 + 7] > 0) || (p >= w && d[(p - w)*4 + 3] > 0) || (p < N - w && d[(p + w)*4 + 3] > 0) ? 1 : 0; }   // include the soft fringe, plus a pixel
    for (let it = 0; it < k; it++) { const B = new Uint8Array(N); for (let p = 0; p < N; p++) { const x = p % w; B[p] = A[p] && (x ? A[p - 1] : 0) && (x < w - 1 ? A[p + 1] : 0) && (p >= w ? A[p - w] : 0) && (p < N - w ? A[p + w] : 0); } A = B; }
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), im = g.createImageData(w, h);
    for (let p = 0; p < N; p++) im.data[p*4 + 3] = A0[p] && !A[p] ? 255 : 0;
    g.putImageData(im, 0, 0); const c2 = document.createElement('canvas'); c2.width = w; c2.height = h; const g2 = c2.getContext('2d'); g2.filter = 'blur(1px)'; g2.drawImage(c, 0, 0); return c2;
  }
  function partsFromSheet(sheet, keyRGB, tol) {
    const W = sheet.width, H = sheet.height, m = maskOf(sheet, keyRGB, tol), {lab, comps} = components(m, W, H);
    if (comps.length < 10) return null;
    const big = Math.max(...comps.map(c => c.area)), med = comps.map(c => c.area).sort((a, b) => a - b)[comps.length >> 1];
    if (big > med*6) return null;   // one huge shape: that's a T-pose sheet, not a parts sheet
    const cy = c => (c.box[1] + c.box[3])/2, hh = c => c.box[3] - c.box[1];
    const byY = comps.slice().sort((a, b) => cy(a) - cy(b)), rows = [[byY[0]]];
    for (let i = 1; i < byY.length; i++) { const prev = rows[rows.length - 1]; const avgY = prev.reduce((s, c) => s + cy(c), 0)/prev.length, avgH = prev.reduce((s, c) => s + hh(c), 0)/prev.length;
      if (cy(byY[i]) - avgY > avgH*.6) rows.push([byY[i]]); else prev.push(byY[i]); }
    rows.forEach(r => r.sort((a, b) => a.box[0] - b.box[0]));
    { const ws = comps.map(c => outlineWidth(sheet, c)).filter(n => n > 0).sort((a, b) => a - b); THIN.w = 0; var lineW = ws[ws.length >> 1] || 0; }   // median over all parts: one furry part can't skew it
    const img = c => refine2x(extract(sheet, lab, c.id, c.box), lineW);
    const R = {type:'parts', views:{}}, f = rows[0], sd = rows[1], bk = rows[2];
    if (!f || f.length < 9) return null;
    const nf = f.length - 5;   // heads first, then torso, arms, legs
    R.views.front = {heads:f.slice(0, nf).map(img), torso:img(f[nf]), armL:img(f[nf + 1]), armR:img(f[nf + 2]), legL:img(f[nf + 3]), legR:img(f[nf + 4])};
    if (sd && sd.length >= 6) { const ns = sd.length - 5; R.views.side = {heads:sd.slice(0, ns).map(img), torso:img(sd[ns]), armNear:openCap(img(sd[ns + 1])), armFar:img(sd[ns + 2]), legNear:img(sd[ns + 3]), legFar:img(sd[ns + 4])}; }
    if (bk && bk.length >= 6) { const nb = bk.length - 5; R.views.back = {heads:bk.slice(0, nb).map(img), torso:img(bk[nb]), armL:img(bk[nb + 1]), armR:img(bk[nb + 2]), legL:img(bk[nb + 3]), legR:img(bk[nb + 4])}; }
    const T = R.views.front, hd = T.heads[0];
    // shoulders blend only where arm and body are the same colour there (a hedgehog's arms come from behind her spikes)
    const fillOf = (c, fx, fy) => { const d = c.getContext('2d').getImageData(Math.round(c.width*fx) - 2, Math.round(c.height*fy) - 2, 5, 5).data; let r = 0, g2 = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { r += d[i]; g2 += d[i + 1]; b += d[i + 2]; n++; } return n ? [r/n, g2/n, b/n] : null; };
    for (const v of ['front', 'back']) { const V = R.views[v]; if (!V) continue; const A = fillOf(V.armL, .5, .55), B = fillOf(V.torso, .16, .42);
      V.bridge = !!(A && B && Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) < 70); if (V.bridge) { V.fillL = fillOnly(V.armL, lineW*2); V.fillR = fillOnly(V.armR, lineW*2); V.band = bandOf(V.torso, Math.ceil(lineW*2.2)); } }
    R.h = hd.height*.78 + T.torso.height + T.legL.height*.75; R.w = Math.max(T.torso.width + T.armL.width*1.4, hd.width);
    return R;
  }
  const SIDE_FACE = {happy:0, blink:1, impatient:0, delighted:2};
  // pose: arm [left,right] (0 = straight out, 90 = down, negative = up) · leg [l,r] (+ = outward / forward) · head (tilt) · dy · lean · breathe · face · view · flip · squash
  function drawParts(rig, pose, g, W, Hc) {
    const view = rig.views[pose.view || 'front'] ? (pose.view || 'front') : 'front', V = rig.views[view], side = view === 'side';
    const sc = Math.min(W/(rig.w*1.55), Hc/(rig.h*1.25)), feet = Hc*.92;
    const T = V.torso, tw = T.width, th = T.height, leg0 = V.legL || V.legNear, legH = leg0.height;
    const hipY = th*.30, groundY = hipY + legH*.78;   // torso centre is the origin
    g.save(); g.translate(W/2, feet + (pose.dy || 0)*rig.h*sc); g.scale(sc*(pose.flip ? -1 : 1)*(1 - (pose.squash || 0)), sc);
    const br = pose.breathe || 0; g.scale(1 - br*.5, 1 + br);
    const ss = pose.ss || 0; g.scale(1 - ss*.55, 1 + ss);   // squash & stretch from the feet
    g.translate(0, -groundY); g.rotate((pose.lean || 0)*PI/180);
    // a limb hangs from its top: pivot sits a little way down the rounded end, which tucks under the torso
    // pose.only = 'armL' etc. draws just that part (the mesh builder uses these as masks); pose.pivots collects each joint's canvas position
    const want = k => (!pose.only || pose.only === k) && !(pose.skip && pose.skip.includes(k)), pv = (k, x, y) => { if (pose.pivots) { const q = g.getTransform().transformPoint(new DOMPoint(x, y)); pose.pivots[k] = [q.x, q.y]; } };
    const limbN = (k, im, x, y, deg) => { pv(k, x, y); if (want(k)) limb(im, x, y, deg); };
    const limb = (im, x, y, deg) => { g.save(); g.translate(x, y); g.rotate(deg*PI/180); g.drawImage(im, -im.width/2, -im.width*.28); g.restore(); };
    const arm = pose.arm || [80, 80], leg = pose.leg || [0, 0], down = a => 90 - a;   // convert to 0 = hanging down
    const sh = -th*.10;
    if (side) {
      limbN('armFar', V.armFar, tw*.05, sh, -down(arm[0])*.8);
      limbN('legFar', V.legFar, -tw*.10, hipY, -(leg[0] || 0));
      limbN('legNear', V.legNear, tw*.10, hipY, (leg[1] || 0));
      if (want('torso')) g.drawImage(T, -tw/2, -th/2);
    } else {
      limbN('legL', V.legL, -tw*.2, hipY, leg[0]); limbN('legR', V.legR, tw*.2, hipY, -leg[1]);
      limbN('armL', V.armL, -tw*.36, sh, down(arm[0])); limbN('armR', V.armR, tw*.36, sh, -down(arm[1]));   // behind the body...
      if (want('torso')) g.drawImage(T, -tw/2, -th/2);
      if (V.bridge && !pose.only && !pose.skip) {   // ...then the arms' fill (no outline) over the body's outline band: wherever the arm overlaps it, the body's line disappears
        const o = drawParts.o || (drawParts.o = document.createElement('canvas')); if (o.width !== g.canvas.width || o.height !== g.canvas.height) { o.width = g.canvas.width; o.height = g.canvas.height; }
        const og = o.getContext('2d'), tf = g.getTransform(); og.setTransform(1, 0, 0, 1, 0, 0); og.clearRect(0, 0, o.width, o.height); og.setTransform(tf);
        const save = g; g = og; limb(V.fillL, -tw*.36, sh, down(arm[0])); limb(V.fillR, tw*.36, sh, -down(arm[1])); g = save;
        og.globalCompositeOperation = 'destination-in'; og.drawImage(V.band, -tw/2, -th/2); og.globalCompositeOperation = 'source-over';
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(o, 0, 0); g.restore(); }
    }
    // head: tilted around the neck, bottom tucked over the torso top
    const faces = V.heads, fi = view === 'front' ? FACE[pose.face || 'happy'] : view === 'side' ? SIDE_FACE[pose.face || 'happy'] : 0;
    const hd = faces[Math.min(fi, faces.length - 1)] || faces[0], neckY = -th/2 + th*.16;
    pv('head', side ? tw*.06 : 0, neckY); pv('feet', 0, groundY); if (pose.pivots) pose.pivots._sc = sc;
    if (want('head')) { g.save(); g.translate(side ? tw*.06 : 0, neckY); g.rotate((pose.head || 0)*PI/180); g.drawImage(hd, -hd.width/2, -hd.height*.86); g.restore(); }
    if (side) limbN('armNear', V.armNear, -tw*.02, sh, down(arm[1])*.9);
    g.restore();
  }
  // actions for parts rigs (front actions reuse the T-pose ones; these add turning and walking)
  // turning: a quick hop, and the two views cross-fade at the top of it (round characters look odd squeezed thin)
  function turnPose(views, swaps, t) {
    let i = 0; while (i < swaps.length && t >= swaps[i]) i++;
    let near = 1, j = 0; swaps.forEach((sw, n) => { if (Math.abs(t - sw) < near) { near = Math.abs(t - sw); j = n; } });
    const w = .06, k = Math.min(1, near/w), hop = 1 - k*k*(3 - 2*k);
    const pose = {view:views[i][0], flip:views[i][1], dy:-.07*hop, squash:-.04*hop, arm:[80 - 25*hop, 80 - 25*hop], breathe:.015*S(2*PI*t) - .02*hop, face:'happy'};
    if (false) {   // (cross-fade looked ghostly; views swap cleanly at the top of the hop) between the view before and after the swap
      const m = Math.max(0, Math.min(1, (t - swaps[j])/(w*1.2) + .5));
      pose.view = views[j][0]; pose.flip = views[j][1]; pose.view2 = views[j + 1][0]; pose.flip2 = views[j + 1][1]; pose.mix = m;
    }
    return pose;
  }
  const PARTS_ACTIONS = Object.assign({}, ACTIONS, {
    // turning: views swap at the narrowest point of a smooth horizontal squeeze, with a tiny hop, like a card flipping
    turn: t => turnPose([['front', 0], ['side', 0], ['front', 0]], [.35, .75], t),   // look to the side and back
    spin: t => turnPose([['front', 0], ['side', 0], ['back', 0], ['side', 1], ['front', 0]], [.15, .35, .55, .75], t),
    walkSide: t => ({view:'side', leg:[22*S(2*PI*t), 22*S(2*PI*t)], arm:[90 - 25*S(2*PI*t), 90 + 25*S(2*PI*t)], dy:-.03*Math.abs(S(2*PI*t)), lean:2, face:'happy'}),
    walkAway: t => ({view:'back', leg:[12*S(2*PI*t), -12*S(2*PI*t)], arm:[80 + 12*S(2*PI*t), 80 - 12*S(2*PI*t)], dy:-.03*Math.abs(S(2*PI*t)), lean:2*S(2*PI*t)}),
    lookAround: t => { const k = (t*4) % 4; return {view:k < 1 ? 'front' : k < 2 ? 'side' : k < 3 ? 'front' : 'side', flip:k >= 3 ? 1 : 0, arm:[80, 80], face:k < 1 ? 'happy' : k < 3 ? 'blink' : 'happy'}; }
  });
  function anyFrames(rig, action, n, size) {
    if (rig.type !== 'parts') return framesFor(rig, action, n, size);
    const fn = PARTS_ACTIONS[action] || PARTS_ACTIONS.idle, out = [];
    for (let i = 0; i < n; i++) { const c = document.createElement('canvas'); c.width = size; c.height = size; drawAny(rig, fn(i/n), c.getContext('2d'), size, size); out.push(c); }
    return out;
  }
  // for games: the pose of an action at time t (0..1), and drawing any rig type
  // polish on top of any action: the body stretches as it rises and squashes as it lands,
  // arms trail a beat behind and bounce against the motion, and the head lags the lean
  function polish(fn, t) {
    const e = .01, p = fn(t), a = fn(t - e), b = fn(t + e), lag = fn(t - .06), cl = (x, m) => Math.max(-m, Math.min(m, x));
    const v = ((b.dy || 0) - (a.dy || 0))/(2*e);   // + = moving down
    p.ss = cl(-v*.35, .08);
    if (p.arm && lag.arm && (p.view || 'front') === (lag.view || 'front')) { const drag = cl(-v*60, 16); p.arm = p.arm.map((x, i) => x*.55 + lag.arm[i]*.45 + drag); }
    p.head = (p.head || 0) + cl(((lag.lean || 0) - (p.lean || 0))*1.2, 6);
    return p;
  }
  function poseFor(rig, action, t) { const A = rig.type === 'parts' ? PARTS_ACTIONS : ACTIONS; return polish(A[action] || A.idle, t); }
  function drawAny(rig, pose, g, W, H) {
    if (rig.type !== 'parts') { drawPose(rig, pose, g, W, H); return; }
    if (pose.view2 && pose.mix > 0) {   // cross-fade two views through a buffer so overlapping parts don't show through
      const b = drawAny.b || (drawAny.b = document.createElement('canvas')); b.width = g.canvas.width; b.height = g.canvas.height;
      const bg = b.getContext('2d'), tf = g.getTransform();
      for (const [v, f, a] of [[pose.view, pose.flip, 1], [pose.view2, pose.flip2, pose.mix]]) {   // old view stays solid underneath, so nothing goes see-through
        bg.setTransform(1, 0, 0, 1, 0, 0); bg.clearRect(0, 0, b.width, b.height); bg.setTransform(tf);
        drawParts(rig, Object.assign({}, pose, {view:v, flip:f}), bg, W, H);
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = a; g.drawImage(b, 0, 0); g.restore();
      }
      return;
    }
    drawParts(rig, pose, g, W, H);
  }
  window.BakeryRig = {bandOf, turnPose, poseFor, drawAny, rigFromSheet, partsFromSheet, framesFor:anyFrames, ACTIONS:Object.keys(ACTIONS), PARTS_ACTIONS:Object.keys(PARTS_ACTIONS), drawPose, drawParts, FACE};
})();
