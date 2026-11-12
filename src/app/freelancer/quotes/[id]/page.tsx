import { redirect } from "next/navigation";

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/freelancer/quotes?tab=quotes&id=${encodeURIComponent(id)}`);
}
