// Shared NVG simulation engine: world renderer, NVG compositor, drawing helpers, overlays, player.
"use strict";
const W = 1280, H = 720;
const cv = document.getElementById('c'); let ctx = cv.getContext('2d');
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
    } else if (p.type === 'truck') {           // M1075A1 seen from behind; each part projected at its own depth
      const L = 0.22 * il + 0.05;
      const part = (dz, x0, x1, h0, h1, l) => { const q = proj(camZ, laneX, yaw, p.x, z + dz, 0); g.fillStyle = gray(l); g.fillRect(q.x + x0 * q.s, q.y - h1 * q.s, (x1 - x0) * q.s, (h1 - h0) * q.s); };
      const back = PLS.LF;
      part(back - PLS.cab[1], -PLS.W / 2, PLS.W / 2, 1.0, PLS.cabH, L * 0.85);                 // cab rear wall
      part(back - PLS.equip[1], -1.12, 1.12, 1.45, PLS.equipH, L);                            // equipment module
      part(back - PLS.spare[1], -0.66, 0.66, PLS.cabH, PLS.cabH + 0.43, 0.05);                // spare tyre on top
      part(back - PLS.hook[1], -0.45, 0.45, 1.45, PLS.H - 0.15, L * 1.1);                     // hook arm
      for (const sg of [-1, 1]) part(back - PLS.axles[4], sg * PLS.track / 2 - PLS.tireW / 2, sg * PLS.track / 2 + PLS.tireW / 2, 0, PLS.tireR * 2, 0.04);
      part(back - PLS.L + 0.1, -1.15, 1.15, 0.7, 1.2, 0.08);                                   // rear bumper / frame
      if (p.load !== 'none') part(0.3, -1.1, 1.1, PLS.deckH, PLS.deckH + 1.2, L * 1.15);       // palletized load
      part(0, -1.22, 1.22, PLS.deckH - 0.3, PLS.deckH, L * 1.35);                             // flatrack rear sill
      g.fillStyle = gray(1); for (const dx of [-1.05, 1.05]) { const q = proj(camZ, laneX, yaw, p.x + dx, z + back - PLS.L + 0.05, 1.05); g.beginPath(); g.arc(q.x, q.y, Math.max(1.5, 0.09 * q.s), 0, 7); g.fill(); }
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
// Left side of the PLS seen in the driver's left mirror (camera at the mirror, looking rearward along the truck).
// Body side at x = +0.7 m from the camera; z = distance behind the mirror = u - PLS_MIRROR.u.
function drawFlank(g, il) {
  const z0 = PLS_MIRROR.u;
  const side = (x, u0, u1, h0, h1, l) => { const q = [[u0, h0], [u1, h0], [u1, h1], [u0, h1]].map(([u, h]) => projL(x, Math.max(0.6, u - z0), h)); g.fillStyle = gray(l); g.beginPath(); q.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.fill(); };
  const L = 0.13 * il + 0.03;
  // far to near
  for (const ax of PLS.axles.slice(1).reverse()) { const c = projL(0.78, ax - z0, PLS.tireR); g.fillStyle = gray(0.03); g.beginPath(); g.ellipse(c.x, c.y, 0.2 * c.s, PLS.tireR * c.s, 0, 0, 7); g.fill(); }
  side(0.74, PLS.rack[0], PLS.rack[1], PLS.deckH - 0.3, PLS.deckH, L * 1.3);                       // flatrack side rail
  for (const [u0, u1, h] of [[9.6, 11.1, 1.25], [7.6, 9.4, 1.1], [5.6, 7.4, 1.25]]) side(0.9, u0, u1, PLS.deckH, PLS.deckH + h, L * 1.1);   // palletized load
  side(0.95, 1.6, PLS.L, PLS.frame[0], PLS.frame[1], L * 0.6);                                     // frame rail
  side(1.96, PLS.hook[0], PLS.hook[1], 1.45, PLS.H - 0.15, L * 1.2);                               // hook arm (centre line)
  side(0.9, PLS.spare[0], PLS.spare[1], PLS.cabH, PLS.cabH + 0.43, 0.04);                          // spare tyre on top
  side(0.85, PLS.equip[0], PLS.equip[1], 1.45, PLS.equipH, L);                                     // equipment module
  side(0.83, PLS.engine[0], PLS.engine[1], 1.45, PLS.engineH, L * 0.9);                            // engine module
  g.strokeStyle = gray(0.03); g.lineWidth = 2;
  for (let u = PLS.engine[0] + 0.15; u < PLS.engine[1]; u += 0.15) { const a = projL(0.83, u - z0, 1.6), b = projL(0.83, u - z0, 2.6); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
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

// ---------- M1075A1 PLS geometry (Oshkosh PLS A1 M1075A1 spec sheet, 2015) ----------
// Metres from the front bumper. Length 10.795 m (11.303 m with flatrack), width 2.517 m, height 3.277 m,
// wheelbase 5.715 m, track 1.93 m, 16.00R20 tyres, 10x10, steering axles 1, 2 and 5.
// Axle and component positions measured from the spec-sheet side-view drawing (scaled to the 425 in length).
const PLS = {
  L: 10.795, LF: 11.303, W: 2.517, H: 3.277, track: 1.93, tireR: 0.675, tireW: 0.42,
  axles: [1.99, 3.47, 6.91, 8.42, 9.97],
  cab: [0, 1.74], cabH: 2.67, engine: [1.85, 2.9], engineH: 2.72, equip: [2.9, 4.1], equipH: 2.55,
  spare: [2.7, 4.0], hook: [4.8, 5.15], rack: [5.25, 11.303], deckH: 1.742, frame: [1.0, 1.45],
};
const PLS_L = PLS.LF, PLS_W = PLS.W;

// Top view, front pointing +x. (x,y) = front bumper centre. ppm = pixels per metre.
// o: { ang, ir, label, noRack, rackShift (m, flatrack sliding rearward), body, deck }
function plsTop(x, y, ppm, o = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(o.ang || 0);
  const m = v => v * ppm, hw = PLS.W / 2, tw = PLS.track / 2;
  // tyres (dual-width singles, all ten)
  ctx.fillStyle = '#0b0b0b';
  for (const ax of PLS.axles) for (const sg of [-1, 1]) roundRect(-m(ax + PLS.tireR), sg * m(tw) - m(PLS.tireW / 2), m(PLS.tireR * 2), m(PLS.tireW), m(0.12)), ctx.fill();
  // frame rails
  ctx.fillStyle = '#272c20'; ctx.fillRect(-m(PLS.L), -m(0.5), m(PLS.L - 1.6), m(1.0));
  // flatrack: bed, side rails, slats, front A-frame
  if (!o.noRack) {
    const r0 = PLS.rack[0] + (o.rackShift || 0), r1 = PLS.rack[1] + (o.rackShift || 0), rw = 2.44;
    ctx.fillStyle = o.deck || '#4f5a3a'; ctx.fillRect(-m(r1), -m(rw / 2), m(r1 - r0), m(rw));
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
    for (let u = r0 + 0.6; u < r1; u += 0.6) { ctx.beginPath(); ctx.moveTo(-m(u), -m(rw / 2)); ctx.lineTo(-m(u), m(rw / 2)); ctx.stroke(); }
    ctx.fillStyle = '#3f482e'; ctx.fillRect(-m(r1), -m(rw / 2), m(r1 - r0), m(0.12)); ctx.fillRect(-m(r1), m(rw / 2 - 0.12), m(r1 - r0), m(0.12));
    ctx.fillStyle = '#353d27'; ctx.beginPath(); ctx.moveTo(-m(r0), -m(rw / 2)); ctx.lineTo(-m(r0 + 0.9), 0); ctx.lineTo(-m(r0), m(rw / 2)); ctx.closePath(); ctx.fill();
  }
  // LHS hook arm
  ctx.fillStyle = '#3b442c'; ctx.fillRect(-m(PLS.hook[1]), -m(0.45), m(PLS.hook[1] - PLS.hook[0]), m(0.9));
  ctx.fillStyle = '#1e2318'; ctx.fillRect(-m(PLS.hook[0] + 0.05), -m(0.12), m(0.12), m(0.24));
  // equipment module with the spare tyre carried flat on top
  ctx.fillStyle = '#56603f'; ctx.fillRect(-m(PLS.equip[1]), -m(1.12), m(PLS.equip[1] - PLS.equip[0]), m(2.24));
  ctx.fillStyle = '#121212'; ctx.beginPath(); ctx.arc(-m((PLS.spare[0] + PLS.spare[1]) / 2), 0, m(0.66), 0, 7); ctx.fill();
  ctx.fillStyle = '#3a3a3a'; ctx.beginPath(); ctx.arc(-m((PLS.spare[0] + PLS.spare[1]) / 2), 0, m(0.3), 0, 7); ctx.fill();
  // engine / radiator module
  ctx.fillStyle = '#5b6643'; ctx.fillRect(-m(PLS.engine[1]), -m(1.15), m(PLS.engine[1] - PLS.engine[0]), m(2.3));
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; for (let u = PLS.engine[0] + 0.15; u < PLS.engine[1]; u += 0.15) { ctx.beginPath(); ctx.moveTo(-m(u), -m(0.8)); ctx.lineTo(-m(u), m(0.8)); ctx.stroke(); }
  // cab (full width, flat sloped nose), windshield, roof hatch, west-coast mirrors
  ctx.fillStyle = o.body || '#66714b'; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5;
  roundRect(-m(PLS.cab[1]), -m(hw), m(PLS.cab[1]), m(PLS.W), m(0.18)); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(160,220,255,0.35)'; ctx.fillRect(-m(0.5), -m(hw - 0.15), m(0.3), m(PLS.W - 0.3));
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-m(1.2), -m(0.3), m(0.5), m(0.6));
  ctx.fillStyle = '#1e2318'; for (const sg of [-1, 1]) ctx.fillRect(-m(0.55), sg * m(hw + 0.08) - (sg < 0 ? m(0.22) : 0), m(0.18), m(0.22));
  if (o.ir) { ctx.fillStyle = '#eaffef'; ctx.shadowColor = '#9dffb0'; ctx.shadowBlur = 12; for (const sg of [-1, 1]) { ctx.beginPath(); ctx.arc(-m(PLS.L) + 2, sg * m(hw - 0.2), Math.max(2, m(0.18)), 0, 7); ctx.fill(); } ctx.shadowBlur = 0; }
  if (o.label) { ctx.rotate(-(o.ang || 0)); text(o.label, -m(PLS.LF) / 2, -m(hw) - 10, 16, '#b9d9be', 600, 'center'); }
  ctx.restore();
}
// mirror position (driver's side = -y in top view) relative to the front bumper, metres
const PLS_MIRROR = { u: 0.46, v: -(PLS.W / 2 + 0.2) };

// Side view, front at the left. (x,y) = front bumper at ground level; s = pixels per metre.
// col = silhouette colour; o.load: 'pallets' | 'container' | 'none'
const _sideCv = document.createElement('canvas'); _sideCv.width = W; _sideCv.height = H;
function plsSide(x, y, s, col, o = {}) {
  // draw opaque on an offscreen canvas, then composite once so overlapping parts don't double up
  const m = /rgba\(([^,]+),([^,]+),([^,]+),\s*([\d.]+)\)/.exec(col);
  if (m && !o._inner) {
    const sc = _sideCv.getContext('2d'); sc.clearRect(0, 0, W, H);
    const saved = ctx; ctx = sc; try { plsSide(x, y, s, `rgb(${m[1]},${m[2]},${m[3]})`, { ...o, _inner: true }); } finally { ctx = saved; }
    ctx.save(); ctx.globalAlpha *= +m[4]; ctx.drawImage(_sideCv, 0, 0); ctx.restore(); return;
  }
  const P = (u, h) => [x + u * s, y - h * s];
  const poly = (pts, fill) => { ctx.fillStyle = fill; ctx.beginPath(); pts.forEach(([u, h], i) => { const [a, b] = P(u, h); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.closePath(); ctx.fill(); };
  const rect = (u0, u1, h0, h1, fill) => poly([[u0, h0], [u1, h0], [u1, h1], [u0, h1]], fill);
  const dark = 'rgba(0,0,0,0.55)', load = o.load || 'pallets';
  ctx.save();
  // load on the flatrack
  if (load === 'container') rect(PLS.rack[0] + 0.1, PLS.rack[1], PLS.deckH, PLS.deckH + 2.44, col);
  if (load === 'pallets') for (const [u0, u1, h] of [[5.6, 7.4, 1.25], [7.6, 9.4, 1.1], [9.6, 11.1, 1.25]]) rect(u0, u1, PLS.deckH, PLS.deckH + h, col);
  if (load === 'pallets') for (const [u0, u1, h] of [[5.6, 7.4, 1.25], [7.6, 9.4, 1.1], [9.6, 11.1, 1.25]]) rect(u0 + 0.05, u1 - 0.05, PLS.deckH + h * 0.48, PLS.deckH + h * 0.52, dark);
  // flatrack bed + front A-frame
  rect(PLS.rack[0], PLS.rack[1], PLS.deckH - 0.3, PLS.deckH, col);
  poly([[PLS.rack[0], PLS.deckH], [PLS.rack[0] + 0.25, PLS.deckH], [PLS.rack[0] + 0.12, 2.75], [PLS.rack[0] - 0.05, 2.75]], col);
  // frame rails and rear bumper
  rect(1.6, PLS.L, PLS.frame[0], PLS.frame[1], col);
  rect(PLS.L - 0.25, PLS.L, 0.7, PLS.frame[1], col);
  // hook arm with the hook at the top
  rect(PLS.hook[0], PLS.hook[1], 1.45, PLS.H - 0.15, col);
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, 0.1 * s); ctx.beginPath(); const [hx, hy] = P(PLS.hook[0] + 0.05, PLS.H - 0.2); ctx.arc(hx, hy, 0.16 * s, Math.PI * 0.1, Math.PI * 1.3, true); ctx.stroke();
  // equipment module, spare tyre on top, engine module
  rect(PLS.equip[0], PLS.equip[1], 1.45, PLS.equipH, col);
  { const [a0, b0] = P(PLS.spare[0], PLS.cabH + 0.43), r = 0.215 * s; ctx.fillStyle = col; roundRect(a0, b0, (PLS.spare[1] - PLS.spare[0]) * s, 0.43 * s, r); ctx.fill();
    ctx.fillStyle = dark; for (let u = PLS.spare[0] + 0.2; u < PLS.spare[1] - 0.15; u += 0.13) { const [a, b] = P(u, PLS.cabH + 0.38); ctx.fillRect(a, b, 0.045 * s, 0.33 * s); } }
  rect(PLS.engine[0], PLS.engine[1], 1.45, PLS.engineH, col);
  for (let h = 1.75; h < 2.6; h += 0.12) rect(PLS.engine[0] + 0.12, PLS.engine[1] - 0.12, h, h + 0.04, dark);
  // cab: sloped nose, flat roof, step-up over the first axle
  rect(4.4, 6.2, 0.55, 1.25, col); rect(4.5, 6.1, 0.85, 0.9, dark);                    // fuel tank / battery box between axle groups
  poly([[0.08, 0.75], [0.0, 1.55], [0.1, 1.9], [0.44, PLS.cabH - 0.04], [0.56, PLS.cabH], [PLS.cab[1], PLS.cabH], [PLS.cab[1], 1.42], [1.32, 1.42], [1.15, 0.75]], col);
  poly([[0.16, 1.95], [0.42, 2.52], [0.5, 2.52], [0.27, 1.95]], dark);          // windshield edge
  rect(0.55, 1.28, 2.0, 2.5, dark);                                                  // door window
  rect(0.55, 1.3, 1.05, 1.9, 'rgba(0,0,0,0.18)');                                    // door
  rect(-0.1, 0.18, 0.55, 0.95, col); rect(0.82, 1.1, 0.42, 0.75, col);                 // front bumper, cab step
  // tyres
  for (const ax of PLS.axles) {
    const [cx, cy] = P(ax, PLS.tireR);
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(cx, cy, PLS.tireR * s, 0, 7); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, 0.05 * s); ctx.beginPath(); ctx.arc(cx, cy, PLS.tireR * s * 0.93, 0, 7); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy, 0.3 * s, 0, 7); ctx.fill();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(cx, cy, 0.09 * s, 0, 7); ctx.fill();
  }
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
