"use client";

import { useState } from "react";
import { parseAvatarConfig, renderAvatarSvg } from "@/lib/avatar";

export type AvatarPreset = {
  id: string;
  label: string;
  from: string;
  to: string;
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "violet", label: "Violet", from: "#5145e5", to: "#8b7cff" },
  { id: "ocean", label: "Océan", from: "#0ea5e9", to: "#22d3ee" },
  { id: "sunset", label: "Coucher de soleil", from: "#f97316", to: "#fb7185" },
  { id: "forest", label: "Forêt", from: "#16a34a", to: "#4ade80" },
  { id: "graphite", label: "Graphite", from: "#334155", to: "#64748b" },
  { id: "rose", label: "Rose", from: "#e11d48", to: "#fb7185" },
];

export function initialsFor(firstName: string, lastName: string, fallback = ""): string {
  const first = (firstName || fallback || "?").trim().charAt(0);
  const second = (lastName || "").trim().charAt(0);
  return `${first}${second}`.toUpperCase() || "?";
}

function generatedSvg(avatarConfig: string | null | undefined, size: number): string {
  const cfg = parseAvatarConfig(avatarConfig);
  return cfg ? renderAvatarSvg(cfg, size) : "";
}

function Initials({
  firstName,
  lastName,
  preset,
  color,
  size,
  className,
}: {
  firstName: string;
  lastName: string;
  preset?: string;
  color?: string;
  size: number;
  className: string;
}) {
  const presetValue = AVATAR_PRESETS.find((item) => item.id === preset) ?? AVATAR_PRESETS[0];
  const background = color
    ? `linear-gradient(145deg, ${color}, ${color})`
    : `linear-gradient(145deg, ${presetValue.from}, ${presetValue.to})`;
  return (
    <span
      className={`avatar-badge avatar-initials ${className}`.trim()}
      style={{ width: size, height: size, background, fontSize: Math.max(11, size * 0.34) }}
      aria-label={`${firstName} ${lastName}`.trim() || "Avatar"}
    >
      {initialsFor(firstName, lastName)}
    </span>
  );
}

/**
 * Displays profile identity with photo + generated avatar TOGETHER (non-replacing).
 * - photoUrl/url present + avatarConfig present => photo is primary, generated avatar shown as a small overlay badge.
 * - photo present only => photo.
 * - avatarConfig present only (no photo) => generated avatar as primary (fallback).
 * - neither => initials/preset.
 * This ensures the real profile photo is never replaced by the avatar.
 */
export function AvatarBadge({
  url,
  photoUrl,
  firstName,
  lastName,
  preset,
  color,
  size = 72,
  className = "",
  source,
  avatarConfig,
  overlay = true,
}: {
  /** Real profile photo URL (primary). */
  url?: string | null;
  photoUrl?: string | null;
  firstName: string;
  lastName: string;
  preset?: string;
  color?: string;
  size?: number;
  className?: string;
  /** Legacy hint; display is driven by the presence of photo and avatarConfig. */
  source?: string;
  avatarConfig?: string | null;
  /** When true and both photo+avatar exist, show the avatar as a complementary overlay. */
  overlay?: boolean;
}) {
  void source;
  // Une photo dont le fichier est introuvable (404) ne doit pas laisser une
  // image cassée : on retombe sur l'avatar ou les initiales.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const rawPhoto = (photoUrl ?? url ?? "").trim() || undefined;
  const photo = rawPhoto && rawPhoto !== failedSrc ? rawPhoto : undefined;
  const genSvg = generatedSvg(avatarConfig, size);
  const hasGen = !!genSvg;
  const alt = `${firstName} ${lastName}`.trim() || "Avatar";

  // Photo + generated avatar together: photo primary, avatar complementary overlay.
  if (photo && hasGen && overlay) {
    const overlaySize = Math.max(18, Math.round(size * 0.38));
    return (
      <span
        className={`avatar-badge-wrap ${className}`.trim()}
        style={{ width: size, height: size, position: "relative", display: "inline-block", flex: "0 0 auto" }}
      >
        <img
          className="avatar-badge avatar-photo"
          src={photo}
          alt={alt}
          onError={() => setFailedSrc(photo)}
          style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block" }}
        />
        <span
          className="avatar-badge-overlay"
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: overlaySize,
            height: overlaySize,
            borderRadius: "50%",
            overflow: "hidden",
            border: "2px solid var(--card, #fff)",
            background: "var(--card, #fff)",
            display: "inline-flex",
            boxShadow: "0 2px 8px rgba(17,17,17,.18)",
          }}
          aria-hidden="true"
          title="Avatar personnalisé"
          dangerouslySetInnerHTML={{ __html: renderAvatarSvg(parseAvatarConfig(avatarConfig), overlaySize) }}
        />
      </span>
    );
  }

  // Photo only.
  if (photo) {
    return (
      <img
        className={`avatar-badge avatar-photo ${className}`.trim()}
        src={photo}
        alt={alt}
        onError={() => setFailedSrc(photo)}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }}
      />
    );
  }

  // Generated avatar as primary fallback (no photo).
  if (hasGen) {
    return (
      <span
        className={`avatar-badge avatar-generated ${className}`.trim()}
        style={{ width: size, height: size, display: "inline-flex", borderRadius: "50%", overflow: "hidden" }}
        dangerouslySetInnerHTML={{ __html: genSvg }}
        aria-label={alt}
      />
    );
  }

  // Legacy: source hinted generated but config missing - fall through to initials.
  return <Initials firstName={firstName} lastName={lastName} preset={preset} color={color} size={size} className={className} />;
}

export { parseAvatarConfig };
