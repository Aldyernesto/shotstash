// Story 4.6 (share page budget): the public share page renders only these
// message namespaces and needs no Apollo client or session context, so a
// client's phone downloads neither.
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

const SHARE_PAGE_NAMESPACES = ["common", "count", "content", "format", "form", "theme", "viewer", "errors", "states", "share", "shareInvalid"];

export default async function ShareLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const all = (await getMessages()) as Record<string, unknown>;
  const messages = Object.fromEntries(SHARE_PAGE_NAMESPACES.filter((k) => k in all).map((k) => [k, all[k]]));
  return <NextIntlClientProvider messages={messages as Awaited<ReturnType<typeof getMessages>>}>{children}</NextIntlClientProvider>;
}
