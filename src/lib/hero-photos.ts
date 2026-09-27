// Login hero photo manifest.
//
// The public edition ships without sample footage: with an empty list the
// hero stage renders its typography and motion only. To bring the photo
// tiles back, drop rights-free images into public/hero/ and list them here
// with `approved: true`.
//
// slot:
//   tile   - desktop hero tiles (2 near + 2 far; order: near-L, near-R, far-L, far-R)
//   band   - photo band (rendered twice for a seamless loop)
//   mobile - mobile stack (3 cards)

export type HeroSlot = 'tile' | 'band' | 'mobile';

export type HeroPhoto = {
  /** File name under /hero/ (relative to public). */
  file: string;
  slot: HeroSlot;
  approved: boolean;
};

export const HERO_PHOTOS: HeroPhoto[] = [];

/** Only photos that were explicitly approved are ever rendered. */
export const approvedHeroPhotos = (): HeroPhoto[] => HERO_PHOTOS.filter((p) => p.approved);

export function approvedHeroPhotosForSlot(slot: HeroSlot): HeroPhoto[] {
  return approvedHeroPhotos().filter((p) => p.slot === slot);
}
