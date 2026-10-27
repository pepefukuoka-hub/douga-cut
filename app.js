(() => {
  'use strict';
  const VER = 4;
  const $ = (id) => document.getElementById(id);
  const vid = $('vid');
  let file = null, audio = null, url = null, dur = 0, S = 0, E = 0, ff = null, busy = false, outUrl = null;

  const fmt = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };
  const showErr = (m) => { $('err').textContent = m || ''; };
  const say = (m) => { $('msg').textContent = m || ''; };

  // ---- 動画を読み込む ----
  function loadVideo(f) {
    if (!f) return;
    showErr(''); say(''); $('done').hidden = true;
    file = f;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(f);
    vid.src = url; vid.muted = false; vid.volume = 1;
    drawWave(f);
    vid.onloadedmetadata = () => {
      dur = vid.duration || 0;
      if (!isFinite(dur) || dur <= 0) { showErr('この動画は、読み込めませんでした。'); return; }
      S = 0; E = dur; syncUi(); $('editor').hidden = false;
      $('drop').querySelector('strong').textContent = f.name;
    };
    vid.onerror = () => showErr('この動画は、このブラウザでは、読み込めませんでした。別の動画で試してください。');
  }
  $('fileV').addEventListener('change', (e) => loadVideo(e.target.files[0]));
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => {
    const fs = [...e.dataTransfer.files];
    const v = fs.find((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(f.name));
    const a = fs.find((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|wav|aac|ogg)$/i.test(f.name));
    if (v) loadVideo(v);
    if (a) setAudio(a);
  });
  // ページのどこに落としても、ブラウザが動画を開かないようにする
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // ---- 音の波形(音が聞こえなくても、切る場所が分かるように) ----
  let waveTok = 0, wavePk = null, waveMx = 1;
  async function drawWave(f) {
    const cv = $('wave'), g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
    const tok = ++waveTok; wavePk = null; $('autoMsg').textContent = '';
    if (f.size > 400 * 1048576) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const buf = await ac.decodeAudioData(await f.arrayBuffer());
      ac.close && ac.close();
      if (tok !== waveTok) return;
      const d = buf.getChannelData(0), n = cv.width, step = Math.max(1, Math.floor(d.length / n));
      const pk = new Float32Array(n); let mx = 1e-6;
      for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step; j < Math.min(d.length, (i + 1) * step); j += 8) { const v = Math.abs(d[j]); if (v > m) m = v; } pk[i] = m; if (m > mx) mx = m; }
      wavePk = pk; waveMx = mx;
      g.fillStyle = getComputedStyle(cv).color || '#888';
      for (let i = 0; i < n; i++) { const h = Math.max(1, pk[i] / mx * 34); g.fillRect(i, 18 - h / 2 + 4, 1, h); }
    } catch (e) { /* 波形が出せなくても、切り取りはできる */ }
  }
  // 画面の動きを調べて、動画が始まった所と終わった所を探す
  async function scanMotion(onProg) {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video')); setTimeout(res, 8000); });
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 36;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const step = Math.max(0.25, dur / 480), n = Math.floor(dur / step);
    let prev = null; const diff = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      await new Promise((res) => { const t = setTimeout(res, 2500); v.onseeked = () => { clearTimeout(t); res(); }; v.currentTime = Math.min(dur - 0.05, i * step); });
      g.drawImage(v, 0, 0, 64, 36);
      const px = g.getImageData(0, 0, 64, 36).data, cur = new Uint8Array(64 * 36);
      for (let k = 0; k < cur.length; k++) cur[k] = (px[k * 4] + px[k * 4 + 1] + px[k * 4 + 2]) / 3;
      if (prev) { let s = 0; for (let k = 0; k < cur.length; k++) s += Math.abs(cur[k] - prev[k]); diff[i] = s / cur.length; }
      prev = cur;
      if (i % 8 === 0) onProg(i / n);
    }
    v.removeAttribute('src'); v.load();
    return { diff, step };
  }
  // 動きが続いている区間のうち、最初の始まりと、最後の終わりを返す
  function motionRange({ diff, step }) {
    const n = diff.length, sorted = Float32Array.from(diff).sort(), p90 = sorted[Math.floor(n * 0.9)] || 0;
    const th = Math.max(1.2, p90 * 0.25);
    const act = Array.from(diff, (d) => d > th);
    const need = Math.max(2, Math.min(Math.round(3 / step), Math.round(n * 0.3)));   // 約3秒以上続く動き
    const runs = []; let i = 0;
    while (i < n) {
      if (!act[i]) { i++; continue; }
      let s = i, last = i, gap = 0;
      for (let j = i; j < n; j++) { if (act[j]) { last = j; gap = 0; } else if (++gap > Math.max(1, Math.round(0.5 / step))) break; }
      if (last - s + 1 >= need) runs.push([s, last + 1]);
      i = last + 1;
    }
    if (!runs.length) return null;
    return [runs[0][0] * step, Math.min(dur, runs[runs.length - 1][1] * step + step)];
  }
  function audioRange() {
    if (!wavePk) return null;
    const th = waveMx * 0.06, n = wavePk.length; let a = -1, b = -1;
    for (let i = 0; i < n; i++) if (wavePk[i] > th) { a = i; break; }
    for (let i = n - 1; i >= 0; i--) if (wavePk[i] > th) { b = i + 1; break; }
    return (a < 0 || b <= a) ? null : [a / n * dur, b / n * dur];
  }
  $('auto').addEventListener('click', async () => {
    const msg = $('autoMsg'), btn = $('auto'); btn.disabled = true;
    try {
      let m = null;
      try { m = motionRange(await scanMotion((p) => { msg.textContent = '画面の動きを調べています… ' + Math.round(p * 100) + '%'; })); } catch (e) { m = null; }
      const au = audioRange();
      if (!m && !au) { msg.textContent = '動きも音も見つかりませんでした。手で合わせてください。'; return; }
      const a = [m, au].filter(Boolean);
      const pad = 0.2;
      S = Math.max(0, Math.min(...a.map((r) => r[0])) - pad); E = Math.min(dur, Math.max(...a.map((r) => r[1])) + pad);
      if (E - S < MIN) { S = 0; E = dur; }
      syncUi(); vid.currentTime = S;
      msg.textContent = '合わせました(' + fmt(S) + ' 〜 ' + fmt(E) + ')。使った手がかり: ' + [m && '画面の動き', au && '音'].filter(Boolean).join('と') + '。前後は、つまみで直せます。';
    } finally { btn.disabled = false; }
  });
  vid.addEventListener('timeupdate', () => { if (dur) $('head').style.left = (vid.currentTime / dur * 100) + '%'; });
  vid.addEventListener('seeked', () => { if (dur) $('head').style.left = (vid.currentTime / dur * 100) + '%'; });

  // ---- 音楽 ----
  function setAudio(f) {
    audio = f;
    $('aName').textContent = f ? f.name : '音楽ファイルを選ぶ';
    $('aClear').hidden = !f;
    if (f) $('musicBox').open = true;
  }
  $('fileA').addEventListener('change', (e) => setAudio(e.target.files[0]));
  $('aClear').addEventListener('click', () => { $('fileA').value = ''; setAudio(null); });

  // ---- 範囲 ----
  const rS = $('rS'), rE = $('rE');
  function syncUi() {
    $('tS').textContent = fmt(S); $('tE').textContent = fmt(E); $('tL').textContent = fmt(E - S);
    rS.value = Math.round(S / dur * 1000); rE.value = Math.round(E / dur * 1000);
    const l = S / dur * 100, r = E / dur * 100;
    $('sel').style.left = l + '%'; $('sel').style.width = (r - l) + '%';
  }
  const MIN = 0.1;
  rS.addEventListener('input', () => {
    S = Math.min(rS.value / 1000 * dur, E - MIN); if (S < 0) S = 0; syncUi(); vid.currentTime = S;
  });
  rE.addEventListener('input', () => {
    E = Math.max(rE.value / 1000 * dur, S + MIN); if (E > dur) E = dur; syncUi(); vid.currentTime = Math.max(0, E - 0.05);
  });
  $('setS').addEventListener('click', () => { S = Math.min(vid.currentTime, E - MIN); if (S < 0) S = 0; syncUi(); });
  $('setE').addEventListener('click', () => { E = Math.max(vid.currentTime, S + MIN); if (E > dur) E = dur; syncUi(); });
  $('back1').addEventListener('click', () => { vid.currentTime = Math.max(0, vid.currentTime - 1); });
  $('fwd1').addEventListener('click', () => { vid.currentTime = Math.min(dur, vid.currentTime + 1); });
  $('playSel').addEventListener('click', () => {
    vid.muted = false; vid.volume = 1; vid.currentTime = S; vid.play().catch(() => {});
    const stop = () => { if (vid.currentTime >= E) { vid.pause(); vid.removeEventListener('timeupdate', stop); } };
    vid.addEventListener('timeupdate', stop);
  });

  // ---- 書き出し ----
  async function getFF() {
    if (ff) return ff;
    if (!window.FFmpegWASM) throw new Error('編集の部品が読み込めませんでした');
    const f = new FFmpegWASM.FFmpeg();
    f.on('progress', ({ progress }) => { if (progress >= 0 && progress <= 1) $('prog').value = Math.round(progress * 100); });
    f.on('log', ({ message }) => { f._log = (f._log || []).concat(message).slice(-12); });
    const abs = (p) => new URL(p, location.href).href;
    await f.load({ coreURL: abs('vendor/ffmpeg-core.js'), wasmURL: abs('vendor/ffmpeg-core.wasm') });
    ff = f; return f;
  }
  const ext = (n) => ((n.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();

  async function run(f, args) {
    f._log = [];
    const code = await f.exec(args);
    if (code !== 0) { const e = new Error('ffmpeg ' + code); e.log = (f._log || []).join('\n'); throw e; }
  }

  async function go() {
    if (busy || !file) return;
    busy = true; showErr(''); $('done').hidden = true; $('go').disabled = true;
    const prog = $('prog'); prog.hidden = false; prog.value = 0;
    let mounted = [];
    try {
      say('編集の部品を、準備しています(はじめは少し待ちます)…');
      const f = await getFF();
      const webm = ext(file.name) === 'webm';
      const outName = webm ? 'out.webm' : 'out.mp4';
      const inV = new File([file], 'in_v.' + (ext(file.name) || 'mp4'), { type: file.type });
      await f.createDir('/v'); mounted.push('/v');
      await f.mount('WORKERFS', { files: [inV] }, '/v');
      const src = ['-ss', String(S), '-i', '/v/' + inV.name];
      let music = [], hasA = false;
      if (audio) {
        const inA = new File([audio], 'in_a.' + (ext(audio.name) || 'mp3'), { type: audio.type });
        await f.createDir('/a'); mounted.push('/a');
        await f.mount('WORKERFS', { files: [inA] }, '/a');
        music = ['-i', '/a/' + inA.name]; hasA = true;
      }
      const exact = $('mode').value === 'exact';
      const D = String(E - S);
      const vcodec = exact ? (webm ? ['-c:v', 'libvpx', '-b:v', '3M'] : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p']) : ['-c:v', 'copy'];
      const acodec = webm ? ['-c:a', 'libopus'] : ['-c:a', 'aac', '-b:a', '192k'];
      say('切り取っています…');
      const base = [...src, ...music, '-t', D];
      let args;
      if (!hasA) {
        args = [...base, ...vcodec, ...(exact ? acodec : ['-c:a', 'copy']), '-avoid_negative_ts', 'make_zero', outName];
        await run(f, args);
      } else if ($('aMode').value === 'replace') {
        args = [...base, '-map', '0:v:0', '-map', '1:a:0', ...vcodec, ...acodec, '-shortest', outName];
        await run(f, args);
      } else {
        const mix = [...base, '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0,volume=2[a]',
          '-map', '0:v:0', '-map', '[a]', ...vcodec, ...acodec, outName];
        try { await run(f, mix); }
        catch (e) {   // 動画に音がないときは、音楽だけにする
          say('動画に音がなかったので、音楽だけを入れます…');
          await run(f, [...base, '-map', '0:v:0', '-map', '1:a:0', ...vcodec, ...acodec, '-shortest', outName]);
        }
      }
      const data = await f.readFile(outName);
      await f.deleteFile(outName);
      const blob = new Blob([data.buffer], { type: webm ? 'video/webm' : 'video/mp4' });
      if (outUrl) URL.revokeObjectURL(outUrl);
      outUrl = URL.createObjectURL(blob);
      $('outV').src = outUrl;
      const base0 = file.name.replace(/\.[^.]+$/, '');
      const name = base0 + '_cut.' + (webm ? 'webm' : 'mp4');
      const dl = $('dl'); dl.href = outUrl; dl.download = name;
      const outFile = new File([blob], name, { type: blob.type });
      const sh = $('share');
      sh.hidden = !(navigator.canShare && navigator.canShare({ files: [outFile] }));
      sh.onclick = () => navigator.share({ files: [outFile] }).catch(() => {});
      $('outInfo').textContent = '長さ ' + fmt(E - S) + ' / 大きさ ' + (blob.size / 1048576).toFixed(1) + ' MB';
      $('done').hidden = false; prog.value = 100; say('できました。');
      $('done').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      say('');
      showErr('失敗しました: ' + (e && e.message || e) + (e && e.log ? '\n' + e.log.split('\n').slice(-4).join('\n') : '') +
        '\n動画が大きすぎる(メモリ不足)可能性があります。短い範囲や、小さい動画で試してください。');
      if (ff && /abort|memory|out of/i.test(String(e && e.message))) { try { ff.terminate(); } catch (_) {} ff = null; }
    } finally {
      if (ff) for (const m of mounted.reverse()) { try { await ff.unmount(m); await ff.deleteDir(m); } catch (_) {} }
      busy = false; $('go').disabled = false; prog.hidden = true;
    }
  }
  $('go').addEventListener('click', go);

  $('ver').textContent = '版 ' + VER;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
