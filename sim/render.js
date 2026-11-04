#!/usr/bin/env node
// Render sim/index.html to MP4 deterministically (frame by frame) and mux narration.
// Usage: node sim/render.js [--fps 30] [--workers 4] [--stills t1,t2,...]
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const path = require('path'), fs = require('fs');

const ROOT = path.resolve(__dirname, '..'), BUILD = path.join(ROOT, 'build');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const FPS = +arg('fps', 30), WORKERS = +arg('workers', 4), STILLS = arg('stills', null);
const OUT = path.join(ROOT, arg('out', 'NVG_PVS-14_PLS_Dos_and_Donts.mp4'));
const URL = 'file://' + path.join(ROOT, 'sim', 'index.html') + '?render';

async function page(browser) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto(URL); await p.evaluate(() => document.fonts.ready);
  return p;
}
const grab = (p, t, f) => p.evaluate(([t, f]) => { window.renderFrame(t, f); return document.getElementById('c').toDataURL('image/jpeg', 0.93).split(',')[1]; }, [t, f]);

(async () => {
  fs.mkdirSync(BUILD, { recursive: true });
  const browser = await chromium.launch();
  if (STILLS) {
    const p = await page(browser);
    for (const t of STILLS.split(',').map(Number)) fs.writeFileSync(path.join(BUILD, `still_${t}.jpg`), Buffer.from(await grab(p, t, Math.round(t * FPS)), 'base64'));
    await browser.close(); return;
  }
  const total = await (await page(browser)).evaluate(() => window.TIMELINE.total);
  const N = Math.round(total * FPS), per = Math.ceil(N / WORKERS), t0 = Date.now();
  let done = 0;
  const parts = await Promise.all([...Array(WORKERS).keys()].map(async w => {
    const a = w * per, b = Math.min(N, a + per), file = path.join(BUILD, `part${w}.mp4`);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(FPS), file], { stdio: ['pipe', 'inherit', 'inherit'] });
    const p = await page(browser);
    for (let f = a; f < b; f++) {
      const buf = Buffer.from(await grab(p, f / FPS, f), 'base64');
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (++done % 300 === 0) console.log(`${done}/${N} frames  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end(); await new Promise(r => ff.on('close', r));
    return file;
  }));
  await browser.close();
  const list = path.join(BUILD, 'parts.txt'); fs.writeFileSync(list, parts.map(f => `file '${f}'`).join('\n'));
  // audio: narration + low engine rumble bed
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-i', path.join(BUILD, 'narration.wav'),
    '-f', 'lavfi', '-t', String(total), '-i', 'anoisesrc=color=brown:amplitude=0.5:seed=3',
    '-filter_complex', `[1:a]aresample=48000,volume=1.0[n];[2:a]aresample=48000,lowpass=f=140,volume=0.18,afade=t=in:d=2,afade=t=out:st=${total - 3}:d=3[r];[n][r]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest', OUT], { stdio: 'inherit' });
  console.log('wrote', OUT, ((Date.now() - t0) / 1000).toFixed(0) + 's');
})();
