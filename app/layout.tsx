import type { Metadata, Viewport } from "next";
import "./styles.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://cowboy-sports.com"),
  title: "COWBOY — Live Sports & Free Picks",
  description: "Real-time sports scoreboards, in-game period progression, and free pre-game winner picks across web, mobile, and TV. No money, purchase, cash prizes, or wagering.",
  applicationName: "COWBOY",
  appleWebApp: { capable: true, title: "COWBOY", statusBarStyle: "black-translucent" },
  icons: {
    icon: "/app-icon.svg",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "COWBOY — Live Sports & Free Picks",
    description: "Real-time sports scoreboards, multi-league game tracking, and free picks.",
    siteName: "COWBOY",
    type: "website",
    images: [{ url: "/docs/screenshots/COWBOYMAIN.jpeg", width: 1200, height: 896, alt: "COWBOY Suite" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "COWBOY — Live Sports & Free Picks",
    description: "Real-time sports scoreboards, multi-league game tracking, and free picks.",
    images: ["/docs/screenshots/COWBOYMAIN.jpeg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#111113",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
