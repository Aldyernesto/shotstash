// IP klien untuk limit per IP (reset password). Tanpa dependensi — dipakai route GraphQL & test E2E.
//
// Model kepercayaan:
// - Trafik publik masuk lewat Cloudflare Tunnel, jadi `cf-connecting-ip` di-set oleh Cloudflare dan
//   tidak bisa dipalsukan klien publik. Ini sumber utama.
// - Cadangan `x-forwarded-for` (entri pertama) lalu `x-real-ip` hanya terpakai untuk akses yang tidak
//   lewat Cloudflare (LAN/Tailscale). Entri pertama XFF adalah nilai kiriman klien (nginx
//   $proxy_add_x_forwarded_for menambahkan peer asli di AKHIR), jadi di jalur itu keduanya bisa dipalsukan.

type HeadersLike = { get(name: string): string | null | undefined };

export function clientIp(headers: HeadersLike): string | undefined {
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return headers.get('x-real-ip')?.trim() || undefined;
}
