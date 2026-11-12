"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { ModuleShell } from "@/components/modules/ModuleShell";
import { useApp } from "@/context/AppContext";
import { useMarketplace } from "@/context/MarketplaceContext";
import { documentTotals, formatTND, lineTotal } from "@/lib/documents";
import type { DocumentLine, Invoice, Quote, Role } from "@/lib/types";

const isoInDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const newLine = (): DocumentLine => ({ id: `line-${Math.random().toString(36).slice(2, 9)}`, description: "", quantity: 1, unitPrice: 0, taxRate: 19, discount: 0 });

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "The document could not be saved.";

export function DocumentEditor({ role, kind, editId }: { role: Role; kind: "quote" | "invoice"; editId?: string }) {
  const router = useRouter();
  const { quotes, invoices, documentsLoading, documentsError } = useMarketplace();
  const isQuote = kind === "quote";
  const existing = editId
    ? isQuote
      ? quotes.find((item) => item.id === editId)
      : invoices.find((item) => item.id === editId)
    : undefined;
  const base = isQuote ? "/freelancer/quotes" : "/freelancer/invoices";

  if (editId && existing) {
    const quote = isQuote ? (existing as Quote) : undefined;
    const lockedReason = isQuote
      ? quote?.convertedTo
        ? "Ce devis a été converti en facture et ne peut plus être modifié."
        : quote?.abandoned
          ? "Ce devis a été refusé définitivement et ne peut plus être modifié."
          : quote?.status === "accepted" || quote?.status === "expired"
            ? "Ce devis ne peut plus être modifié dans son état actuel."
            : ""
      : (existing as Invoice).status === "paid"
        ? "Cette facture a été payée et ne peut plus être modifiée."
        : "";

    if (lockedReason) {
      return (
        <ModuleShell role={role} page="quotes">
          <main className="workspace module-page">
            <div className="workspace-title">
              <div>
                <p>ESPACE FREELANCER</p>
                <h1>Document verrouillé</h1>
                <span>{lockedReason}</span>
              </div>
              <Button variant="secondary" onClick={() => router.push(base)}>Retour</Button>
            </div>
          </main>
        </ModuleShell>
      );
    }
  }

  if (editId && !existing) {
    return (
      <ModuleShell role={role} page={isQuote ? "quotes" : "invoices"}>
        <main className="workspace module-page">
          <div className="workspace-title">
            <div>
              <p>FREELANCER WORKSPACE</p>
              <h1>{documentsLoading ? "Loading document" : "Document not available"}</h1>
              <span>
                {documentsLoading
                  ? "Retrieving the latest version from the server."
                  : documentsError || "This document could not be found or you do not have access to it."}
              </span>
            </div>
            <Button variant="secondary" onClick={() => router.push(base)}>Back to list</Button>
          </div>
        </main>
      </ModuleShell>
    );
  }

  return <DocumentEditorForm key={existing?.id ?? "new"} role={role} kind={kind} editId={editId} existing={existing} />;
}

function DocumentEditorForm({
  role,
  kind,
  editId,
  existing,
}: {
  role: Role;
  kind: "quote" | "invoice";
  editId?: string;
  existing?: Quote | Invoice;
}) {
  const router = useRouter();
  const { notify } = useApp();
  const { projects, assignedProjects, addQuote, updateQuote, addInvoice, updateInvoice } = useMarketplace();

  const isQuote = kind === "quote";
  const projectOptions = role === "freelancer" ? assignedProjects : projects;
  const existingQuote = isQuote ? (existing as Quote | undefined) : undefined;
  const existingInvoice = !isQuote ? (existing as Invoice | undefined) : undefined;

  const [client, setClient] = useState(existing?.client ?? "");
  const [project, setProject] = useState(existing?.project ?? projectOptions[0]?.id ?? "");
  const [issueDate, setIssueDate] = useState(existing?.issueDate ?? new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(
    (isQuote ? existingQuote?.validUntil : existingInvoice?.dueDate) ?? isoInDays(30),
  );
  const [notes, setNotes] = useState(existing?.notes ?? "Payment due within 30 days. Thank you for your business.");
  const [lines, setLines] = useState<DocumentLine[]>(existing?.lines ?? [newLine()]);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savingAction, setSavingAction] = useState<"save" | "resend" | null>(null);

  const totals = documentTotals(lines);
  const selectedProject = projectOptions.find((item) => item.id === project);
  const detectedClientId = (existing as (Quote & { clientId?: string }) | (Invoice & { clientId?: string }) | undefined)?.clientId || selectedProject?.ownerId || "";
  const detectedClientName = existing?.client || selectedProject?.client || client;
  const canResendCorrection = !!(isQuote && existingQuote && existingQuote.status === "refused" && existingQuote.correctionRequested && !existingQuote.abandoned && !existingQuote.convertedTo);

  const updateLine = (id: string, patch: Partial<DocumentLine>) => {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const onFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const names = Array.from(event.target.files ?? []).map((file) => `${file.name} · ${(file.size / 1024).toFixed(0)} KB`);
    if (names.length === 0) return;
    setAttachments((current) => [...current, ...names]);
    notify(`${names.length} file${names.length > 1 ? "s" : ""} attached for this session — files are not uploaded`);
  };

  const validate = (items: DocumentLine[]) => {
    if (!(detectedClientName || client).trim()) return "Sélectionnez un projet pour identifier le client.";
    if (!project) return "Choisissez un projet.";
    if (isQuote && !detectedClientId) return "Impossible d'identifier le client associé au projet. Vérifiez que le projet vous est assigné.";
    if (!issueDate || !endDate) return "Ajoutez la date d'émission et la date d'échéance/validité.";
    if (items.length === 0) return "Ajoutez au moins une ligne.";

    for (const line of items) {
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) return "Chaque quantité doit être supérieure à 0.";
      if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) return "Le prix unitaire ne peut pas être négatif.";
      if (!Number.isFinite(line.taxRate) || line.taxRate < 0) return "Le taux de TVA ne peut pas être négatif.";
      if (!Number.isFinite(line.discount) || line.discount < 0 || line.discount > 100) return "La remise doit être comprise entre 0 et 100.";
    }

    return "";
  };

  const save = async (event: React.FormEvent, resend = false) => {
    event.preventDefault();
    if (saving) return;

    const cleanLines = lines.filter((line) => line.description.trim());
    const validationError = validate(cleanLines);
    if (validationError) {
      notify(validationError);
      return;
    }

    const clientName = (detectedClientName || client).trim();
    setSaving(true);
    setSavingAction(resend ? "resend" : "save");
    try {
      if (isQuote) {
        const status = resend && canResendCorrection ? "sent" : (existingQuote?.status ?? "draft");
        const payload: Record<string, unknown> = {
          clientId: detectedClientId || undefined,
          client: clientName,
          projectId: project,
          project: selectedProject?.title || project,
          issueDate,
          validUntil: endDate,
          status,
          lines: cleanLines,
          notes,
        };

        if (existingQuote && editId) {
          const updated = await updateQuote(editId, payload as any);
          notify(resend ? `Devis corrigé ${updated.number} renvoyé au client.` : `Devis ${existingQuote.number} mis à jour.`);
          router.push(`/freelancer/quotes/${editId}`);
        } else {
          const created = await addQuote(payload as any);
          notify(`Devis ${created.number} créé.`);
          router.push(`/freelancer/quotes/${created.id}`);
        }
        return;
      }

      const status = existingInvoice?.status ?? "draft";
      const payload: Record<string, unknown> = {
        clientId: detectedClientId || undefined,
        client: clientName,
        projectId: project,
        project: selectedProject?.title || project,
        issueDate,
        dueDate: endDate,
        status,
        lines: cleanLines,
        notes,
      };

      if (existingInvoice && editId) {
        await updateInvoice(editId, payload as any);
        notify(`Facture ${existingInvoice.number} mise à jour.`);
        router.push(`/freelancer/invoices/${editId}`);
      } else {
        const created = await addInvoice(payload as any);
        notify(`Facture ${created.number} créée.`);
        router.push(`/freelancer/invoices/${created.id}`);
      }
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setSaving(false);
      setSavingAction(null);
    }
  };

  const base = "/freelancer/quotes";

  return (
    <ModuleShell role={role} page="quotes">
      <main className="workspace module-page">
        <div className="workspace-title">
          <div>
            <p>ESPACE FREELANCER</p>
            <h1>{existing ? (canResendCorrection ? `Corriger ${existing.number}` : `Modifier ${existing.number}`) : isQuote ? "Nouveau devis" : "Nouvelle facture"}</h1>
            <span>{canResendCorrection ? "Apportez les corrections demandées par le client, puis renvoyez le devis pour validation." : "Préparez un document détaillé en dinar tunisien (TND) pour votre client."}</span>
          </div>
          <Button variant="secondary" onClick={() => router.push(base)}>Retour</Button>
        </div>

        {canResendCorrection && existingQuote?.correctionNote && (
          <div className="billing-alert is-warning" style={{ marginBottom: 16 }}>
            <Icon name="message" size={15} />
            <div>
              <b>Demande de correction du client</b>
              <p>{existingQuote.correctionNote}</p>
            </div>
          </div>
        )}

        <form onSubmit={(e) => void save(e, false)} className="doc-editor">
          <div className="dash-card doc-editor-main">
            <div className="doc-editor-grid">
              <label className="editor-field">
                Projet
                <select value={project} onChange={(event) => { setProject(event.target.value); if (!existing) setClient(""); }}>
                  <option value="">Sélectionner un projet assigné</option>
                  {projectOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                </select>
              </label>
              <label className="editor-field">
                Client (détecté automatiquement)
                <input
                  value={detectedClientName}
                  readOnly
                  placeholder={project ? "Client associé au projet" : "Sélectionnez d'abord un projet"}
                  title={detectedClientId ? `Client ID: ${detectedClientId}` : undefined}
                />
                {project && !detectedClientId && <small className="form-error">Aucun client associé n'a pu être détecté pour ce projet.</small>}
                {detectedClientId && <small>Client identifié depuis le projet assigné.</small>}
              </label>
              <label className="editor-field">
                Issue date
                <input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} />
              </label>
              <label className="editor-field">
                {isQuote ? "Valid until" : "Due date"}
                <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </label>
            </div>

            <div className="editor-heading" style={{ marginTop: 8 }}><h2>Line items</h2><p>Describe the work and the agreed pricing.</p></div>
            <div className="doc-line-editor">
              <div className="doc-line-head">
                <span>Description</span><span>Qty</span><span>Unit price</span><span>Tax %</span><span>Discount %</span><span>Total</span><span />
              </div>
              {lines.map((line) => (
                <div className="doc-line-row" key={line.id}>
                  <input value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} placeholder="Design system audit" />
                  <input type="number" min={0.001} step="any" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value) })} />
                  <input type="number" min={0} step="any" value={line.unitPrice} onChange={(event) => updateLine(line.id, { unitPrice: Number(event.target.value) })} />
                  <input type="number" min={0} step="any" value={line.taxRate} onChange={(event) => updateLine(line.id, { taxRate: Number(event.target.value) })} />
                  <input type="number" min={0} max={100} step="any" value={line.discount} onChange={(event) => updateLine(line.id, { discount: Number(event.target.value) })} />
                  <b>{formatTND(lineTotal(line))}</b>
                  <button type="button" className="task-remove" onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))} aria-label="Remove line">
                    <Icon name="close" size={13} />
                  </button>
                </div>
              ))}
              <button type="button" className="doc-add-line" onClick={() => setLines((current) => [...current, newLine()])}>
                <Icon name="arrow" size={14} /> Add line item
              </button>
            </div>

            <label className="editor-field" style={{ marginTop: 16 }}>
              Notes &amp; terms
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>

            <label className="media-uploader" style={{ cursor: "pointer" }}>
              <Icon name="file" />
              <b>Attach supporting files</b>
              <small>Contracts, briefs, or signed copies. Files are referenced locally in this frontend phase.</small>
              <input type="file" multiple hidden onChange={onFiles} />
            </label>
            {attachments.length > 0 && (
              <ul className="doc-attachments">
                {attachments.map((name) => <li key={name}><Icon name="file" size={13} /> {name}</li>)}
              </ul>
            )}
          </div>

          <aside className="dash-card doc-editor-summary">
            <h3>Summary</h3>
            <div><span>Subtotal</span><b>{formatTND(totals.subtotal)}</b></div>
            <div><span>Discount</span><b>-{formatTND(totals.discount)}</b></div>
            <div><span>Tax</span><b>{formatTND(totals.tax)}</b></div>
            <div className="grand"><span>Total</span><b>{formatTND(totals.total)}</b></div>
            <Button type="submit" icon="check" disabled={saving}>
              {saving && savingAction === "save" ? "Enregistrement…" : existing ? (canResendCorrection ? "Enregistrer les corrections" : "Enregistrer") : isQuote ? "Créer le devis" : "Créer la facture"}
            </Button>
            {canResendCorrection && (
              <Button type="button" icon="arrow" disabled={saving} onClick={() => void save({ preventDefault() {} } as unknown as React.FormEvent, true)}>
                {saving && savingAction === "resend" ? "Renvoi…" : "Enregistrer et renvoyer"}
              </Button>
            )}
            <p><Icon name="shield" size={13} /> Vos montants sont enregistrés dans votre espace FreelanceTN.</p>
          </aside>
        </form>
      </main>
    </ModuleShell>
  );
}
