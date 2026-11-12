import { ProjectDetailRoute } from "@/components/views/ProjectDetailRoute";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectDetailRoute projectId={id} />;
}
