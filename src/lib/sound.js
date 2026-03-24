/**
 * Generate a pleasant notification chime as a base64-encoded WAV.
 * Two-tone ascending chime: C5 (523Hz) → E5 (659Hz), 150ms each.
 * No external files needed — generated at runtime.
 */

const SAMPLE_RATE = 22050;

function generateChime() {
  const duration = 0.3; // seconds
  const samples = Math.floor(SAMPLE_RATE * duration);
  const buffer = new Float32Array(samples);

  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE;
    const half = duration / 2;

    // Two ascending tones
    let freq, vol;
    if (t < half) {
      freq = 523.25; // C5
      vol = 1 - (t / half) * 0.3; // slight fade
    } else {
      freq = 659.25; // E5
      const t2 = t - half;
      vol = (1 - t2 / half); // fade out
    }

    // Envelope
    const attack = Math.min(1, t * 50); // 20ms attack
    const release = Math.min(1, (duration - t) * 20); // 50ms release
    const envelope = attack * release * vol * 0.4;

    buffer[i] = Math.sin(2 * Math.PI * freq * t) * envelope;
  }

  return encodeWav(buffer);
}

function encodeWav(samples) {
  const numSamples = samples.length;
  const byteRate = SAMPLE_RATE * 2; // 16-bit mono
  const blockAlign = 2;
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, 1, true);  // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return buffer;
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// Convert to base64 data URL
let cachedDataUrl = null;

export function getChimeDataUrl() {
  if (!cachedDataUrl) {
    const wav = generateChime();
    const bytes = new Uint8Array(wav);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    cachedDataUrl = 'data:audio/wav;base64,' + btoa(binary);
  }
  return cachedDataUrl;
}
