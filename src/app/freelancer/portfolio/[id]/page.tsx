import { PortfolioPreview } from "@/components/modules/PortfolioPreview";

export default async function PortfolioItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PortfolioPreview id={id} />;
}
