// Shared NVG simulation engine: world renderer, NVG compositor, drawing helpers, overlays, player.
"use strict";
const W = 1280, H = 720;
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const world = document.createElement('canvas'); world.width = W; world.height = H;
const wx = world.getContext('2d');
const TL = window.TIMELINE;
const FONT = 'Inter, "DejaVu Sans", sans-serif';

// ---------- utilities ----------
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function gray(l, a = 1) { const v = Math.round(clamp(l, 0, 1) * 255); return `rgba(${v},${v},${v},${a})`; }

let FRAME = 0;
let SC = null, LT = 0;           // current scene + local time
function sStart(i) { const s = SC.sentences[Math.min(i, SC.sentences.length - 1)]; return s ? s.start : 0; }
function sEnd(i) { const s = SC.sentences[Math.min(i, SC.sentences.length - 1)]; return s ? s.start + s.dur : 0; }
function reveal(at, len = 0.5) { return smooth(at, at + len, LT); }

// ---------- noise (tube scintillation) ----------
const NOISE = [];
(function () { const r = rng(7); for (let k = 0; k < 10; k++) { const c = document.createElement('canvas'); c.width = 427; c.height = 240; const g = c.getContext('2d'); const id = g.createImageData(c.width, c.height); for (let i = 0; i < id.data.length; i += 4) { const v = r() < 0.5 ? 0 : Math.pow(r(), 3) * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; } g.putImageData(id, 0, 0); NOISE.push(c); } })();

// ---------- NVG road world ----------
const CX = 640, CY = 338, R = 300, HY = 300;
const F = R / Math.tan(20 * Math.PI / 180);  // 40 deg FOV across the tube
let CAMH = 2.6;                              // eye height (m): PLS cab 2.6, standing guide ~1.7
let CURV = 1;   // 0 = straight lane (motor pool / yard)
const curve = z => CURV * (14 * Math.sin(z / 110) + 6 * Math.sin(z / 41 + 1.3));
const dcurve = z => CURV * (14 / 110 * Math.cos(z / 110) + 6 / 41 * Math.cos(z / 41 + 1.3));
// project a point in camera space (x right, z ahead, y up), ignoring the road curve
function projL(x, z, y, yaw = 0) { return { x: CX + (x / z - yaw) * F, y: HY + (CAMH - y) / z * F, s: F / z }; }

const PROPS = [];
(function () { const r = rng(42); let z = 5; while (z < 6000) { z += 8 + r() * 22; const side = r() < 0.5 ? -1 : 1; const k = r(); PROPS.push({ z, x: side * (7 + r() * 26), type: k < 0.62 ? 'tree' : k < 0.85 ? 'bush' : 'stake', h: 5 + r() * 7, w: 0.6 + r() * 0.8, seed: r() }); } })();
const STARS = []; (function () { const r = rng(99); for (let i = 0; i < 260; i++) STARS.push({ a: (r() - 0.5) * 3.2, y: r() * HY, b: 0.4 + r() * 0.6 }); })();

// project world point (lateral X relative to road centre at the camera, depth z ahead of camera)
function proj(camZ, laneX, yaw, xOff, z, y) {
  const xr = curve(camZ + z) - curve(camZ) - dcurve(camZ) * z + xOff - laneX;
  return { x: CX + (xr / z - yaw) * F, y: HY + (CAMH - y) / z * F, s: F / z };
}

// opts: camZ, yaw, laneX, illum, extras(fn), dash
function drawRoadWorld(o) {
  CURV = o.straight ? 0 : 1; CAMH = o.camH ?? 2.6;
  const g = wx, camZ = o.camZ, yaw = o.yaw || 0, laneX = o.laneX ?? 1.6, il = o.illum ?? 1;
  const FOG = o.fog || 0, fogL = 0.36 * il, fm = (l, z) => FOG ? lerp(l, fogL, 1 - Math.exp(-z / FOG)) : l;
  // sky
  const sky = g.createLinearGradient(0, 0, 0, HY);
  sky.addColorStop(0, gray(0.10 * il)); sky.addColorStop(1, gray(0.34 * il));
  g.fillStyle = FOG ? gray(fogL) : sky; g.fillRect(0, 0, W, HY + 1);
  if (!FOG) for (const s of STARS) { const x = CX + (s.a - yaw) * F * 0.9; if (x < 0 || x > W) continue; g.fillStyle = gray(s.b); g.fillRect(x, s.y, 2, 2); }
  // tree line on the horizon
  g.fillStyle = gray(fm(0.12 * il, 300));
  g.beginPath(); g.moveTo(0, HY + 2);
  for (let x = 0; x <= W; x += 6) { const a = (x - CX) / F + yaw + camZ * 0.0004; const h = 10 + 14 * hash(Math.floor(a * 40)) + 8 * Math.sin(a * 9) + 6 * Math.sin(a * 23); g.lineTo(x, HY - h); }
  g.lineTo(W, HY + 2); g.closePath(); g.fill();
  // ground rows
  for (let y = HY + 1; y < H; y++) {
    const z = CAMH * F / (y - HY); const wz = camZ + z;
    const fade = clamp(1 - z / 400, 0.25, 1);
    const tex = 0.03 * hash(Math.floor(wz * 1.3)) + 0.02 * ((Math.floor(wz / 4) & 1));
    g.fillStyle = gray(fm((0.24 + tex) * il * (0.7 + 0.3 * fade), z)); g.fillRect(0, y, W, 1);
    const xr = curve(wz) - curve(camZ) - dcurve(camZ) * z - laneX;
    const cx = CX + (xr / z - yaw) * F, hw = 4.2 / z * F;
    g.fillStyle = gray(fm((0.46 + tex * 1.5) * il * (0.75 + 0.25 * fade), z)); g.fillRect(cx - hw, y, hw * 2, 1);
    g.fillStyle = gray(fm((0.34 + tex) * il, z)); const rw = Math.max(1, 0.35 / z * F);
    g.fillRect(cx - 1.9 / z * F - rw / 2, y, rw, 1); g.fillRect(cx + 1.0 / z * F - rw / 2, y, rw, 1);
  }
  // props far -> near
  const vis = [];
  if (o.props !== false) for (const p of PROPS) { const z = p.z - camZ; if (z > 2.5 && z < 420 && Math.abs(p.x) > (o.clearX || 0)) vis.push([z, p]); }
  if (o.objects) for (const ob of o.objects) { const z = ob.z - camZ; if (z > 1.5 && z < 600) vis.push([z, ob]); }
  vis.sort((a, b) => b[0] - a[0]);
  for (const [z, p] of vis) {
    const b = proj(camZ, laneX, yaw, p.x, z, 0), s = b.s; if (b.x < -200 || b.x > W + 200) continue;
    const fog = clamp(1 - z / 450, 0.3, 1);
    g.globalAlpha = FOG ? Math.exp(-z / FOG) : 1;
    if (p.type === 'tree') {
      g.fillStyle = gray(0.10 * il * fog + 0.04); g.beginPath();
      g.ellipse(b.x, b.y - p.h * 0.62 * s, p.h * 0.32 * s, p.h * 0.5 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillRect(b.x - 0.15 * s, b.y - p.h * 0.3 * s, 0.3 * s, p.h * 0.3 * s);
    } else if (p.type === 'bush') {
      g.fillStyle = gray(0.16 * il * fog + 0.03); g.beginPath(); g.ellipse(b.x, b.y - 0.5 * s, 1.3 * s, 0.7 * s, 0, 0, Math.PI * 2); g.fill();
    } else if (p.type === 'stake') {
      g.fillStyle = gray(0.55 * il); g.fillRect(b.x - 0.05 * s, b.y - 1.2 * s, Math.max(1, 0.1 * s), 1.2 * s);
      g.fillStyle = gray(0.95); g.fillRect(b.x - 0.06 * s, b.y - 1.15 * s, Math.max(2, 0.12 * s), Math.max(2, 0.12 * s));
    } else if (p.type === 'truck') {           // rear of a vehicle
      const w = 2.5 * s, h = 3.2 * s;
      g.fillStyle = gray(0.22 * il + 0.05); g.fillRect(b.x - w / 2, b.y - h, w, h * 0.85);
      g.fillStyle = gray(0.08); g.fillRect(b.x - w / 2, b.y - h * 0.28, w, h * 0.13);
      g.fillStyle = gray(0.05); for (const dx of [-0.9, 0.9]) g.fillRect(b.x + dx * s - 0.3 * s, b.y - 1.0 * s, 0.6 * s, 1.0 * s);
      g.fillStyle = gray(1); for (const dx of [-1.05, 1.05]) { g.beginPath(); g.arc(b.x + dx * s, b.y - 1.4 * s, Math.max(1.5, 0.09 * s), 0, 7); g.fill(); }
    } else if (p.type === 'person') {
      const h = 1.8 * s; g.fillStyle = gray(0.6 * il + 0.15);
      g.beginPath(); g.arc(b.x, b.y - h * 0.92, h * 0.08, 0, 7); g.fill(); g.fillRect(b.x - h * 0.09, b.y - h * 0.84, h * 0.18, h * 0.45);
      g.fillRect(b.x - h * 0.08, b.y - h * 0.4, h * 0.06, h * 0.4); g.fillRect(b.x + h * 0.02, b.y - h * 0.4, h * 0.06, h * 0.4);
    } else if (p.type === 'oncoming') {
      const w = 2.4 * s, h = 2.6 * s;
      g.fillStyle = gray(0.2 * il + 0.05); g.fillRect(b.x - w / 2, b.y - h, w, h * 0.9);
      p._screen = [proj(camZ, laneX, yaw, p.x - 0.8, z, 1.0), proj(camZ, laneX, yaw, p.x + 0.8, z, 1.0)];
    } else if (p.type === 'guide') {
      drawGuide(g, b.x, b.y, s, p, il);
    } else if (p.type === 'barrier') {
      g.fillStyle = gray(0.42 * il + 0.08); g.beginPath(); g.moveTo(b.x - 1.0 * s, b.y); g.lineTo(b.x - 0.35 * s, b.y - 0.8 * s); g.lineTo(b.x + 0.35 * s, b.y - 0.8 * s); g.lineTo(b.x + 1.0 * s, b.y); g.fill();
    } else if (p.type === 'cone') {
      g.fillStyle = gray(0.55 * il + 0.1); g.beginPath(); g.moveTo(b.x - 0.18 * s, b.y); g.lineTo(b.x, b.y - 0.7 * s); g.lineTo(b.x + 0.18 * s, b.y); g.fill();
      g.fillStyle = gray(0.9); g.fillRect(b.x - 0.08 * s, b.y - 0.42 * s, 0.16 * s, Math.max(1, 0.08 * s));
    } else if (p.type === 'ditch') {
      const w = (p.w || 6) * s, d = 1.4 * s; g.fillStyle = gray(p.lum ?? 0.05); g.beginPath(); g.ellipse(b.x, b.y, w / 2, Math.max(2, d * 0.25), 0, 0, 7); g.fill();
    }
  }
  g.globalAlpha = 1;
  if (o.flank) drawFlank(g, il);
  if (o.cab === false) { if (o.extras) o.extras(g); return; }
  // cab: dash + pillars (fixed to vehicle, so shifted by head yaw)
  const sh = -yaw * F;
  g.fillStyle = gray(0.06);
  g.beginPath(); g.moveTo(-200 + sh, H); g.lineTo(-200 + sh, 640); g.quadraticCurveTo(CX + sh, 600, W + 200 + sh, 640); g.lineTo(W + 200 + sh, H); g.closePath(); g.fill();
  const dash = o.dash ?? 0.12;
  for (let i = 0; i < 5; i++) { g.fillStyle = gray(dash * (i === 2 ? 1.6 : 1)); g.beginPath(); g.arc(CX - 160 + i * 80 + sh, 668, 18, 0, 7); g.fill(); }
  g.fillStyle = gray(0.04);
  for (const sgn of [-1, 1]) { const px = CX + sgn * 0.78 * F + sh; g.beginPath(); g.moveTo(px - 40, H); g.lineTo(px + sgn * 90 - 30, 0); g.lineTo(px + sgn * 90 + 40, 0); g.lineTo(px + 40, H); g.fill();
    // west-coast mirror
    const mx = CX + sgn * 0.95 * F + sh; g.fillStyle = gray(0.05); g.fillRect(mx - 22, 280, 44, 110); g.fillStyle = gray(0.2 * il); g.fillRect(mx - 16, 286, 32, 98); g.fillStyle = gray(0.04); }
  if (o.extras) o.extras(g);
}

// Ground guide figure. p.pose = {l, r}: arm angles in radians from straight down (positive = raised outward).
// p.lights: 'ir' | 'filtered' | 'white' | null. Hand positions are stored in p._hands (world-canvas coords).
function drawGuide(g, x, y, s, p, il) {
  const h = 1.8 * s, pose = p.pose || { l: 0.3, r: 0.3 };
  const shY = y - h * 0.80, shW = h * 0.12, arm = h * 0.40;
  const body = gray(0.58 * il + 0.16);
  g.fillStyle = body; g.strokeStyle = body;
  g.beginPath(); g.arc(x, y - h * 0.92, h * 0.075, 0, 7); g.fill();
  g.fillRect(x - shW, shY, shW * 2, h * 0.40);
  g.fillRect(x - h * 0.10, y - h * 0.42, h * 0.08, h * 0.42); g.fillRect(x + h * 0.02, y - h * 0.42, h * 0.08, h * 0.42);
  if (p.vest) { g.fillStyle = gray(0.85); g.fillRect(x - shW, shY + h * 0.12, shW * 2, h * 0.05); g.fillRect(x - shW, shY + h * 0.26, shW * 2, h * 0.05); }
  g.lineWidth = Math.max(2, h * 0.07); g.lineCap = 'round';
  p._hands = [];
  for (const [side, a] of [[-1, pose.l], [1, pose.r]]) {
    const sx = x + side * shW, hx = sx + side * Math.sin(a) * arm, hy = shY + Math.cos(a) * arm;
    g.beginPath(); g.moveTo(sx, shY + h * 0.03); g.lineTo(hx, hy); g.stroke();
    const wl = h * 0.22, wa = a + (pose.wand || 0);
    const tx = hx + side * Math.sin(wa) * wl, ty = hy + Math.cos(wa) * wl;
    g.lineWidth = Math.max(2, h * 0.035); g.strokeStyle = gray(0.25); g.beginPath(); g.moveTo(hx, hy); g.lineTo(tx, ty); g.stroke();
    g.lineWidth = Math.max(2, h * 0.07); g.strokeStyle = body;
    p._hands.push({ x: hx, y: hy, tx, ty, s });
  }
  if (p.aimAt) p._aim = { x: (p._hands[1].x), y: p._hands[1].y, s };
}
// side of the PLS seen from the left mirror (truck runs from the camera toward +z, flank at x = +0.7 m)
function drawFlank(g, il) {
  const pts = [[0.7, 1.6, 0.9], [0.7, 11.2, 0.9], [0.7, 11.2, 2.9], [0.7, 1.6, 2.9]].map(([x, z, y]) => projL(x, z, y));
  g.fillStyle = gray(0.13 * il + 0.03); g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)); g.closePath(); g.fill();
  g.strokeStyle = gray(0.05); g.lineWidth = 2;
  for (let z = 2.5; z < 11.2; z += 1.4) { const a = projL(0.7, z, 0.9), b = projL(0.7, z, 2.9); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
  g.fillStyle = gray(0.03);
  for (const z of [7.4, 8.8, 10.2]) { const c = projL(0.85, z, 0.55); g.beginPath(); g.ellipse(c.x, c.y, 0.25 * c.s, 0.55 * c.s, 0, 0, 7); g.fill(); }
  // mirror housing edge
  g.fillStyle = gray(0.02); g.fillRect(W - 60, 0, 60, H); g.fillRect(0, H - 40, W, 40);
}
// glow helper (use in post callbacks)
function glow(c, x, y, r, rgb, a = 1) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.18, `rgba(${rgb},${0.7 * a})`); g.addColorStop(1, `rgba(${rgb},0)`);
  c.globalCompositeOperation = 'lighter'; c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r); c.globalCompositeOperation = 'source-over';
}
// draw the wands of every guide object as light sources
function wandLights(c, objs, rgb, a = 1, scale = 1) {
  for (const p of objs) if (p._hands && p.lights) for (const hnd of p._hands) {
    c.strokeStyle = `rgba(${rgb},${a})`; c.lineWidth = Math.max(3, hnd.s * 0.09); c.lineCap = 'round';
    c.beginPath(); c.moveTo(hnd.x, hnd.y); c.lineTo(hnd.tx, hnd.ty); c.stroke();
    glow(c, (hnd.x + hnd.tx) / 2, (hnd.y + hnd.ty) / 2, Math.max(14, hnd.s * 0.9) * scale, rgb, a * 0.9);
  }
}

// Naked-eye night view of the world canvas, into a rectangle (default: full frame).
function composeUnaided(o = {}) {
  const r = o.rect || [0, 0, W, H], k = r[2] / W, ox = r[0], oy = r[1] + (r[3] - H * k) / 2;
  if (!o.rect) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
  ctx.save(); ctx.beginPath(); roundRect(r[0], r[1], r[2], r[3], o.radius ?? 0); ctx.clip();
  ctx.fillStyle = '#000'; ctx.fillRect(r[0], r[1], r[2], r[3]);
  ctx.filter = `grayscale(1) brightness(${(o.gain ?? 0.32).toFixed(3)}) blur(${o.blur ?? 0.6}px)`;
  ctx.drawImage(world, ox, oy, W * k, H * k); ctx.filter = 'none';
  ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#93a6cf'; ctx.fillRect(r[0], r[1], r[2], r[3]); ctx.globalCompositeOperation = 'source-over';
  if (o.post) { ctx.save(); ctx.translate(ox, oy); ctx.scale(k, k); o.post(ctx); ctx.restore(); }
  if (o.wash) { ctx.fillStyle = `rgba(255,255,240,${o.wash})`; ctx.fillRect(r[0], r[1], r[2], r[3]); }
  ctx.restore();
}

// compose NVG image from the world canvas onto main ctx
function composeNVG(o = {}) {
  const full = o.cx === undefined, cx = o.cx ?? CX, cy = o.cy ?? CY, rr = o.r ?? R, k = rr / R, ox = cx - CX * k, oy = cy - CY * k;
  const blur = o.blur || 0, nblur = o.noiseBlur || 0, gain = o.gain ?? 1, wash = o.wash || 0, nz = o.noise ?? 0.16;
  if (full) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    // unaided eye: very dim night view
    ctx.globalAlpha = 0.07 * (1 - (o.unaidedLoss || 0)); ctx.drawImage(world, 0, 0); ctx.globalAlpha = 1;
  }
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#000'; ctx.fillRect(cx - rr, cy - rr, 2 * rr, 2 * rr);
  const filt = [];
  if (blur > 0.05) filt.push(`blur(${blur.toFixed(2)}px)`);
  if (Math.abs(gain - 1) > 0.01) filt.push(`brightness(${gain.toFixed(3)})`);
  if (o.contrast) filt.push(`contrast(${o.contrast})`);
  ctx.filter = filt.length ? filt.join(' ') : 'none';
  ctx.drawImage(world, ox, oy, W * k, H * k); ctx.filter = 'none';
  if (o.post) { ctx.save(); ctx.translate(ox, oy); ctx.scale(k, k); o.post(ctx); ctx.restore(); }  // bright sources etc. (grayscale space)
  ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#7dff8f'; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = 'rgba(14,46,20,1)'; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = nz; if (nblur > 0.05) ctx.filter = `blur(${nblur.toFixed(2)}px)`;
  ctx.drawImage(NOISE[FRAME % NOISE.length], cx - rr, cy - rr, rr * 2, rr * 2); ctx.filter = 'none';
  ctx.globalAlpha = 1;
  if (wash > 0) { ctx.fillStyle = `rgba(200,255,205,${wash})`; ctx.fillRect(0, 0, W, H); }
  ctx.globalCompositeOperation = 'source-over';
  const vg = ctx.createRadialGradient(cx, cy, rr * 0.55, cx, cy, rr);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = vg; ctx.fillRect(cx - rr, cy - rr, 2 * rr, 2 * rr);
  ctx.restore();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(cx, cy, rr + 2, 0, 7); ctx.stroke();
}

// ---------- shared drawing ----------
function panel(x, y, w, h, fill = 'rgba(6,16,9,0.86)', stroke = 'rgba(93,255,122,0.25)') {
  ctx.fillStyle = fill; roundRect(x, y, w, h, 10); ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke();
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function text(s, x, y, size, color = '#d8f5dc', weight = 500, align = 'left', alpha = 1) {
  ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(s, x, y); ctx.globalAlpha = 1;
}
function wrap(s, maxW, size, weight = 500) {
  ctx.font = `${weight} ${size}px ${FONT}`; const words = s.split(' '), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
const GREEN = '#4be36a', RED = '#ff4d4d', AMBER = '#ffbf3c';
function check(x, y, s, col = GREEN) { ctx.strokeStyle = col; ctx.lineWidth = s * 0.16; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - s * 0.4, y); ctx.lineTo(x - s * 0.1, y + s * 0.3); ctx.lineTo(x + s * 0.45, y - s * 0.35); ctx.stroke(); }
function cross(x, y, s, col = RED) { ctx.strokeStyle = col; ctx.lineWidth = s * 0.16; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - s * 0.35, y - s * 0.35); ctx.lineTo(x + s * 0.35, y + s * 0.35); ctx.moveTo(x + s * 0.35, y - s * 0.35); ctx.lineTo(x - s * 0.35, y + s * 0.35); ctx.stroke(); }
function tag(label, x, y, col, alpha = 1, size = 22) {
  if (alpha <= 0) return; ctx.globalAlpha = alpha; ctx.font = `700 ${size}px ${FONT}`; const w = ctx.measureText(label).width + 28;
  ctx.fillStyle = 'rgba(0,0,0,0.7)'; roundRect(x - w / 2, y - size, w, size * 1.6, 6); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.fillText(label, x, y + size * 0.3); ctx.globalAlpha = 1;
}
function mapBG() {
  ctx.fillStyle = '#07110a'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(93,255,122,0.06)'; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke(); }
}

// M1075A1 top view, front pointing +x. (x,y) = front bumper centre. ppm = pixels per metre.
const PLS_L = 10.8, PLS_W = 2.44;
function plsTop(x, y, ppm, o = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(o.ang || 0);
  const L = PLS_L * ppm, Wd = PLS_W * ppm;
  ctx.fillStyle = '#0d0d0d';
  for (const ax of [0.95, 2.45, 6.6, 8.0, 9.4]) for (const s of [-1, 1]) ctx.fillRect(-ax * ppm - 0.6 * ppm, s * (Wd / 2) - (s > 0 ? 0.55 * ppm : -0.05 * ppm) - 0.25 * ppm, 1.2 * ppm, 0.55 * ppm);
  ctx.fillStyle = o.body || '#5f6b45'; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5;
  roundRect(-2.7 * ppm, -Wd / 2, 2.7 * ppm, Wd, 0.3 * ppm); ctx.fill(); ctx.stroke();                    // cab
  ctx.fillStyle = o.deck || '#4a5537'; ctx.fillRect(-L, -Wd / 2 + 0.05 * ppm, L - 3.1 * ppm, Wd - 0.1 * ppm); // flatrack
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; for (let i = 1; i < 6; i++) { const xx = -L + i * (L - 3.1 * ppm) / 6; ctx.beginPath(); ctx.moveTo(xx, -Wd / 2); ctx.lineTo(xx, Wd / 2); ctx.stroke(); }
  ctx.fillStyle = '#3b442c'; ctx.fillRect(-3.1 * ppm, -0.5 * ppm, 0.4 * ppm, ppm);                         // LHS hook arm
  ctx.fillStyle = 'rgba(160,220,255,0.35)'; ctx.fillRect(-0.55 * ppm, -Wd / 2 + 0.2 * ppm, 0.35 * ppm, Wd - 0.4 * ppm); // windshield
  if (o.ir) { ctx.fillStyle = '#eaffef'; ctx.shadowColor = '#9dffb0'; ctx.shadowBlur = 12; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(-L + 0.1 * ppm, s * (Wd / 2 - 0.2 * ppm), Math.max(2, 0.18 * ppm), 0, 7); ctx.fill(); } ctx.shadowBlur = 0; }
  if (o.label) { ctx.rotate(-(o.ang || 0)); text(o.label, -L / 2, -Wd / 2 - 10, 16, '#b9d9be', 600, 'center'); }
  ctx.restore();
}
// side view silhouette (for title)
function plsSide(x, y, s, col) {
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(0, -1.0 * s); ctx.lineTo(0, -3.0 * s); ctx.lineTo(0.3 * s, -3.25 * s); ctx.lineTo(2.6 * s, -3.25 * s); ctx.lineTo(2.7 * s, -1.0 * s); ctx.closePath(); ctx.fill();
  ctx.fillRect(2.7 * s, -1.6 * s, 8.1 * s, 0.6 * s);
  ctx.fillRect(3.0 * s, -3.6 * s, 6.6 * s, 2.0 * s);                     // container on flatrack
  ctx.fillRect(2.75 * s, -3.0 * s, 0.35 * s, 1.4 * s);                    // hook arm
  ctx.fillStyle = '#000'; for (const ax of [0.95, 2.45, 6.6, 8.0, 9.4]) { ctx.beginPath(); ctx.arc(ax * s, -0.6 * s, 0.6 * s, 0, 7); ctx.fill(); }
  ctx.fillStyle = col; for (const ax of [0.95, 2.45, 6.6, 8.0, 9.4]) { ctx.beginPath(); ctx.arc(ax * s, -0.6 * s, 0.25 * s, 0, 7); ctx.fill(); }
  ctx.restore();
}

// ---------- overlays ----------
function overlays(sc, lt) {
  if (sc.type !== 'title' && sc.type !== 'end') {
    const a = smooth(0, 0.5, lt);
    ctx.globalAlpha = a;
    const kind = sc.kind, col = kind === 'do' ? GREEN : kind === 'dont' ? RED : '#7dff8f';
    let x = 28;
    if (kind !== 'info') {
      const lab = kind === 'do' ? 'DO' : "DON'T"; ctx.font = `900 24px ${FONT}`; const w = ctx.measureText(lab).width + 60;
      ctx.fillStyle = col; roundRect(x, 22, w, 44, 8); ctx.fill();
      ctx.fillStyle = '#04100a'; ctx.textAlign = 'left'; ctx.fillText(lab, x + 46, 53);
      if (kind === 'do') check(x + 24, 44, 26, '#04100a'); else cross(x + 24, 44, 24, '#04100a');
      x += w + 14;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.font = `800 26px ${FONT}`; const tw = ctx.measureText(sc.title).width + 28;
    roundRect(x, 22, tw, 44, 8); ctx.fill(); text(sc.title, x + 14, 53, 26, '#eaffef', 800);
    if (sc.section) { ctx.font = `800 15px ${FONT}`; const sw = ctx.measureText(sc.section).width + 24; ctx.fillStyle = 'rgba(0,0,0,0.6)'; roundRect(28, 74, sw, 28, 6); ctx.fill(); ctx.strokeStyle = sc.section.includes('WITH NVD') ? 'rgba(93,255,122,0.7)' : 'rgba(147,166,207,0.8)'; ctx.lineWidth = 1.5; ctx.stroke(); text(sc.section, 28 + sw / 2, 93, 15, sc.section.includes('WITH NVD') ? '#9dffb0' : '#c3cfe8', 800, 'center'); }
    if (sc.ref) { ctx.font = `600 15px ${FONT}`; const rw = ctx.measureText(sc.ref).width + 24; ctx.fillStyle = 'rgba(0,0,0,0.6)'; roundRect(W - 28 - rw, 28, rw, 32, 6); ctx.fill(); text(sc.ref, W - 28 - rw / 2, 50, 15, '#9dbba2', 600, 'center'); }
    ctx.globalAlpha = 1;
  }
  // caption
  let cur = null;
  for (const s of sc.sentences) if (lt >= s.start - 0.15 && lt <= s.start + s.dur + 0.35) cur = s;
  if (cur) {
    const lines = wrap(cur.text, 1040, 25, 500), lh = 33, bh = lines.length * lh + 22, by = H - 22 - bh;
    ctx.fillStyle = 'rgba(0,0,0,0.72)'; roundRect(100, by, 1080, bh, 10); ctx.fill();
    lines.forEach((l, i) => text(l, 640, by + 36 + i * lh, 25, '#f2fff3', 500, 'center'));
  }
  // progress
  const T = TL.total, now = sc.start + lt;
  ctx.fillStyle = 'rgba(93,255,122,0.15)'; ctx.fillRect(0, H - 4, W, 4); ctx.fillStyle = 'rgba(93,255,122,0.7)'; ctx.fillRect(0, H - 4, W * now / T, 4);
}

function renderAt(T) {
  T = clamp(T, 0, TL.total - 1e-3);
  let sc = TL.scenes[TL.scenes.length - 1];
  for (const s of TL.scenes) if (T >= s.start && T < s.start + s.dur) { sc = s; break; }
  SC = sc; LT = T - sc.start;
  ctx.save(); SCENES[sc.type](LT, sc.dur); ctx.restore();
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  // scene transitions: quick fade through black
  const fin = 1 - smooth(0, 0.45, LT), fout = smooth(sc.dur - 0.35, sc.dur, LT);
  const f = Math.max(sc === TL.scenes[0] ? 0 : fin, sc === TL.scenes[TL.scenes.length - 1] ? 0 : fout);
  if (f > 0) { ctx.fillStyle = `rgba(0,0,0,${f})`; ctx.fillRect(0, 0, W, H); }
  overlays(sc, LT);
}
window.renderFrame = function (T, frame) { FRAME = frame ?? Math.floor(T * 30); renderAt(T); };

// ---------- player ----------
// Call after the page has defined SCENES.
function startPlayer() {
  if (location.search.includes('render')) { document.body.classList.add('render'); return; }
{
  const aud = document.getElementById('aud'), btn = document.getElementById('play'), seek = document.getElementById('seek'), tc = document.getElementById('tc');
  seek.max = TL.total; let playing = false, t0 = 0, base = 0;
  const now = () => playing ? base + (performance.now() - t0) / 1000 : base;
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  btn.onclick = () => { if (playing) { base = now(); playing = false; aud.pause(); btn.textContent = 'Play'; } else { if (base >= TL.total - 0.1) base = 0; playing = true; t0 = performance.now(); aud.currentTime = base; aud.play().catch(() => {}); btn.textContent = 'Pause'; } };
  seek.oninput = () => { base = +seek.value; t0 = performance.now(); aud.currentTime = base; };
  (function loop() { const T = now(); if (T >= TL.total) { playing = false; base = TL.total; btn.textContent = 'Play'; } FRAME++; renderAt(T); seek.value = T; tc.textContent = fmt(T) + ' / ' + fmt(TL.total); requestAnimationFrame(loop); })();
}
}
