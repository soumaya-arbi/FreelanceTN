"use client";

import { Directory } from "@/components/shared/Directory";
import { useApp } from "@/context/AppContext";

export default function ProjectsPage() {
  const { go, notify, openProject } = useApp();
  return <Directory kind="projects" go={go} notify={notify} openProject={openProject} />;
}
