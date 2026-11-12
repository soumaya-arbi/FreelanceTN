"use client";

import { useParams } from "next/navigation";
import { InvitePage } from "@/components/views/client/InvitePage";
import { useApp } from "@/context/AppContext";

export default function ClientInvitePage() {
  const params = useParams<{ name: string }>();
  const { go, notify } = useApp();
  const raw = Array.isArray(params.name) ? params.name[0] : params.name;
  // Le segment d'URL est l'identifiant réel du compte freelance. Il ne doit
  // jamais être transformé en nom affiché avant l'appel API.
  const freelancerId = decodeURIComponent(raw ?? "");
  return <InvitePage freelancerId={freelancerId} go={go} notify={notify} />;
}
