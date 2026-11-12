"use client";

import { useRouter } from "next/navigation";
import { Directory } from "@/components/shared/Directory";
import { useApp } from "@/context/AppContext";
import { useUser } from "@/context/UserContext";

export default function FreelancersPage() {
  const { go, notify, openProject } = useApp();
  const router = useRouter();
  const { role } = useUser();
  return (
    <Directory
      kind="freelancers"
      go={go}
      notify={notify}
      openProject={openProject}
      openFreelancer={(f) => router.push(role === "client" ? `/client/talent/${f.id}` : `/freelancers/${f.id}`)}
    />
  );
}
