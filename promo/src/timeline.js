// v2 script: single source of truth for timing and copy. Shared by the
// picture (story.js), the procedural soundtrack and the music mix, so picture
// and sound sit on the same grid.
//
// The music (assets/audio/CREDITS.md, two-segment cut of bgm-main) runs at
// about 99.6 BPM; its grid is anchored on 9.58 s. The two impacts sit on the
// track's measured hits: 7.04 s (frame snaps open) and 26.2 s (logo lock).

export const DURATION = 30;
export const FPS = 24; // filmic: 24 fps with a 180 degree shutter
export const BPM = 99.6;
export const BEAT = 60 / BPM; // 0.6024 s
export const GRID_ANCHOR = 9.58;
/** Beat number n on the grid (0 = the anchor). */
export const beat = (n) => GRID_ANCHOR + n * BEAT;

export const IMPACT = 7.04; // the app frame snaps open
export const LOCK_HIT = 26.2; // the tiles collapse into the mark

export const S = {
  // 0 to 3 s: black, a scan line, typed claim
  intro: {
    scan: [0.0, 1.2],
    type: 0.55,
    done: 2.23, // the last letter lands on the intro swell
    out: 2.95,
    text: [['Your footage shouldn’t live ', false], ['everywhere.', true]],
  },
  // 3 to 6.5 s: + New Project, the upload panel, three files racing to 100%
  upload: {
    cursorIn: 3.0,
    pillIn: 3.2,
    click: 4.15,
    morph: [4.15, 4.62],
    chips: [4.76, 4.98, 5.2],
    done: [5.36, 5.66, 5.96],
    files: [
      ['coast-drone-4k.mov', '3840×2160 · 24p'],
      ['interview-a.mp4', '1920×1080 · 25p'],
      ['bts-vertical.mov', '1080×1920 · 30p'],
    ],
    lineAt: 4.85,
    line: [['Resumable. ', false], ['Checksum-verified.', true]],
    dive: [6.2, IMPACT],
  },
  // 7 to 12 s: the app frame, Projects builds, a card opens into the viewer
  projects: {
    build: [7.12, 8.5],
    headlineAt: 7.55,
    headline: [['Your projects, ', false], ['organized.', true]],
    cursorIn: 8.55,
    click: GRID_ANCHOR, // 9.58
    zoom: [9.58, 10.25],
    viewerLineAt: 10.3,
    viewerLine: [['A viewer made for ', false], ['video.', true]],
    play: 10.79,
  },
  // 12 to 16.2 s: share popover, public link, copied, the client page
  share: {
    pop: 11.99,
    publicAt: 12.59,
    createAt: 13.2,
    linkType: 13.25,
    link: 'demostash.aldyernesto.my.id/s/demo-coastline-stills', // the seeded demo share link (restored nightly)
    copyAt: 14.4,
    lineAt: 12.1,
    line: [['Share with clients in ', false], ['seconds.', true]],
    slide: [15.0, 15.61],
  },
  // 16.2 to 19.8 s: three glossy word pills on the beat
  pills: {
    words: [
      ['Upload', 16.21],
      ['Organize', 17.42],
      ['Share', 18.02],
    ],
    click: 19.22,
  },
  // 19.8 to 24 s: pill -> rounded rect -> ring
  ring: {
    toRect: [19.82, 20.32],
    rect: [['Your ', false], ['hardware', true]],
    toRing: [21.6, 22.1],
    line1: [['Your footage.', false]],
    line2: [['Your cloud.', true]],
    line2At: 22.81,
    cycle: ['PC', 'NAS', 'S3', 'Docker'],
    cycleAt: 22.84,
    out: 24.01,
  },
  // 24 to 26.2 s: icon tiles swirl and collapse into the mark
  tiles: {
    in: 24.01,
    swirl: [24.6, 26.0],
    collapse: [25.75, LOCK_HIT],
    kinds: ['folder', 'upload', 'play', 'link', 'users', 'spark'],
  },
  // 26.2 to 30 s: the lockup
  lock: {
    glow: [LOCK_HIT, 26.6],
    shrink: [26.5, 26.95],
    wordmark: [26.62, 27.05],
    lineAt: 26.95,
    line: [['Free and open source. Self-host in ', false], ['minutes.', true]],
    url: 'github.com/Aldyernesto/shotstash',
    urlAt: 27.3,
    still: 27.5,
  },
};

/** Sound cues derived from the picture (procedural soundtrack and the licensed mix). */
export function cues() {
  const clicks = [
    S.upload.click,
    S.projects.click,
    S.projects.play,
    S.share.pop,
    S.share.publicAt,
    S.share.createAt,
    S.share.copyAt,
    S.pills.click,
  ];
  const ticks = [...S.upload.done, ...S.pills.words.map((w) => w[1])];
  const glitches = [S.projects.build[0], S.share.slide[1] - 0.1, LOCK_HIT - 0.05];
  const whooshes = [
    { t: S.upload.morph[0] + 0.05, len: 0.5, kind: 'whip' },
    { t: S.upload.dive[1], len: S.upload.dive[1] - S.upload.dive[0], kind: 'suck' },
    { t: S.projects.zoom[0] + 0.2, len: 0.5, kind: 'whip' },
    { t: S.share.slide[1] - 0.15, len: 0.5, kind: 'whip' },
    { t: S.ring.toRect[0] + 0.15, len: 0.5, kind: 'whip' },
    { t: S.ring.toRing[0] + 0.15, len: 0.5, kind: 'whip' },
    { t: S.tiles.collapse[1], len: 0.9, kind: 'suck' },
  ];
  const hits = [
    { t: IMPACT, kind: 'impact' },
    { t: LOCK_HIT, kind: 'impact' },
  ];
  return { clicks, ticks, glitches, whooshes, hits, riser: [24.1, LOCK_HIT] };
}

/** Time windows with fast motion: more motion-blur sub-frames there. */
export const FAST = [
  [S.intro.out, S.intro.out + 0.6],
  [S.upload.morph[0], S.upload.morph[1]],
  [S.upload.dive[0] + 0.3, IMPACT + 0.45],
  [S.projects.zoom[0], S.projects.zoom[1]],
  [S.share.pop + 0.15, S.share.pop + 0.7],
  [S.share.copyAt + 0.35, S.share.slide[1] + 0.1],
  [S.ring.toRect[0], S.ring.toRect[1]],
  [S.ring.toRing[0], S.ring.toRing[1]],
  [S.tiles.swirl[0] + 0.6, LOCK_HIT + 0.1],
  [S.lock.shrink[0], S.lock.wordmark[1]],
];
