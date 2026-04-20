// DropScreen — entry animation. Shown on login and when opening a project.
// Press the big orange button → shipping container drops, impacts, screen opens.
// Double meaning: shipping container (ecommerce goods) + construction dumpster.
// The container ridges echo the sidebar texture — same DNA, same company.

// ── Synthesized sound — no audio files needed ──────────────────────────────
function playDropSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Whoosh — rising filtered noise as the container falls
    const bufferSize = Math.floor(ctx.sampleRate * 0.82);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(180, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(1400, ctx.currentTime + 0.75);
    filter.Q.value = 0.6;

    const whooshGain = ctx.createGain();
    whooshGain.gain.setValueAtTime(0, ctx.currentTime);
    whooshGain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + 0.15);
    whooshGain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.6);
    whooshGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.82);

    noise.connect(filter);
    filter.connect(whooshGain);
    whooshGain.connect(ctx.destination);
    noise.start(ctx.currentTime);
    noise.stop(ctx.currentTime + 0.85);

    // THUD — deep sine drop on impact, synced to landing
    const impactAt = ctx.currentTime + 0.78;

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(90, impactAt);
    thud.frequency.exponentialRampToValueAtTime(22, impactAt + 0.28);

    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.9, impactAt);
    thudGain.gain.exponentialRampToValueAtTime(0.001, impactAt + 0.32);

    thud.connect(thudGain);
    thudGain.connect(ctx.destination);
    thud.start(impactAt);
    thud.stop(impactAt + 0.35);

    // Sub-rumble — sawtooth underneath the thud
    const sub = ctx.createOscillator();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime(45, impactAt);
    sub.frequency.exponentialRampToValueAtTime(14, impactAt + 0.22);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.45, impactAt);
    subGain.gain.exponentialRampToValueAtTime(0.001, impactAt + 0.26);

    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start(impactAt);
    sub.stop(impactAt + 0.28);

    // Short metallic rattle after impact
    const rattleAt = impactAt + 0.05;
    const rattleBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.18), ctx.sampleRate);
    const rd = rattleBuf.getChannelData(0);
    for (let i = 0; i < rd.length; i++) rd[i] = (Math.random() * 2 - 1);

    const rattle = ctx.createBufferSource();
    rattle.buffer = rattleBuf;

    const rattleFilter = ctx.createBiquadFilter();
    rattleFilter.type = 'highpass';
    rattleFilter.frequency.value = 2400;

    const rattleGain = ctx.createGain();
    rattleGain.gain.setValueAtTime(0.18, rattleAt);
    rattleGain.gain.linearRampToValueAtTime(0, rattleAt + 0.18);

    rattle.connect(rattleFilter);
    rattleFilter.connect(rattleGain);
    rattleGain.connect(ctx.destination);
    rattle.start(rattleAt);
    rattle.stop(rattleAt + 0.2);

  } catch(e) {
    // AudioContext not available — silent fail
  }
}

// ── Component ─────────────────────────────────────────────────────────────
window.DropScreen = function DropScreen({ onEnter, label }) {
  const [phase, setPhase] = React.useState('idle');
  // idle → dropping → impact → out

  function fire() {
    if (phase !== 'idle') return;
    playDropSound();
    setPhase('dropping');
    setTimeout(() => setPhase('impact'), 780);
    setTimeout(() => setPhase('out'),    1320);
    setTimeout(onEnter,                  1960);
  }

  // Also fire on spacebar / Enter anywhere on this screen
  React.useEffect(() => {
    function onKey(e) {
      if (e.code === 'Space' || e.code === 'Enter') fire();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  const heroGone   = phase !== 'idle';
  const showBox    = phase !== 'idle';
  const isDropping = phase === 'dropping';
  const isImpact   = phase === 'impact';
  const isOut      = phase === 'out';

  // Dust puffs — 8 particles in different directions, orange/amber mix
  const dust = [
    { tx: -95,  ty: -38, size: 22, color: '#e8921a', delay: 0  },
    { tx:  98,  ty: -42, size: 18, color: '#c4522a', delay: 45 },
    { tx: -138, ty:  12, size: 16, color: '#f0a830', delay: 20 },
    { tx:  145, ty:   8, size: 14, color: '#e8921a', delay: 65 },
    { tx: -62,  ty: -72, size: 13, color: '#c4522a', delay: 10 },
    { tx:  68,  ty: -68, size: 20, color: '#f0a830', delay: 38 },
    { tx: -118, ty: -52, size: 10, color: '#e8921a', delay: 55 },
    { tx:  122, ty: -48, size: 12, color: '#d4721a', delay: 18 },
  ];

  return (
    <div className={
      'ds-screen' +
      (isOut    ? ' ds-screen--out'   : '') +
      (isImpact ? ' ds-screen--shake' : '')
    }>

      {/* ── Hero: wordmark + tagline + button ── */}
      <div className={'ds-hero' + (heroGone ? ' ds-hero--gone' : '')}>
        <div className="ds-wordmark">
          <span className="ds-word-main">Active</span>
          <span className="ds-word-sub">— Acquisitions —</span>
        </div>

        {label
          ? <p className="ds-tagline">{label}</p>
          : <p className="ds-tagline">SMASH THESE INVOICES IN</p>
        }

        {/* The big industrial DROP button */}
        <button className="ds-btn" onClick={fire} aria-label="Drop the container">
          <span className="ds-btn-icon">⬇</span>
          <span className="ds-btn-label">DROP IT</span>
        </button>

        <span className="ds-skip" role="button" tabIndex={0}
          onClick={onEnter}
          onKeyDown={e => e.key === 'Enter' && onEnter()}>
          skip →
        </span>
      </div>

      {/* ── The shipping container ── */}
      {showBox && (
        <div className={'ds-ctr-wrap' + (isDropping ? ' ds-ctr-wrap--dropping' : '')}>

          {/* Hanging cables — visible during fall */}
          {isDropping && (
            <div className="ds-cables" aria-hidden="true">
              <div className="ds-cable" style={{ left: '14%' }} />
              <div className="ds-cable" style={{ right: '14%' }} />
            </div>
          )}

          {/* Container box */}
          <div className="ds-ctr" aria-hidden="true">
            <div className="ds-ctr-rail ds-ctr-rail--top" />
            <div className="ds-ctr-body">
              <div className="ds-ctr-seam" />
              <div className="ds-ctr-text">
                <div className="ds-ctr-name">ACTIVE</div>
                <div className="ds-ctr-sub">· ACQUISITIONS ·</div>
              </div>
            </div>
            <div className="ds-ctr-rail ds-ctr-rail--bot" />
            <div className="ds-ctr-corner" style={{ top: 2,    left: 2  }} />
            <div className="ds-ctr-corner" style={{ top: 2,    right: 2 }} />
            <div className="ds-ctr-corner" style={{ bottom: 2, left: 2  }} />
            <div className="ds-ctr-corner" style={{ bottom: 2, right: 2 }} />
          </div>

          {!isDropping && <div className="ds-ground-shadow" aria-hidden="true" />}

          {isImpact && (
            <div className="ds-dust-origin" aria-hidden="true">
              {dust.map((d, i) => (
                <div key={i} className="ds-puff" style={{
                  width:  d.size,
                  height: d.size,
                  background: d.color,
                  '--tx': d.tx + 'px',
                  '--ty': d.ty + 'px',
                  animationDelay: d.delay + 'ms',
                }} />
              ))}
            </div>
          )}

        </div>
      )}

    </div>
  );
};
