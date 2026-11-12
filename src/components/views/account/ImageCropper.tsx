"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export type CropTarget = {
  file: File;
  /** Largeur / hauteur du rendu final. */
  aspect: number;
  outputWidth: number;
  outputHeight: number;
  title: string;
};

/**
 * Recadrage local avant upload : l'image n'est jamais envoyée avant validation
 * (format, taille) et le résultat est un fichier réel produit par un canvas.
 */
export function ImageCropper({
  target,
  onCancel,
  onSave,
}: {
  target: CropTarget;
  onCancel: () => void;
  onSave: (file: File) => void;
}) {
  const [src, setSrc] = useState("");
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(target.file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [target.file]);

  const save = async () => {
    const image = imgRef.current;
    if (!image || !image.complete || image.naturalWidth === 0) {
      setError("L'image n'est pas encore prête.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = target.outputWidth;
      canvas.height = target.outputHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas indisponible.");

      // Couverture : l'image remplit le cadre, puis le zoom et les décalages
      // sont appliqués. Le rendu final a exactement les dimensions attendues.
      const scale = Math.max(
        canvas.width / image.naturalWidth,
        canvas.height / image.naturalHeight,
      ) * zoom;
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      const x = (canvas.width - drawWidth) / 2 + (offsetX / 100) * (drawWidth - canvas.width) / 2;
      const y = (canvas.height - drawHeight) / 2 + (offsetY / 100) * (drawHeight - canvas.height) / 2;

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, x, y, drawWidth, drawHeight);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", 0.92),
      );
      if (!blob) throw new Error("Le recadrage a échoué.");

      const extension = blob.type === "image/webp" ? "webp" : "jpg";
      onSave(new File([blob], `crop-${Date.now()}.${extension}`, { type: blob.type || "image/jpeg" }));
    } catch {
      setError("Impossible de recadrer cette image. Essayez un autre fichier.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="crop-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="crop-head">
          <div>
            <h2>{target.title}</h2>
            <p>Zoomez et déplacez l&apos;image, puis validez le cadrage.</p>
          </div>
          <button className="icon-btn" onClick={onCancel} aria-label="Fermer">
            <Icon name="close" />
          </button>
        </div>

        <div
          className="crop-stage"
          style={{ aspectRatio: `${target.aspect}` }}
        >
          {src && (
            <img
              ref={imgRef}
              src={src}
              alt="Aperçu du recadrage"
              style={{
                transform: `translate(${offsetX * 0.3}%, ${offsetY * 0.3}%) scale(${zoom})`,
              }}
            />
          )}
        </div>

        <div className="crop-controls">
          <label>
            Zoom
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </label>
          <label>
            Horizontal
            <input
              type="range"
              min={-100}
              max={100}
              step={1}
              value={offsetX}
              onChange={(event) => setOffsetX(Number(event.target.value))}
            />
          </label>
          <label>
            Vertical
            <input
              type="range"
              min={-100}
              max={100}
              step={1}
              value={offsetY}
              onChange={(event) => setOffsetY(Number(event.target.value))}
            />
          </label>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="crop-actions">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Annuler
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Recadrage..." : "Utiliser cette image"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Vérifie le format et la taille avant d'ouvrir le recadrage. */
export function validateImageFile(file: File, maxSizeMb: number): string {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    return "Formats acceptés : JPG, JPEG, PNG ou WebP.";
  }
  if (file.size > maxSizeMb * 1024 * 1024) {
    return `L'image ne peut pas dépasser ${maxSizeMb} Mo.`;
  }
  return "";
}
