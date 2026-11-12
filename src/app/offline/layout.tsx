import type { Metadata } from "next";
import { OfflineChrome } from "@/components/layout/OfflineChrome";

export const metadata: Metadata = {
  title: "Offline",
  description: "FreelanceTN is unreachable right now. The page reloads as soon as your connection returns.",
  robots: { index: false, follow: false },
};

export default function OfflineRouteLayout({ children }: { children: React.ReactNode }) {
  return <OfflineChrome>{children}</OfflineChrome>;
}
