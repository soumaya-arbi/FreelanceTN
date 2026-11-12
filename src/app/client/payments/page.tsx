import { redirect } from "next/navigation";

// La page historique « Paiements » est désormais un onglet du centre de
// facturation unique : redirection permanente pour préserver les liens.
export default function ClientPaymentsPage() {
  redirect("/client/quotes?tab=payments");
}
