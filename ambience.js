/* Soft background ambience for the landing screen.
   Everything is generated in the browser (no audio file): a slow warm pad, sparse
   kalimba-like notes, a faint breeze and the odd distant bird.
   It only sounds while the page is at the very top and fades out on the first scroll.
   Browsers do not allow sound before the visitor's first tap, click or key press. */
(() => {
  const btn = document.querySelector('.sound');
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!btn || !AC || !document.documentElement.classList.contains('js')) return;

  const LABELS = {
    en: { idle: 'Tap for sound', on: 'Sound on', off: 'Sound off' },
    kn: { idle: 'ಧ್ವನಿಗಾಗಿ ಒತ್ತಿ', on: 'ಧ್ವನಿ ಆನ್', off: 'ಧ್ವನಿ ಆಫ್' },
  };
  const label = btn.querySelector('.sound__label');
  const TOP_ZONE = 60;      // px of scroll that still counts as "the first screen"
  const LEVEL = 0.5;        // overall loudness (0 to 1)

  let muted = false;
  try { muted = localStorage.getItem('notf-sound') === 'off'; } catch (e) {}
  let ctx = null, master = null, built = false, suspendTimer = 0;

  const atTop = () => scrollY < TOP_ZONE;
  const state = () => (muted ? 'off' : built ? 'on' : 'idle');
  const paint = () => {
    const s = state();
    const lang = document.documentElement.lang === 'kn' ? 'kn' : 'en';
    btn.dataset.state = s;
    btn.setAttribute('aria-pressed', String(s === 'on'));
    btn.setAttribute('aria-label', LABELS[lang][s]);
    label.textContent = LABELS[lang][s];
  };

  /* ---------- The sound itself ---------- */
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  const CHORDS = [
    [50, 57, 64, 66],       // D add9
    [43, 50, 59, 66],       // G maj7
    [47, 54, 57, 62],       // B minor 7
    [45, 52, 59, 62],       // A sus
  ];
  const SCALE = [62, 64, 66, 69, 71, 74, 76, 78];   // D major pentatonic
  const CHORD_LEN = 11;
  let padBus, pluckBus, birdBus, nextChord = 0, chordIx = 0, nextPluck = 0, nextBird = 0, lastNote = 3;

  const build = () => {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 3;
    master = ctx.createGain(); master.gain.value = 0;
    master.connect(comp); comp.connect(ctx.destination);

    // Pad: everything goes through a gentle low-pass so it stays soft
    padBus = ctx.createBiquadFilter(); padBus.type = 'lowpass'; padBus.frequency.value = 1100; padBus.Q.value = 0.3;
    padBus.connect(master);

    // Plucks: dry + a soft echo for a sense of space
    pluckBus = ctx.createGain(); pluckBus.gain.value = 1;
    const delay = ctx.createDelay(1.5); delay.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 1800;
    const wet = ctx.createGain(); wet.gain.value = 0.45;
    pluckBus.connect(master);
    pluckBus.connect(delay); delay.connect(damp); damp.connect(fb); fb.connect(delay);
    damp.connect(wet); wet.connect(master);

    birdBus = ctx.createGain(); birdBus.gain.value = 1;
    birdBus.connect(master); birdBus.connect(delay);

    // Breeze: looped noise, band-passed and slowly swelling
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 520; band.Q.value = 0.4;
    const breeze = ctx.createGain(); breeze.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain); lfoGain.connect(breeze.gain);
    noise.connect(band); band.connect(breeze); breeze.connect(master);
    noise.start(); lfo.start();

    nextChord = ctx.currentTime + 0.1;
    nextPluck = ctx.currentTime + 2.5;
    nextBird = ctx.currentTime + 5;
    setInterval(schedule, 300);
    built = true;
  };

  const padNote = (m, t) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.055, t + 4);
    g.gain.setValueAtTime(0.055, t + CHORD_LEN - 1);
    g.gain.linearRampToValueAtTime(0, t + CHORD_LEN + 5);
    g.connect(padBus);
    [['sine', -4, 1], ['triangle', 5, 0.3]].forEach(([type, cents, level]) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz(m); o.detune.value = cents;
      const og = ctx.createGain(); og.gain.value = level;
      o.connect(og); og.connect(g);
      o.start(t); o.stop(t + CHORD_LEN + 5.2);
    });
  };

  const pluck = (m, t, level) => {
    [[1, level, 2.4], [2, level * 0.18, 0.9]].forEach(([mult, peak, decay]) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(m) * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g); g.connect(pluckBus);
      o.start(t); o.stop(t + decay + 0.05);
    });
  };

  const bird = t => {
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = pan || birdBus;
    if (pan) { pan.pan.value = rand(-0.8, 0.8); pan.connect(birdBus); }
    const base = rand(2600, 3800);
    const n = Math.floor(rand(2, 5));
    for (let i = 0; i < n; i++) {
      const s = t + i * rand(0.13, 0.2);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(base * rand(0.95, 1.05), s);
      o.frequency.exponentialRampToValueAtTime(base * rand(1.2, 1.5), s + 0.05);
      o.frequency.exponentialRampToValueAtTime(base * rand(0.85, 1.0), s + 0.11);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.012, s + 0.02);
      g.gain.linearRampToValueAtTime(0, s + 0.12);
      o.connect(g); g.connect(out);
      o.start(s); o.stop(s + 0.14);
    }
  };

  // Queue up the next second or so of sound. The audio clock stops while the context is
  // suspended, so nothing piles up when the music is paused.
  const schedule = () => {
    if (ctx.state !== 'running') return;
    const horizon = ctx.currentTime + 1;
    while (nextChord < horizon) {
      CHORDS[chordIx % CHORDS.length].forEach(m => padNote(m, nextChord));
      chordIx++; nextChord += CHORD_LEN;
    }
    while (nextPluck < horizon) {
      // Wander up and down the scale in small steps rather than jumping about
      lastNote = Math.max(0, Math.min(SCALE.length - 1, lastNote + pick([-2, -1, -1, 1, 1, 2])));
      pluck(SCALE[lastNote], nextPluck, rand(0.05, 0.09));
      if (Math.random() < 0.25) pluck(SCALE[Math.max(0, lastNote - 2)], nextPluck + 0.21, 0.04);
      nextPluck += pick([1.4, 2.1, 2.8, 2.8, 3.5, 4.2]);
    }
    while (nextBird < horizon) { bird(nextBird); nextBird += rand(6, 13); }
  };

  /* ---------- Play only on the first screen ---------- */
  const update = () => {
    paint();
    if (!built) return;
    const want = !muted && atTop() && !document.hidden;
    clearTimeout(suspendTimer);
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    if (want) {
      ctx.resume();
      master.gain.setTargetAtTime(LEVEL, now, 0.6);
    } else {
      master.gain.setTargetAtTime(0, now, 0.22);
      suspendTimer = setTimeout(() => ctx.suspend(), 1400);
    }
  };

  const unlock = () => {
    if (built || muted) return;
    if (!ctx) ctx = new AC();
    const ready = () => { if (!built && ctx.state === 'running') { build(); update(); } };
    ctx.resume().then(ready, () => {});
  };

  document.addEventListener('click', e => {
    if (!btn.contains(e.target)) { unlock(); return; }
    if (state() === 'on') muted = true;
    else { muted = false; unlock(); }
    try { localStorage.setItem('notf-sound', muted ? 'off' : 'on'); } catch (err) {}
    update();
  });
  document.addEventListener('keydown', e => { if (!btn.contains(e.target)) unlock(); });
  document.addEventListener('touchend', e => { if (!btn.contains(e.target)) unlock(); }, { passive: true });

  let wasTop = atTop();
  addEventListener('scroll', () => { const t = atTop(); if (t !== wasTop) { wasTop = t; update(); } }, { passive: true });
  document.addEventListener('visibilitychange', update);
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  paint();
})();
