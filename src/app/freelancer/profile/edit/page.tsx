"use client";

import { ProfileEditor } from "@/components/views/freelancer/ProfileEditor";
import { useApp } from "@/context/AppContext";

export default function ProfileEditPage() {
  const { go, notify } = useApp();
  return <ProfileEditor go={go} notify={notify} />;
}
