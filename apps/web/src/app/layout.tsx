import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { NONCE_HEADER } from "@/lib/csp";
import {
  REQUEST_ID_HEADER,
  REQUEST_ID_META,
  requestIdFrom,
} from "@/lib/request-id";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import { cn } from "@/lib/utils";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Reading the request also keeps every page dynamic, which a nonce needs.
  const request = await headers();
  const nonce = request.get(NONCE_HEADER) ?? undefined;
  const requestId = requestIdFrom(request.get(REQUEST_ID_HEADER));
  return (
    // The font variables go on <html>: Tailwind's preflight sets font-family
    // there from --font-sans, which reads them.
    <html
      lang="es-AR"
      className={cn(geistSans.variable, geistMono.variable)}
      suppressHydrationWarning
    >
      <body className="antialiased">
        {requestId && <meta name={REQUEST_ID_META} content={requestId} />}
        <ThemeProvider nonce={nonce}>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
