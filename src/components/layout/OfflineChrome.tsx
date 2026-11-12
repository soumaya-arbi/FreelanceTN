"use client";

import { useApp } from "@/context/AppContext";
import { Header } from "@/components/ui/Header";

// Layout hors ligne minimal : uniquement le header habituel (logo + navbar),
// sans footer ni aucun autre élément de l'interface.
export function OfflineChrome({ children }: { children: React.ReactNode }) {
  const { go, dark, setDark, openAuth } = useApp();
  return (
    <>
      <Header go={go} dark={dark} setDark={setDark} openAuth={openAuth} />
      {children}
    </>
  );
}
