import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/context/Providers";
import { AppFrame } from "@/context/AppContext";

export const metadata: Metadata = {
  title: {
    default: "FreelanceTN — Find talent. Build great things.",
    template: "%s · FreelanceTN",
  },
  description:
    "FreelanceTN connects clients with independent professionals through a complete workspace for projects, tasks, quotes, invoices, feedback, and portfolios.",
  applicationName: "FreelanceTN",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#5145e5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <Providers>
          <AppFrame>{children}</AppFrame>
        </Providers>
      </body>
    </html>
  );
}
