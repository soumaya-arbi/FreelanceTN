import { PortfolioEditor } from "@/components/modules/PortfolioEditor";

export default async function EditPortfolioItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PortfolioEditor editId={id} />;
}
