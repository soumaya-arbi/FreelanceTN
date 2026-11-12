"use client";

import { ClientModule } from "@/components/views/client/ClientModule";
import { useApp } from "@/context/AppContext";

export default function ClientSettingsPage() {
  const { go, notify, openClientProcess } = useApp();
  return <ClientModule page="settings" go={go} notify={notify} openProcess={openClientProcess} />;
}
