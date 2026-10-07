#!/usr/bin/env node
// Writes promo/out/soundtrack.wav: the original procedural soundtrack
// (src/audio-synth.js), 48 kHz stereo 16-bit, normalised to about -14 LUFS.
// It is the fallback for the MP4 when the licensed music is not on disk, and
// the same synth plays in the browser page.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesize } from './src/audio-synth.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(ROOT, 'out', 'soundtrack.wav');
mkdirSync(path.dirname(out), { recursive: true });

const t0 = Date.now();
const { left, right, sampleRate, lufs } = synthesize({ sampleRate: 48000 });
const n = left.length;
const buf = Buffer.alloc(44 + n * 4);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + n * 4, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(sampleRate, 24);
buf.writeUInt32LE(sampleRate * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) {
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767))), 44 + i * 4);
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767))), 46 + i * 4);
}
writeFileSync(out, buf);
console.log(`  soundtrack.wav: ${lufs.toFixed(1)} LUFS, ${(n / sampleRate).toFixed(2)} s, ${((Date.now() - t0) / 1000).toFixed(1)} s to synthesise`);
