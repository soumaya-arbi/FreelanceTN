"use client";

import { ProjectsView } from "@/components/views/freelancer/ProjectsView";
import { useApp } from "@/context/AppContext";

export default function FreelancerProjectsPage() {
  const { go, notify } = useApp();
  return <ProjectsView go={go} notify={notify} />;
}
