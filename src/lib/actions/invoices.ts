"use server";

// Server Actions du module factures. Aucune règle métier ici : la session est
// vérifiée, le service applique les règles puis l'on sérialise la réponse.

import type { ActionResult } from "@/lib/actions/types";
import { runAction } from "@/lib/server/errors";
import { revalidateApp } from "@/lib/server/revalidate";
import { requireUser } from "@/lib/server/session";
import { serialize } from "@/lib/server/serialize";
import {
  createInvoice as createInvoiceService,
  createInvoiceFromQuote as createInvoiceFromQuoteService,
  deleteInvoice as deleteInvoiceService,
  getInvoice as getInvoiceService,
  listInvoices as listInvoicesService,
  updateInvoice as updateInvoiceService,
  updateInvoiceStatus as updateInvoiceStatusService,
} from "@/lib/server/services/invoices";

/** Factures du freelance ou du client connecté. */
export async function listInvoices(): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await listInvoicesService(user));
  });
}

/** Consultation d'une facture : propriétaire ou client. */
export async function getInvoice(id: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await getInvoiceService(user, id));
  });
}

/** La création manuelle est toujours refusée (règle métier du backend). */
export async function createInvoice(input: Record<string, unknown>): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const invoice = await createInvoiceService(user, input);
    revalidateApp();
    return serialize(invoice);
  });
}

/** Création d'une facture à partir d'un devis accepté (client uniquement). */
export async function createInvoiceFromQuote(
  quoteId: string,
  input?: { dueDate?: string; notes?: string },
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const invoice = await createInvoiceFromQuoteService(user, quoteId, input ?? {});
    revalidateApp();
    return serialize(invoice);
  });
}

/** Modification par le propriétaire (facture non payée). */
export async function updateInvoice(
  id: string,
  input: Record<string, unknown>,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const invoice = await updateInvoiceService(user, id, input);
    revalidateApp();
    return serialize(invoice);
  });
}

/** Suppression par le propriétaire (facture non payée). */
export async function deleteInvoice(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requireUser();
    await deleteInvoiceService(user, id);
    revalidateApp();
    return null;
  });
}

/** Changement de statut autorisé (le statut « payée » est calculé). */
export async function updateInvoiceStatus(
  id: string,
  status: string,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const invoice = await updateInvoiceStatusService(user, id, status);
    revalidateApp();
    return serialize(invoice);
  });
}
