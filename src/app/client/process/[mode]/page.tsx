import { redirect } from "next/navigation";

// Les étapes « propositions », « contrat » et « espace de travail » n'étaient
// pas reliées à une opération serveur. Seule la fiche projet réelle existe.
export default async function ClientProcessPage() {
  redirect("/client/projects");
}
