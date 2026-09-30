// Story 4.6: the signed-in app (login, setup, dashboard, ...) gets every
// message plus the Apollo client and the session context. The public share
// page has its own layout (src/app/s/layout.tsx) without them.
import { NextIntlClientProvider } from "next-intl";
import { ApolloWrapper } from "@/components/ApolloWrapper";
import { AuthProvider } from "@/components/AuthContext";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <NextIntlClientProvider>
      <ApolloWrapper>
        <AuthProvider>{children}</AuthProvider>
      </ApolloWrapper>
    </NextIntlClientProvider>
  );
}
