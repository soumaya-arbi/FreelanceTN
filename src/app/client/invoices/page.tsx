import { redirect } from "next/navigation";

export default function ClientInvoicesPage() {
  redirect("/client/quotes?tab=invoices");
}
