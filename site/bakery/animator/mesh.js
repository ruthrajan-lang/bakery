// BakeryMesh: characters that bend like the koi instead of swinging cut-out pieces.
// The body (head + torso + legs) is baked once into ONE picture and drawn through a soft WebGL mesh:
// squash & stretch, waddle, curved lean, springy ears, legs that step and a head that tilts — no seams.
// Arms are soft strips that curve like a fish tail, hang from shoulders that follow the body, and
// lag behind the motion; where an arm meets the body its colour covers the body's outline.
(() => {
  const PI = Math.PI, S = Math.sin, cl = (x, a, b) => Math.max(a, Math.min(b, x));
  const GX = 34, GY = 34, AN = 14;   // body mesh, arm strip segments
  const FRONT_FACES = ['happy', 'blink', 'impatient', 'delighted'], SIDE_FACES = ['happy', 'blink', 'delighted'];
  const LIMBS = {front: ['legL', 'legR', 'armL', 'armR'], back: ['legL', 'legR', 'armL', 'armR'], side: ['armFar', 'legFar', 'legNear', 'armNear']};   // drawing order
  const BODY_REGIONS = {front: ['head'], back: ['head'], side: ['head']};
  const COVER = {legL: ['torso'], legR: ['torso'], legNear: ['torso'], legFar: ['torso', 'legNear'], head: []};

  // ---------- 1. bake ----------
  const canvas = size => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  function render(rig, pose, size) { const c = canvas(size); BakeryRig.drawParts(rig, pose, c.getContext('2d'), size, size); return c; }
  function weightsOf(rig, rest, name, size) {   // soft mask of the VISIBLE part, on the mesh grid
    const m = render(rig, Object.assign({}, rest, {only: name}), size), mg = m.getContext('2d');
    mg.globalCompositeOperation = 'destination-out'; for (const c of COVER[name] || []) mg.drawImage(render(rig, Object.assign({}, rest, {only: c}), size), 0, 0);
    const b = canvas(size), g = b.getContext('2d'); g.filter = `blur(${Math.round(size*.012)}px)`; g.drawImage(m, 0, 0);
    const d = g.getImageData(0, 0, size, size).data, w = new Float32Array((GX + 1)*(GY + 1));
    let top = size; for (let y = 0; y < size && top === size; y++) for (let x = 0; x < size; x++) if (d[(y*size + x)*4 + 3] > 80) { top = y; break; }
    for (let j = 0; j <= GY; j++) for (let i = 0; i <= GX; i++) { const x = Math.min(size - 1, Math.round(i/GX*(size - 1))), y = Math.min(size - 1, Math.round(j/GY*(size - 1)));
      w[j*(GX + 1) + i] = Math.min(1, d[(y*size + x)*4 + 3]/255*2.6); }   // the head moves as one piece, ear tips too
    return {w, top};
  }
  function build(rig, size = 640) {
    if (!rig || rig.type !== 'parts') return null;
    const M = {size, views: {}};
    for (const view of ['front', 'side', 'back']) {
      const RV = rig.views[view]; if (!RV) continue;
      const rest = {view, arm: view === 'side' ? [90, 90] : [80, 80], leg: [0, 0], face: 'happy'}, arms = LIMBS[view];
      const pivots = {}; render(rig, Object.assign({}, rest, {pivots}), size); const sc = pivots._sc;
      const faces = view === 'front' ? FRONT_FACES : view === 'side' ? SIDE_FACES : ['happy'];
      const tex = {}; for (const f of faces) tex[f] = render(rig, Object.assign({}, rest, {face: f, skip: arms}), size);
      const W = {}; let headTop = size; const n = (GX + 1)*(GY + 1);
      for (const r of BODY_REGIONS[view]) { const o = weightsOf(rig, rest, r, size); W[r] = o.w; if (r === 'head') headTop = o.top; }
      for (let k = 0; k < n; k++) { let s = 0; for (const r of BODY_REGIONS[view]) s += W[r][k]; if (s > 1) for (const r of BODY_REGIONS[view]) W[r][k] /= s; }
      const rest2 = new Float32Array(n*2); for (let j = 0; j <= GY; j++) for (let i = 0; i <= GX; i++) { const k = j*(GX + 1) + i; rest2[k*2] = i/GX*size; rest2[k*2 + 1] = j/GY*size; }
      // arm images (already cleaned by the rig) + their outline-free fills and the body's outline band for the shoulder blend
      const armImg = {}, armFill = {}; for (const a of arms) armImg[a] = RV[a];
      let band = null;
      if (RV.bridge && view !== 'side') { armFill.armL = RV.fillL; armFill.armR = RV.fillR;
        const torso = render(rig, Object.assign({}, rest, {only: 'torso'}), size); band = BakeryRig.bandOf(torso, Math.ceil(size*.012)); }
      M.views[view] = {tex, W, pivots, sc, headTop, rest: rest2, feet: pivots.feet || [size/2, size*.92], arms, armImg, armFill, band, restDeg: view === 'side' ? {} : {armL: 10, armR: -10}};
    }
    return M;
  }

  // ---------- 2. motion ----------
  // sq squash(-)/stretch(+) · rock: tilt about the feet (deg) · lean: curved bend (deg) · nod: top dips · dy: hop
  // r: joints in degrees — arms: + raises outward (L) / for R use −; legs/head bend at their joint
  const A = {
    idle: t => ({sq: .018*S(2*PI*t), rock: 1.2*S(2*PI*t + 1), r: {head: 2.5*S(2*PI*t + .6), armL: 4*S(2*PI*t), armR: -4*S(2*PI*t)}, face: t > .82 && t < .9 ? 'blink' : 'happy'}),
    wave: t => ({rock: 2*S(2*PI*t), lean: -2, r: {armR: -125 - 22*S(4*PI*t), head: 6, armL: 6}, face: 'happy'}),
    cheer: t => { const k = Math.abs(S(2*PI*t)); return {dy: -.08*k, r: {armL: 120 + 15*S(4*PI*t), armR: -120 - 15*S(4*PI*t), legL: 6*k, legR: -6*k}, face: 'delighted'}; },
    hop: t => { const k = Math.abs(S(2*PI*t)); return {dy: -.11*k, r: {armL: 45*k, armR: -45*k, legL: 5*k, legR: -5*k}, face: k > .5 ? 'delighted' : 'happy'}; },
    walk: t => { const s = S(2*PI*t); return {rock: 6*s, dy: -.02*Math.abs(s), r: {legL: 12*Math.max(0, s), legR: -12*Math.max(0, -s), armL: 12*s, armR: 12*s, head: -3*s}, face: 'happy'}; },
    walkSide: t => { const s = S(2*PI*t); return {view: 'side', rock: 2.5*S(4*PI*t), lean: 3, dy: -.025*Math.abs(s), r: {legNear: 24*s, legFar: -24*s, armNear: -28*s, armFar: 22*s, head: -2*S(4*PI*t)}, face: 'happy'}; },
    walkAway: t => { const s = S(2*PI*t); return {view: 'back', rock: 6*s, dy: -.02*Math.abs(s), r: {legL: 12*Math.max(0, s), legR: -12*Math.max(0, -s), armL: 12*s, armR: 12*s}}; },
    impatient: t => ({rock: 1.5*S(4*PI*t), r: {legR: -12*Math.max(0, S(8*PI*t)), head: 4*S(4*PI*t), armL: 30, armR: -30}, face: 'impatient'}),
    bow: t => { const k = Math.max(0, S(2*PI*t)); return {nod: .07*k, sq: -.02*k, r: {armL: -6*k, armR: 6*k}, face: k > .5 ? 'blink' : 'happy'}; },
    dance: t => { const s = S(2*PI*t), f = S(4*PI*t); return {rock: 9*s, dy: -.04*Math.abs(f), r: {armL: 80 + 50*f, armR: -80 + 50*f, legL: 8*f, legR: 8*f, head: -5*s}, face: 'delighted'}; },
    doze: t => ({sq: .03*S(2*PI*t), rock: 1.5*S(2*PI*t), r: {head: 10 + 3*S(2*PI*t), armL: -2, armR: 2}, face: 'blink'}),
    excited: t => { const f = S(8*PI*t); return {dy: -.03*Math.abs(f), rock: 3*f, r: {armL: 70 + 40*f, armR: -70 + 40*f}, face: 'delighted'}; },
    lookAround: t => { const k = (t*4) % 4; return {view: k < 1 || (k >= 2 && k < 3) ? 'front' : 'side', flip: k >= 3, r: {head: 3*S(2*PI*t)}, face: k >= 1 && k < 3 ? 'blink' : 'happy'}; },
  };
  function turnSeq(views, swaps) { return t => {
    let i = 0; while (i < swaps.length && t >= swaps[i]) i++;
    let near = 1; for (const sw of swaps) near = Math.min(near, Math.abs(t - sw));
    const k = Math.min(1, near/.07), hop = 1 - k*k*(3 - 2*k);
    return {view: views[i][0], flip: views[i][1], dy: -.07*hop, r: {armL: 35*hop, armR: -35*hop, armNear: -30*hop, armFar: 30*hop}, face: 'happy'}; }; }
  A.turn = turnSeq([['front', 0], ['side', 0], ['front', 0]], [.35, .75]);
  A.spin = turnSeq([['front', 0], ['side', 0], ['back', 0], ['side', 1], ['front', 0]], [.15, .35, .55, .75]);

  // the "alive" layer: stretch rising, squash landing; ears, head and arms lag behind the motion
  function poseFor(action, t) {
    const f = A[action] || A.idle, e = .01, p = f(t), a = f(t - e), b = f(t + e), lag = f(t - .05);
    const v = ((b.dy || 0) - (a.dy || 0))/(2*e), vr = ((b.rock || 0) - (a.rock || 0))/(2*e);
    p.sq = (p.sq || 0) + cl(-v*.4, -.09, .1);
    p.earY = cl(-v*.05, -.05, .05); p.earX = cl(-vr*.0025, -.04, .04);
    p.r = Object.assign({}, p.r); p.r.head = (p.r.head || 0) - cl(vr*.08, -6, 6);
    p.curl = {};   // arms trail: the hand curls the way the arm just came from
    for (const k of ['armL', 'armR', 'armNear', 'armFar']) { const now = (p.r[k] || 0), was = ((lag.r || {})[k] || 0); p.curl[k] = cl((was - now)*.6 + v*8*(k === 'armR' ? -1 : 1), -35, 35); }
    if (lag.view && lag.view !== p.view) p.curl = {};
    return p;
  }

  // ---------- 3. draw ----------
  let gl, glc, prog, posBuf, uvBuf, idxBody, idxArm, nBody, nArm, uvBody, uvArm, tmpA, tmpB, texCache = new WeakMap();
  function initGL() {
    glc = document.createElement('canvas'); gl = glc.getContext('webgl2', {premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: true});
    if (!gl) return false;
    const vs = `#version 300 es
      in vec2 p; in vec2 uv; uniform vec2 res; out vec2 v; void main(){ v = uv; vec2 c = p/res*2. - 1.; gl_Position = vec4(c.x, -c.y, 0, 1); }`;
    const fs = `#version 300 es
      precision highp float; in vec2 v; uniform sampler2D tx; out vec4 o; void main(){ o = texture(tx, v); }`;
    prog = gl.createProgram();
    for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); gl.attachShader(prog, s); }
    gl.linkProgram(prog); gl.useProgram(prog);
    uvBody = new Float32Array((GX + 1)*(GY + 1)*2); const ib = [];
    for (let j = 0; j <= GY; j++) for (let i = 0; i <= GX; i++) { const k = j*(GX + 1) + i; uvBody[k*2] = i/GX; uvBody[k*2 + 1] = j/GY; }
    for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) { const a = j*(GX + 1) + i, b = a + 1, c = a + GX + 1, d = c + 1; ib.push(a, b, c, b, d, c); }
    uvArm = new Float32Array((AN + 1)*2*2); const ia = [];
    for (let s = 0; s <= AN; s++) { uvArm.set([0, s/AN, 1, s/AN], s*4); if (s < AN) { const a = s*2; ia.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    nBody = ib.length; nArm = ia.length;
    idxBody = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBody); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ib), gl.STATIC_DRAW);
    idxArm = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxArm); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ia), gl.STATIC_DRAW);
    posBuf = gl.createBuffer(); uvBuf = gl.createBuffer();
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    tmpA = document.createElement('canvas'); tmpB = document.createElement('canvas');
    return true;
  }
  function texOf(c) {
    let t = texCache.get(c); if (t) return t;
    t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    texCache.set(c, t); return t;
  }
  function mesh(pos, uv, idx, n, tex, scale) {
    for (let k = 0; k < pos.length; k++) pos[k] *= scale;
    gl.useProgram(prog); gl.uniform2f(gl.getUniformLocation(prog, 'res'), glc.width, glc.height);
    const lp = gl.getAttribLocation(prog, 'p'), lu = gl.getAttribLocation(prog, 'uv');
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(lu); gl.vertexAttribPointer(lu, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texOf(tex)); gl.uniform1i(gl.getUniformLocation(prog, 'tx'), 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx); gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_SHORT, 0);
  }
  const clear = () => { gl.viewport(0, 0, glc.width, glc.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); };
  const grab = c => { if (c.width !== glc.width || c.height !== glc.height) { c.width = glc.width; c.height = glc.height; } const g = c.getContext('2d'); g.globalCompositeOperation = 'copy'; g.drawImage(glc, 0, 0); g.globalCompositeOperation = 'source-over'; return c; };

  // the body's deformation, for any point (mesh vertices and the shoulders the arms hang from)
  function deformer(M, V, p) {
    const sz = M.size, [fx, fy] = V.feet, hy = V.pivots.head ? V.pivots.head[1] : sz*.45, hTop = V.headTop, earBand = Math.max(1, (hy - hTop)*.45);
    const rot = Object.entries(p.r || {}).filter(([k, a]) => a && V.W[k] && V.pivots[k]).map(([k, a]) => [V.W[k], V.pivots[k], Math.cos(a*PI/180), Math.sin(a*PI/180)]);
    const rk = (p.rock || 0)*PI/180, cr = Math.cos(rk), sr = Math.sin(rk), height = fy - hTop, lean = Math.tan((p.lean || 0)*PI/180), sq = p.sq || 0, dy = (p.dy || 0)*height, nod = (p.nod || 0)*height;
    return (x, y, k) => {
      if (k >= 0) { let ox = 0, oy = 0; for (const [w, c, co, si] of rot) { const ww = w[k]; if (!ww) continue; const dx = x - c[0], d2 = y - c[1]; ox += ww*(c[0] + dx*co - d2*si - x); oy += ww*(c[1] + dx*si + d2*co - y); } x += ox; y += oy; }
      const top = cl((hTop + earBand - y)/earBand, 0, 1)**2; x += (p.earX || 0)*height*top; y += (p.earY || 0)*height*top;
      const up = cl((fy - y)/height, 0, 1.3); x += lean*height*up**1.4; y += nod*up**1.6;
      x = fx + (x - fx)*(1 - sq*.6); y = fy + (y - fy)*(1 + sq);
      const rx = x - fx, ry = y - fy; x = fx + rx*cr - ry*sr; y = fy + rx*sr + ry*cr + dy;
      if (p.flip) x = sz - x;
      return [x, y];
    };
  }
  const bodyPos = new Float32Array((GX + 1)*(GY + 1)*2), armPos = new Float32Array((AN + 1)*4);
  function bodyMesh(M, V, def) { const n = (GX + 1)*(GY + 1); for (let k = 0; k < n; k++) { const q = def(V.rest[k*2], V.rest[k*2 + 1], k); bodyPos[k*2] = q[0]; bodyPos[k*2 + 1] = q[1]; } return bodyPos; }
  function armMesh(M, V, p, def, name) {   // a strip that curves from the shoulder to the hand
    const im = V.armImg[name], sc = V.sc, aw = im.width*sc, ah = im.height*sc, top = im.width*.28*sc, P = V.pivots[name];
    const [sx, sy] = def(P[0], P[1], -1);
    let deg = (V.restDeg[name] || 0) + ((p.r || {})[name] || 0)*(name === 'armR' ? 1 : 1) + (p.rock || 0);
    if (p.flip) deg = -deg;
    const curl = name.startsWith('arm') ? ((p.curl || {})[name] || 0)*(p.flip ? -1 : 1) : 0, a0 = deg*PI/180;
    let x = sx + Math.sin(a0)*top, y = sy - Math.cos(a0)*top;   // start above the pivot, along the arm
    const ds = ah/AN;
    for (let s = 0; s <= AN; s++) {
      const f = s/AN, a = a0 + (curl*PI/180)*Math.max(0, f - .3)**1.3, dx = -Math.sin(a), dy = Math.cos(a), nx = dy, ny = -dx;
      const fl = p.flip ? -1 : 1;
      armPos.set([x - nx*aw/2*fl, y - ny*aw/2*fl, x + nx*aw/2*fl, y + ny*aw/2*fl], s*4);
      x += dx*ds; y += dy*ds;
    }
    return armPos;
  }
  function draw(M, p, ctx, x, y, w, h) {
    if (!gl && !initGL()) return false;
    const view = M.views[p.view || 'front'] ? (p.view || 'front') : 'front', V = M.views[view];
    const pw = Math.max(1, Math.round(w)), ph = Math.max(1, Math.round(h));
    if (glc.width !== pw || glc.height !== ph) { glc.width = pw; glc.height = ph; }
    const s = Math.min(pw, ph)/M.size, def = deformer(M, V, p);
    const [back, front] = view === 'side' ? [['armFar', 'legFar', 'legNear'], ['armNear']] : [V.arms, []];
    const tex = V.tex[p.face] || V.tex.happy || Object.values(V.tex)[0];
    clear();
    for (const a of back) mesh(armMesh(M, V, p, def, a), uvArm, idxArm, nArm, V.armImg[a], s);
    mesh(bodyMesh(M, V, def), uvBody, idxBody, nBody, tex, s);
    for (const a of front) mesh(armMesh(M, V, p, def, a), uvArm, idxArm, nArm, V.armImg[a], s);
    if (V.band && V.armFill.armL) {   // shoulder blend: arm colour over the body's outline band, so the outlines join
      grab(tmpA); clear();
      for (const a of back) if (V.armFill[a]) mesh(armMesh(M, V, p, def, a), uvArm, idxArm, nArm, V.armFill[a], s);
      const fills = grab(tmpB); clear(); mesh(bodyMesh(M, V, def), uvBody, idxBody, nBody, V.band, s);
      const fg = fills.getContext('2d'); fg.globalCompositeOperation = 'destination-in'; fg.drawImage(glc, 0, 0); fg.globalCompositeOperation = 'source-over';
      ctx.drawImage(tmpA, x, y, w, h); ctx.drawImage(fills, x, y, w, h); return true;
    }
    ctx.drawImage(glc, x, y, w, h); return true;
  }
  window.BakeryMesh = {build, poseFor, draw, ACTIONS: Object.keys(A)};
})();
