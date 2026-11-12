import { AdminRoute } from "@/components/views/AdminRoute";
import { adminSections } from "@/lib/navigation";

export function generateStaticParams() {
  return adminSections.map((section) => ({ section }));
}

export default async function AdminSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return <AdminRoute section={section} />;
}
