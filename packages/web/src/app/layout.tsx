import { Toaster } from "@/components/ui/sonner";
import { getAkbWebUrl } from "@/lib/akb/akbWebUrl";
import { AkbWebUrlProvider } from "@/providers/AkbWebUrlProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Geist_Mono, Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

// A single Inter variable font carries the full weight range, so display
// headers (font-semibold, …) and body text share one downloaded face instead
// of two — the `--font-display` stack points back at it in globals.css.
// (REEF-097 AC3)
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "reef",
  description: "PM-facing AI-native project management on GitHub",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Reading a per-request header opts the whole app out of static prerender
  // into dynamic rendering. This is REQUIRED for the strict CSP:
  // Next.js stamps proxy.ts's per-request nonce onto its framework
  // <script> tags when the page renders per-request. If this call is removed,
  // `/` prerenders statically at build time with no nonce, and the runtime CSP
  // header (which carries a fresh nonce) blocks every script — breaking
  // hydration. Do not delete this without replacing it with another dynamic
  // opt-in (e.g. `export const dynamic = "force-dynamic"`).
  await headers();

  // The active UI locale, resolved per request from the detection chain
  // (NEXT_LOCALE cookie → Accept-Language → en) by `i18n/request.ts`. Reading it
  // here lets `<html lang>` match the first server paint, and the same value
  // feeds NextIntlClientProvider's messages (REEF-291).
  const locale = await getLocale();

  // Deployment's akb web base, read on the server at request time (REEF-368).
  // Passed to the client via AkbWebUrlProvider so linked-document backlinks are
  // driven by the runtime ConfigMap, not a build-time `NEXT_PUBLIC_*` inline
  // that silently vanishes when the image was built without the var. The
  // `await headers()` above already makes this render dynamic (per-request), so
  // the value is not frozen at build time.
  const akbWebUrl = getAkbWebUrl();

  // suppressHydrationWarning on <html>: `useTheme` adds/removes `.dark` on
  // documentElement before React reconciles, so the server-rendered class
  // attribute differs from the client one for any non-light user. Without
  // this, every dark-mode user sees a hydration warning on every load.
  // (`lang` is server-resolved from the cookie, so it does not itself mismatch.)
  // A no-flash inline boot script is not possible under the current CSP
  // ('strict-dynamic' + nonce) without re-introducing the mismatch; a
  // server-side theme cookie is the path forward.
  return (
    <html
      lang={locale}
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* No-prop provider inherits locale + messages + formats from
            `getRequestConfig` (next-intl v4), serializing them to the client. */}
        <NextIntlClientProvider>
          <AkbWebUrlProvider value={akbWebUrl}>
            <QueryProvider>{children}</QueryProvider>
          </AkbWebUrlProvider>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
