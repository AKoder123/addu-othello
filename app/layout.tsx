import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title: "Nocturne — Othello for Two",
    description: "A beautiful local two-player Othello game.",
    openGraph: {
      title: "Nocturne — Othello for Two",
      description: "Stay awhile. Take your turn.",
      type: "website",
      images: [{ url: imageUrl, width: 1536, height: 1024, alt: "Nocturne Othello for Two" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Nocturne — Othello for Two",
      description: "Stay awhile. Take your turn.",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
