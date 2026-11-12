import { DocumentEditor } from "@/components/modules/DocumentEditor";

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentEditor role="freelancer" kind="quote" editId={id} />;
}
