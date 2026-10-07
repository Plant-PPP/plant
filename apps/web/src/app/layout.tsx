import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plant",
  description: "Todo tu patrimonio, en pesos y en dólares.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-AR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
