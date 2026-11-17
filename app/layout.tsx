import type { Metadata, Viewport } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "COWBOY — Live Sports & Free Picks",
  description: "Follow real sports scores and fixtures. Save free pre-game winner picks to your account. No money, purchase, cash prizes or wagering.",
  applicationName: "COWBOY",
  appleWebApp: { capable: true, title: "COWBOY", statusBarStyle: "black-translucent" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#111113",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
