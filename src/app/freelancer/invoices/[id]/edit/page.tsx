import { redirect } from "next/navigation";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/freelancer/quotes?tab=invoices&id=${encodeURIComponent(id)}`);
}
