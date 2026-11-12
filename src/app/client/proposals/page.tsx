"use client";

import { ClientModule } from "@/components/views/client/ClientModule";
import { useApp } from "@/context/AppContext";

export default function ClientProposalsPage() {
  const { go, notify, openClientProcess } = useApp();
  return <ClientModule page="client-proposals" go={go} notify={notify} openProcess={openClientProcess} />;
}
