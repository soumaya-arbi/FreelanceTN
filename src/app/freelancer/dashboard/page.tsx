"use client";

import { Dashboard } from "@/components/views/freelancer/Dashboard";
import { useApp } from "@/context/AppContext";
import { useMarketplace } from "@/context/MarketplaceContext";
import { useUser } from "@/context/UserContext";

export default function FreelancerDashboardPage() {
  const { go, notify, openProject } = useApp();
  const { catalogProjects, catalogLoading, catalogError, assignedProjects, assignedLoading, assignedError } = useMarketplace();
  const { authUser } = useUser();
  return (
    <Dashboard
      go={go}
      notify={notify}
      projectItems={catalogProjects}
      assignedItems={assignedProjects}
      loading={catalogLoading}
      error={catalogError}
      assignedLoading={assignedLoading}
      assignedError={assignedError}
      openProject={openProject}
      firstName={authUser?.firstName}
    />
  );
}
