import { redirect } from "next/navigation";

export default async function ClientInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/client/quotes?tab=invoices&id=${encodeURIComponent(id)}`);
}
