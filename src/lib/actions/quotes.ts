"use server";

// Server Actions du module devis. Aucune règle métier ici : la session est
// vérifiée, le service applique les règles puis l'on sérialise la réponse.

import type { ActionResult } from "@/lib/actions/types";
import { runAction } from "@/lib/server/errors";
import { revalidateApp } from "@/lib/server/revalidate";
import { requireUser } from "@/lib/server/session";
import { serialize } from "@/lib/server/serialize";
import {
  createQuote as createQuoteService,
  deleteQuote as deleteQuoteService,
  getQuote as getQuoteService,
  listClientQuotes as listClientQuotesService,
  listQuotes as listQuotesService,
  updateQuote as updateQuoteService,
  updateQuoteStatus as updateQuoteStatusService,
} from "@/lib/server/services/quotes";
import { createInvoiceFromQuote } from "@/lib/server/services/invoices";

/** Devis créés par le freelance connecté. */
export async function listQuotes(): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await listQuotesService(user));
  });
}

/** Devis reçus par le client connecté. */
export async function listClientQuotes(): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await listClientQuotesService(user));
  });
}

/** Consultation d'un devis : propriétaire ou client destinataire. */
export async function getQuote(id: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    return serialize(await getQuoteService(user, id));
  });
}

/** Création par le freelancer assigné au projet. */
export async function createQuote(input: Record<string, unknown>): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const quote = await createQuoteService(user, input);
    revalidateApp();
    return serialize(quote);
  });
}

/** Modification par le propriétaire du devis. */
export async function updateQuote(
  id: string,
  input: Record<string, unknown>,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const quote = await updateQuoteService(user, id, input);
    revalidateApp();
    return serialize(quote);
  });
}

/** Suppression par le propriétaire (devis non converti). */
export async function deleteQuote(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requireUser();
    await deleteQuoteService(user, id);
    revalidateApp();
    return null;
  });
}

/** Réponse du client (accepté / refusé) ou envoi du freelancer. */
export async function updateQuoteStatus(
  id: string,
  status: string,
  note?: string,
  abandon?: boolean,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const quote = await updateQuoteStatusService(user, id, status, note, abandon);
    revalidateApp();
    return serialize(quote);
  });
}

/** Conversion d'un devis accepté en facture (réservée au client). */
export async function convertQuoteToInvoice(id: string): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireUser();
    const invoice = await createInvoiceFromQuote(user, id, {});
    revalidateApp();
    return serialize(invoice);
  });
}
