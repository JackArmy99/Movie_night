import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Movie Night",
  description: "Films the two of you will both like — and nothing you've already seen.",
  appleWebApp: { capable: true, title: "Movie Night", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0f1115",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="mx-auto max-w-xl px-4 pt-[max(1rem,env(safe-area-inset-top))]">{children}</div>
      </body>
    </html>
  );
}
