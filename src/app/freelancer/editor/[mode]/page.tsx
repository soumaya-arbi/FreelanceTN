import { redirect } from "next/navigation";

// Les seuls outils d'édition opérationnels sont le profil et le portfolio.
// Les anciens assistants (demande d'avis, rapport, retrait) n'étaient reliés à
// aucune opération serveur : ils renvoient vers l'espace du compte.
export default async function EditorPage({ params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  if (mode === "portfolio") redirect("/freelancer/portfolio/new");
  redirect("/freelancer/dashboard");
}
