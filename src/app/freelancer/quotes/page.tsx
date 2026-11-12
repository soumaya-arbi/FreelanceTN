import { FreelancerBillingCenter } from "@/components/modules/FreelancerBillingCenter";

export default async function FreelancerQuotesPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; id?: string }> | { tab?: string; id?: string };
}) {
  const sp = (await Promise.resolve(searchParams)) || {};
  const tab = sp.tab === "invoices" ? "invoices" : sp.tab === "payments" ? "payments" : "quotes";
  return <FreelancerBillingCenter initialTab={tab} initialId={sp.id} />;
}
