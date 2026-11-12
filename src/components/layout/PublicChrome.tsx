"use client";

import { useApp } from "@/context/AppContext";
import { usePathname } from "next/navigation";
import { Header } from "@/components/ui/Header";
import { Footer } from "@/components/ui/Footer";
import { useUser } from "@/context/UserContext";

export function PublicChrome({ children }: { children: React.ReactNode }) {
  const { go, dark, setDark, openAuth } = useApp();
  const pathname = usePathname();
  const { status } = useUser();
  const isProjectDetail = /^\/projects\/[^/]+\/?$/.test(pathname);

  // ProjectDetailRoute supplies the authenticated role shell. Do not wrap it
  // in public navigation while the session is resolving or after sign-in.
  if (isProjectDetail && status !== "unauthenticated" && status !== "error") {
    return <>{children}</>;
  }

  return (
    <>
      <Header go={go} dark={dark} setDark={setDark} openAuth={openAuth} />
      {children}
      <Footer go={go} />
    </>
  );
}
