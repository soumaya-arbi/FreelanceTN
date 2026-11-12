import { redirect } from "next/navigation";

export default async function ClientQuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/client/quotes?tab=quotes&id=${encodeURIComponent(id)}`);
}
