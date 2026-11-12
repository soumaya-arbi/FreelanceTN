import { redirect } from "next/navigation";

// `/freelancer` n'a pas de contenu propre : l'espace de travail commence par le
// tableau de bord. Une redirection serveur évite un 404 lorsque l'URL est
// saisie ou partagée directement (le layout vérifie ensuite la session).
export default function FreelancerHomePage() {
  redirect("/freelancer/dashboard");
}
