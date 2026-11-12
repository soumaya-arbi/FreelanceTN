import { redirect } from "next/navigation";

export default function FreelancerInvoicesPage() {
  redirect("/freelancer/quotes?tab=invoices");
}
