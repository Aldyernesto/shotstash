/**
 * Story 8.2: synthetic sample media for a public demo, generated on the
 * server at seed time. Nothing here is a photo of anything real: stills are
 * vector landscapes rendered by sharp, clips come from ffmpeg's built-in
 * generators with a sine tone, the document is a hand-written PDF. No faces,
 * no people, no real places.
 */
import { execFile } from 'child_process';

export type SampleFile = {
  name: string;
  mimeType: string;
  ext: string;
  bytes: Buffer;
  /** Section the file goes into (key of `SECTIONS`). */
  section: SectionKey;
  /** A 720p proxy is made for this clip (stored as a processed version). */
  proxy?: boolean;
};

export const SECTIONS = {
  footage: '01 Footage',
  stills: '02 Stills',
  docs: '03 Documents',
} as const;
export type SectionKey = keyof typeof SECTIONS;

/* ------------------------------------------------------------------ */
/* Stills                                                              */
/* ------------------------------------------------------------------ */

type Palette = { sky: [string, string]; sun: string; far: string; mid: string; near: string; water?: string };

const PALETTES: Record<string, Palette> = {
  dusk: { sky: ['#1b2a5c', '#f08a5d'], sun: '#ffd27a', far: '#4a3f6b', mid: '#2e2a4f', near: '#141a33', water: '#26386e' },
  dawn: { sky: ['#8ec5fc', '#f9d9c9'], sun: '#fff1c1', far: '#9bb3cf', mid: '#6d87a8', near: '#3d5573' },
  noon: { sky: ['#2f80ed', '#a7d3ff'], sun: '#ffffff', far: '#d6b48a', mid: '#c0905a', near: '#8c5a33' },
  fog: { sky: ['#cfd8dc', '#eceff1'], sun: '#f5f5f5', far: '#b0bec5', mid: '#78909c', near: '#455a64' },
  night: { sky: ['#050816', '#1c2b5a'], sun: '#e8edf7', far: '#1d2547', mid: '#141a36', near: '#0a0e20', water: '#16224a' },
  coral: { sky: ['#ff9a8b', '#ffd3a5'], sun: '#fff4e0', far: '#e2786b', mid: '#b85a59', near: '#6e3346' },
};

/** A smooth ridge line across `w` at height `y` (closed to the bottom edge). */
function ridge(w: number, h: number, y: number, amp: number, waves: number, phase: number): string {
  const pts: string[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const x = (w * i) / steps;
    const t = (i / steps) * Math.PI * 2 * waves + phase;
    const yy = y + Math.sin(t) * amp + Math.sin(t * 2.3 + phase) * amp * 0.35;
    pts.push(`${x.toFixed(1)},${yy.toFixed(1)}`);
  }
  return `M0,${h} L${pts.join(' L')} L${w},${h} Z`;
}

/** SVG of an abstract landscape: gradient sky, a sun or moon, three ridges, optional water. */
export function landscapeSvg(w: number, h: number, paletteName: keyof typeof PALETTES, seed: number): string {
  const p = PALETTES[paletteName];
  const horizon = h * (p.water ? 0.62 : 0.7);
  const sunR = Math.min(w, h) * 0.09;
  const sunX = w * (0.25 + ((seed * 37) % 50) / 100);
  const sunY = horizon - h * 0.22;
  const water = p.water
    ? `<rect x="0" y="${horizon}" width="${w}" height="${h - horizon}" fill="${p.water}"/>` +
      Array.from({ length: 7 }, (_, i) => {
        const yy = horizon + 12 + i * ((h - horizon) / 8);
        const len = sunR * (2.2 - i * 0.22);
        return `<rect x="${(sunX - len / 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${len.toFixed(1)}" height="3" rx="1.5" fill="${p.sun}" opacity="${(0.55 - i * 0.06).toFixed(2)}"/>`;
      }).join('')
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset="1" stop-color="${p.sky[1]}"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#s)"/>` +
    `<circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="${sunR.toFixed(1)}" fill="${p.sun}" opacity="0.95"/>` +
    `<path d="${ridge(w, p.water ? horizon : h, horizon - h * 0.12, h * 0.05, 1.3, seed)}" fill="${p.far}"/>` +
    `<path d="${ridge(w, p.water ? horizon : h, horizon - h * 0.04, h * 0.045, 2.1, seed * 1.7)}" fill="${p.mid}"/>` +
    (p.water ? water : `<path d="${ridge(w, h, horizon + h * 0.08, h * 0.04, 3.2, seed * 2.9)}" fill="${p.near}"/>`) +
    `</svg>`
  );
}

async function still(name: string, w: number, h: number, palette: keyof typeof PALETTES, seed: number): Promise<SampleFile> {
  const sharp = (await import('sharp')).default;
  const bytes = await sharp(Buffer.from(landscapeSvg(w, h, palette, seed))).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return { name, mimeType: 'image/jpeg', ext: 'jpg', bytes, section: 'stills' };
}

/* ------------------------------------------------------------------ */
/* Clips                                                               */
/* ------------------------------------------------------------------ */

const FFMPEG_TIMEOUT_MS = 120_000;
/** Fragmented MP4 on a pipe: no temporary file, plays in every browser. */
export const PIPE_MP4 = ['-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1'];

/** Runs ffmpeg and returns what it wrote to stdout. */
export function ffmpegToBuffer(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', ...args],
      { encoding: 'buffer', timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`ffmpeg failed: ${String(stderr?.toString() || err.message).slice(0, 400)}`));
        if (!stdout?.length) return reject(new Error('ffmpeg wrote nothing'));
        resolve(stdout);
      },
    );
  });
}

/** H.264/AAC MP4 from an ffmpeg lavfi video source and a sine tone. */
function clip(source: string, seconds: number, tone: number, extra: string[] = []): Promise<Buffer> {
  return ffmpegToBuffer([
    '-f', 'lavfi', '-i', source,
    '-f', 'lavfi', '-i', `sine=frequency=${tone}:sample_rate=48000`,
    '-t', String(seconds),
    ...extra,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-shortest',
    ...PIPE_MP4,
  ]);
}

/** ffmpeg arguments for a 720p H.264 proxy of `input` (a path or URL), as the reference worker makes it. */
export function proxyArgs(input: string): string[] {
  return [
    '-i', input,
    '-vf', 'scale=-2:720',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k',
    ...PIPE_MP4,
  ];
}

/* ------------------------------------------------------------------ */
/* Document                                                            */
/* ------------------------------------------------------------------ */

function pdfEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** A one-page PDF with plain text lines (Helvetica, no embedded fonts). */
export function textPdf(title: string, lines: string[]): Buffer {
  const content = [
    'BT',
    '/F1 20 Tf',
    '72 760 Td',
    `(${pdfEscape(title)}) Tj`,
    '/F1 11 Tf',
    '0 -30 Td',
    '15 TL',
    ...lines.map((l) => `(${pdfEscape(l)}) '`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/* ------------------------------------------------------------------ */
/* The sample set                                                      */
/* ------------------------------------------------------------------ */

/** Every sample file of the demo Project. Needs ffmpeg on PATH. */
export async function sampleFiles(): Promise<SampleFile[]> {
  const stills = await Promise.all([
    still('harbor-dusk-01.jpg', 1600, 1067, 'dusk', 1),
    still('ridge-dawn-02.jpg', 1600, 1067, 'dawn', 2),
    still('dunes-noon-03.jpg', 1600, 1067, 'noon', 3),
    still('valley-fog-04.jpg', 1080, 1350, 'fog', 4),
    still('bay-night-05.jpg', 1080, 1350, 'night', 5),
    still('studio-coral-06.jpg', 1350, 1080, 'coral', 6),
  ]);

  // One ffmpeg at a time and small sources: a 2 GB host makes all three in seconds.
  // 1080p wide shot: slow colour drift (the proxy is made from it).
  const wide = await clip('gradients=s=1920x1080:r=24:speed=0.01:n=4:c0=0x1b2a5c:c1=0x3563f2:c2=0xf08a5d:c3=0x8aa5ff:seed=7', 6, 220);
  // Portrait clip for the portrait-aware viewer (a light fractal zoom).
  const vertical = await clip('mandelbrot=s=540x960:r=24:end_scale=0.1:maxiter=250', 4, 330);
  // Short motion test.
  const pattern = await clip('life=s=640x360:r=24:mold=10:ratio=0.2:life_color=#8aa5ff:death_color=#0f0f0d:mold_color=#3563f2', 4, 440);
  const clips: SampleFile[] = [
    { name: 'A001_C003_harbor-wide.mp4', mimeType: 'video/mp4', ext: 'mp4', bytes: wide, section: 'footage', proxy: true },
    { name: 'A001_C007_vertical-detail.mp4', mimeType: 'video/mp4', ext: 'mp4', bytes: vertical, section: 'footage' },
    { name: 'B002_C001_motion-test.mp4', mimeType: 'video/mp4', ext: 'mp4', bytes: pattern, section: 'footage' },
  ];

  const doc: SampleFile = {
    name: 'Shot list.pdf',
    mimeType: 'application/pdf',
    ext: 'pdf',
    section: 'docs',
    bytes: textPdf('Coastline promo: shot list', [
      'Day 1, morning',
      '  A001 C003  Harbor wide, slow drift, 6 s',
      '  A001 C007  Vertical detail for social, 5 s',
      'Day 1, afternoon',
      '  B002 C001  Motion test, 4 s',
      'Stills',
      '  Six selects, landscape and portrait',
      '',
      'Sample document of the Shotstash public demo. All media is generated.',
    ]),
  };

  return [...clips, ...stills, doc];
}
