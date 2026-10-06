import { asset } from '@/lib/site';

/**
 * A screen of the app at 1280 px and, beside it, at 360 px (public/screenshots).
 * Every screenshot is made from synthetic data: generated images and clips,
 * invented names. The phone image repeats the desktop one, so it is hidden
 * from screen readers unless it gets its own `mobileAlt`.
 */
export function Screenshot({
  name,
  alt,
  mobileAlt,
  height = 800,
  mobile = true,
}: {
  name: string;
  alt: string;
  mobileAlt?: string;
  /** Height of the 1280 px capture. */
  height?: number;
  mobile?: boolean;
}) {
  return (
    <figure className="not-prose my-6 flex flex-col items-start gap-3 sm:flex-row">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset(`/screenshots/${name}-1280.webp`)}
        alt={alt}
        width={1280}
        height={height}
        loading="lazy"
        className="h-auto w-full rounded-lg border border-fd-border sm:w-[74%]"
      />
      {mobile ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset(`/screenshots/${name}-360.webp`)}
          alt={mobileAlt ?? ''}
          aria-hidden={mobileAlt ? undefined : true}
          width={360}
          height={780}
          loading="lazy"
          className="h-auto w-1/2 rounded-lg border border-fd-border sm:w-[24%]"
        />
      ) : null}
    </figure>
  );
}
