import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { NONCE_HEADER } from "@/lib/security-headers";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import { ThemeColorSync } from "@/components/pwa/theme-color-sync";
import { THEME_COLORS } from "@/lib/pwa/paths";
import { getCurrentUser } from "@/lib/session";
import { chartStyleForUser } from "@/lib/appearance/appearance.service";
import { InstanceDocumentEnd } from "@/components/instance/slots";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Kledg", template: "%s · Kledg" },
  description: "Comptabilité open source pour les sociétés françaises, tenue selon le plan comptable général.",
  robots: { index: false, follow: false },
  applicationName: "Kledg",
  // Installed on iOS (home screen): standalone window, name under the icon,
  // status bar in the page colors (the header pads itself below it).
  appleWebApp: { capable: true, title: "Kledg", statusBarStyle: "default" },
  // iOS turns long digit runs (amounts, SIREN, IBAN) into phone links.
  formatDetection: { telephone: false },
};

// viewport-fit=cover lets the page reach under the notch and the home
// indicator; the shell pads itself with env(safe-area-inset-*). Zoom stays
// allowed (no maximum-scale): inputs are 16px on phones so iOS does not zoom
// on focus (app/globals.css). The on-screen keyboard resizes the layout
// (Chrome on Android; iOS ignores it), so dialogs shown as bottom sheets and
// the sticky save bar stay above it. theme-color follows the system here and
// the in-app theme once hydrated (components/pwa/theme-color-sync.tsx).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Nonce of the page CSP (proxy.ts): the theme script runs inline before
  // hydration and needs it. Reading headers renders every page per request,
  // which a nonce requires anyway.
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  // The user's chart colours (Apparence settings) as CSS variables on
  // <html>, rendered here so charts never flash the defaults. An inline
  // style attribute, not a style tag: nothing to allow in the page CSP.
  // Undefined for the defaults and for signed out pages.
  const chartStyle = await chartStyleForUser((await currentUserOrNull())?.id);
  return (
    <html lang="fr" suppressHydrationWarning style={chartStyle}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          {children}
          <Toaster />
          <PwaProvider />
          <ThemeColorSync />
        </ThemeProvider>
        <InstanceDocumentEnd nonce={nonce} />
      </body>
    </html>
  );
}

/** The signed-in user, or null: a failing session lookup must not break public pages (sign-in, errors). */
async function currentUserOrNull() {
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
}
