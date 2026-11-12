import { ClientBillingCenter } from "@/components/modules/ClientBillingCenter";

export default async function ClientQuotesPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; id?: string; payment?: string }> | { tab?: string; id?: string; payment?: string };
}) {
  const sp = (await Promise.resolve(searchParams)) || {};
  const tab = sp.tab === "invoices" ? "invoices" : sp.tab === "payments" ? "payments" : "quotes";
  return <ClientBillingCenter initialTab={tab} initialId={sp.id} initialPayment={sp.payment} />;
}
