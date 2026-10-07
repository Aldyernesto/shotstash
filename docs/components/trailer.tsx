import { asset } from '@/lib/site';

/**
 * The 30 s launch trailer (public/trailer, copied from promo/out by
 * scripts/prepare.mjs) and a link to the live, playable version.
 */
export function Trailer() {
  return (
    <figure className="not-prose my-6">
      <video
        controls
        playsInline
        preload="metadata"
        poster={asset('/trailer/poster.jpg')}
        aria-label="Shotstash trailer, 30 seconds: uploading footage, organizing projects, playing video and sharing a link with a client, on your own hardware. The on-screen text is listed below the video."

        width={1920}
        height={1080}
        className="h-auto w-full rounded-lg border border-fd-border bg-black"
      >
        <source src={asset('/trailer/shotstash-trailer-30s.mp4')} type="video/mp4" />
      </video>
    </figure>
  );
}

/** Link to the live trailer page (the same film, rendered in the browser). */
export function TrailerLive({ children }: { children: React.ReactNode }) {
  return <a href={asset('/trailer/live/index.html')}>{children}</a>;
}
