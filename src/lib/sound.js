/**
 * Notification chime using Web Audio API.
 * Two-tone ascending chime: C5 (523Hz) → E5 (659Hz), 300ms total.
 */

const SAMPLE_RATE = 22050;

function generateChimeSamples() {
  const duration = 0.3;
  const samples = Math.floor(SAMPLE_RATE * duration);
  const buffer = new Float32Array(samples);

  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE;
    const half = duration / 2;

    let freq, vol;
    if (t < half) {
      freq = 523.25; // C5
      vol = 1 - (t / half) * 0.3;
    } else {
      freq = 659.25; // E5
      const t2 = t - half;
      vol = 1 - t2 / half;
    }

    const attack = Math.min(1, t * 50);
    const release = Math.min(1, (duration - t) * 20);
    const envelope = attack * release * vol * 0.4;

    buffer[i] = Math.sin(2 * Math.PI * freq * t) * envelope;
  }

  return buffer;
}

export function playChime(volume = 0.5) {
  try {
    const ctx = new AudioContext();
    const samples = generateChimeSamples();
    const audioBuffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    audioBuffer.getChannelData(0).set(samples);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    const gain = ctx.createGain();
    gain.gain.value = volume;

    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();

    // Clean up after playback
    source.onended = () => ctx.close();
  } catch (e) {
    console.error('[PagePulse] Chime playback failed:', e);
  }
}
