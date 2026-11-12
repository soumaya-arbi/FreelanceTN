"use client";

import { WorkspacePage } from "@/components/views/freelancer/WorkspacePage";
import { useApp } from "@/context/AppContext";

export default function FreelancerSettingsPage() {
  const { go, notify, openEditor } = useApp();
  return <WorkspacePage page="settings" go={go} notify={notify} openEditor={openEditor} />;
}
