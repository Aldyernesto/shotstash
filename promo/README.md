# Shotstash trailer

The 30 second launch trailer, built in code. The whole film is one
deterministic function of time, `draw(t)` for `t` in 0 to 30 s (`src/story.js`),
so the same code plays live in the browser and renders frame-exact video.

Nothing here is part of the app: `promo/` is excluded from the app build, lint,
type check and Docker context.

## Look (v2)

Pure black, neon blue edge light, one lit element at a time. An almost
continuous shot where each element morphs into the next: the claim's key word
swells into the "+ New Project" button, the button becomes the upload panel,
the camera dives into a progress bar's end cap whose corner becomes the app
frame, a project card zooms into the viewer, a word pill becomes a rounded
rect, then a ring, and floating tiles collapse into the mark. Real screenshots
(`docs/public/screenshots`, synthetic demo data) build in with a pixel-block
reveal. 24 fps with a 180 degree shutter (motion blur over half a frame).

Type: Inter Tight for display lines (tight tracking, one key word in blue),
Inter for UI text, JetBrains Mono for the video-world labels (timecode, frame
counter, file names, resolution tags). All bundled in `assets/fonts/` with
their SIL OFL licences; no system font is used.

## Outputs

Committed (root of `out/`, stable names):

| File | What |
| --- | --- |
| `out/shotstash-trailer-30s.mp4` | 1920x1080, 24 fps, H.264 yuv420p, AAC, about 15 MB |
| `out/thumbnail-1280x720.jpg` | thumbnail, also the clickable image in the repository README |
| `out/poster.jpg` | `<video poster>` |
| `out/NOTICE.md` | the licence notice for the audio in the MP4 |

Rendered next to them but **not** committed (gitignored, uploaded as GitHub
Release assets instead): `out/shotstash-loop-8s.mp4` (silent 8 s loop; the
seam is a scale match) and `out/thumbnail-1920x1080.png`.

Every render writes to its own folder, chosen with `--version` (for example
`out/v3/`). Those folders are gitignored together with `out/frames/`
(masters), the key frames, the WAVs and the alternate thumbnails, so nothing a
reviewer is watching is ever overwritten.

The docs site shows the trailer at `/shotstash/docs/trailer/` and the live page
at `/shotstash/trailer/live/` (on GitHub Pages). `docs/scripts/prepare.mjs`
copies the MP4, the poster, `NOTICE.md` and this page into
`docs/public/trailer/` at build time, so the MP4 is committed only once. It
copies only files git commits, and no audio except CC0 files.

## Licensing

The code in `promo/` is MIT licensed. The rendered MP4 contains third-party
music and sound effects under the Pixabay Content License and the Mixkit Sound
Effects Free License (ArctSound, Black_Kumizhi, BRVHRTZ via Pixabay; Mixkit
items 1490, 2608, 2568, 2946 and 790), plus two CC0 effects. That audio is not
covered by MIT and may not be extracted from the video or redistributed on its
own. See `out/NOTICE.md` and `assets/audio/CREDITS.md`. The licensed source
files are never committed (`assets/audio/.gitignore` is an allow-list: only
`CREDITS.md` and `*-cc0.wav` pass).

## Release a new version

1. Change the film (`src/`), keeping the timing in `src/timeline.js`.
2. Render to a new folder: `node promo/render.mjs --version v3`.
3. Review `out/v3/keyframes/t00.png` .. `t30.png` and the MP4.
4. Replace the committed MP4 in `out/` **only when the film really changes**:
   every replacement adds about 15 MB to the repository history for good.
   Copy `shotstash-trailer-30s.mp4`, `thumbnail-1280x720.jpg` and `poster.jpg`
   from `out/v3/` to `out/`.
5. Put social cuts (the loop, the 1920x1080 thumbnail, vertical or square
   versions) on the GitHub Release as assets, not in git.

## Preview

Serve the repository (or just `promo/`) with any static file server and open
`promo/index.html`:

```bash
npx serve .            # or: python -m http.server
# open http://localhost:3000/promo/
```

Play, pause (click or Space), scrub, replay, sound on. `?t=12.5` opens at a
given second. The page uses only relative URLs, so it also works when copied
under the docs site. three.js r186 is vendored in `vendor/three/` (MIT) and is
used only as the GPU compositor (motion-blur accumulation and bloom).

## Render

Needs Node 24, Google Chrome and ffmpeg. No npm install: the renderer talks to
Chrome over the DevTools protocol with Node's built-in WebSocket.

```bash
node promo/render.mjs --version v3     # out/v3: master, trailer, loop, key frames, thumbnails
node promo/render.mjs --keyframes      # review stills only (t00.png .. t30.png)
node promo/render.mjs --thumbs         # thumbnails and poster only
node promo/render.mjs --encode         # re-encode from the existing master
```

`CHROME_PATH` and `FFMPEG_PATH` override the binaries. A full render takes
about 2 minutes on an RTX 3050 (720 frames in about 1 minute, then the loop,
encodes, stills and thumbnails). Pass `--version <name>` to pick the output folder `out/<name>/`. The trailer encode starts at CRF 16 and steps up until
the file is at most 20 MB; the loop starts at CRF 18 and steps up to at most 4 MB.

## Sound

- **The MP4** uses the licensed music cut and sound effects in `assets/audio/`
  when they are on disk: `mix-audio.mjs` cuts `bgm-main.mp3` as
  `assets/audio/CREDITS.md` describes, places soft UI clicks on cursor clicks,
  airy whooshes on morphs, glitch ticks on pixel reveals and impacts only on
  the two hits (7.04 s, 26.2 s), ducks the music under the impacts and
  normalises to -14 LUFS with true peak at most -1.5 dBTP. Those files may not
  be redistributed, so git ignores them (`assets/audio/.gitignore`).
- **Without them** (a fresh clone), `audio.mjs` writes `out/soundtrack.wav`, an
  original procedural soundtrack (`src/audio-synth.js`). `--procedural` forces it.
- **The live page** plays only the procedural soundtrack.

## Change the copy or the timing

Everything lives in `src/timeline.js`: every line, the share link, the file
names, and every cut and hit in seconds. The two impacts sit on the music's
measured hits (7.04 s and 26.2 s) and the rest on its grid (about 99.6 BPM,
anchored at 9.58 s). The SFX cue sheet and the procedural soundtrack read the
same times, so changing a time moves picture and sound together.

## Files

| Path | Role |
| --- | --- |
| `index.html`, `src/main.js` | player page and the `?render=1` hook used by `render.mjs` |
| `src/story.js` | the film: scenes, camera, morphs |
| `src/draw.js` | the drawing kit: neon frames, border sweeps, glossy pills, typed text, pixel build, dot matrix, cursor, icon tiles, mark, viewfinder |
| `src/compositor.js` | motion-blur accumulation and bloom on the GPU |
| `src/thumbnail.js` | composed thumbnail variants a, b and c |
| `src/audio-synth.js`, `audio.mjs` | procedural soundtrack |
| `mix-audio.mjs` | licensed music and SFX mix for the MP4 |
| `assets/` | real screenshots, brand mark and lockup, fonts with licences |
