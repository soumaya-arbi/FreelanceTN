"use client";

import { ClientModule } from "@/components/views/client/ClientModule";
import { useApp } from "@/context/AppContext";

export default function ClientProjectsPage() {
  const { go, notify, openClientProcess } = useApp();
  return <ClientModule page="client-projects" go={go} notify={notify} openProcess={openClientProcess} />;
}
