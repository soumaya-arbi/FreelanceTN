"use client";

import { FreelancerModule } from "@/components/views/freelancer/FreelancerModule";
import { useApp } from "@/context/AppContext";

export default function InvitationsPage() {
  const { go, notify, openEditor } = useApp();
  return <FreelancerModule page="invitations" go={go} notify={notify} openEditor={openEditor} />;
}
