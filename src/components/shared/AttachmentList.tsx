"use client";
import React from "react";
import { Icon } from "@/components/ui/Icon";
import type { IconName } from "@/lib/types";

// Métadonnées minimales nécessaires pour présenter une pièce jointe. Le type
// ProjectAttachment de l'API est structurellement compatible.
export type AttachmentItem = {
  fileName: string;
  url: string;
  size: number;
};

type AttachmentKind = {
  icon: IconName;
  label: string;
  tone: string;
};

// Convertit une taille brute en unité lisible (B, KB, MB) sans perdre la
// précision pour les petits fichiers.
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

// Déduit une icône et un libellé à partir de l'extension du fichier.
export function attachmentKind(fileName: string): AttachmentKind {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"].includes(extension)) {
    return { icon: "image", label: "Image", tone: "is-image" };
  }
  if (extension === "pdf") {
    return { icon: "file", label: "PDF document", tone: "is-pdf" };
  }
  if (["doc", "docx", "txt", "rtf", "odt", "pages"].includes(extension)) {
    return { icon: "file", label: "Document", tone: "is-doc" };
  }
  if (["xls", "xlsx", "csv", "ods"].includes(extension)) {
    return { icon: "file", label: "Spreadsheet", tone: "is-sheet" };
  }
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) {
    return { icon: "file", label: "Archive", tone: "is-zip" };
  }
  return { icon: "file", label: "File", tone: "is-file" };
}

export function AttachmentList({ items, emptyLabel, compact = false }: { items: AttachmentItem[]; emptyLabel?: string; compact?: boolean }) {
  if (items.length === 0) {
    return emptyLabel ? <p className="task-empty">{emptyLabel}</p> : null;
  }

  return (
    <ul className={compact ? "attachment-list compact" : "attachment-list"}>
      {items.map((item, index) => {
        const kind = attachmentKind(item.fileName);
        return (
          <li className="attachment-item" key={`${item.url}-${index}`}>
            <span className={`attachment-icon ${kind.tone}`} aria-hidden="true">
              <Icon name={kind.icon} size={16} />
            </span>
            <span className="attachment-meta">
              <b title={item.fileName}>{item.fileName}</b>
              <small>
                {kind.label} · {formatFileSize(item.size)}
              </small>
            </span>
            <a
              className="attachment-action"
              href={item.url}
              target="_blank"
              rel="noreferrer"
              download={item.fileName}
              aria-label={`Download ${item.fileName}`}
              title={`Download ${item.fileName}`}
            >
              <Icon name="download" size={14} />
              <span>Download</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
