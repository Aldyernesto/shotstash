import { asset } from '@/lib/site';

/**
 * A screen of the app at 1280 px and, beside it, at 360 px (public/screenshots).
 * Every screenshot is made from synthetic data: generated images and clips,
 * invented names.
 */
export function Screenshot({ name, alt, mobile = true }: { name: string; alt: string; mobile?: boolean }) {
  return (
    <figure className="not-prose my-6 flex flex-col items-start gap-3 sm:flex-row">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset(`/screenshots/${name}-1280.webp`)}
        alt={`${alt} (desktop)`}
        width={1280}
        loading="lazy"
        className="h-auto w-full rounded-lg border border-fd-border sm:w-[74%]"
      />
      {mobile ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset(`/screenshots/${name}-360.webp`)}
          alt={`${alt} (phone)`}
          width={360}
          loading="lazy"
          className="h-auto w-1/2 rounded-lg border border-fd-border sm:w-[24%]"
        />
      ) : null}
    </figure>
  );
}
