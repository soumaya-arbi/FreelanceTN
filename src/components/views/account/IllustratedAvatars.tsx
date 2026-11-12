"use client";

import React from "react";

export type IllustratedAvatarId = "aurora" | "orbit" | "nova" | "pulse" | "echo" | "zen";

export const ILLUSTRATED_AVATARS: { id: IllustratedAvatarId; label: string }[] = [
  { id: "aurora", label: "Aurora" },
  { id: "orbit", label: "Orbit" },
  { id: "nova", label: "Nova" },
  { id: "pulse", label: "Pulse" },
  { id: "echo", label: "Echo" },
  { id: "zen", label: "Zen" },
];

export function IllustratedAvatar({
  id,
  color,
  size = 84,
}: {
  id: IllustratedAvatarId;
  color: string;
  size?: number;
}) {
  const c = color || "#6366f1";
  const common = { width: size, height: size, viewBox: "0 0 100 100" };
  switch (id) {
    case "aurora":
      return (
        <svg {...common}>
          <circle cx="50" cy="50" r="48" fill={c} opacity="0.15" />
          <circle cx="50" cy="42" r="22" fill={c} />
          <rect x="28" y="62" width="44" height="26" rx="12" fill={c} />
          <circle cx="42" cy="40" r="3" fill="#fff" />
          <circle cx="58" cy="40" r="3" fill="#fff" />
          <path d="M42 50 Q50 56 58 50" stroke="#fff" strokeWidth="2" fill="none" />
          <path d="M30 30 Q50 10 70 30" stroke={c} strokeWidth="6" fill="none" />
        </svg>
      );
    case "orbit":
      return (
        <svg {...common}>
          <circle cx="50" cy="50" r="48" fill={c} opacity="0.12" />
          <circle cx="50" cy="44" r="20" fill="#fde68a" />
          <rect x="30" y="64" width="40" height="24" rx="10" fill={c} />
          <circle cx="43" cy="42" r="2.5" fill="#1f2937" />
          <circle cx="57" cy="42" r="2.5" fill="#1f2937" />
          <path d="M44 50 Q50 54 56 50" stroke="#1f2937" strokeWidth="2" fill="none" />
          <ellipse cx="50" cy="28" rx="24" ry="8" fill={c} />
        </svg>
      );
    case "nova":
      return (
        <svg {...common}>
          <circle cx="50" cy="50" r="48" fill={c} opacity="0.12" />
          <circle cx="50" cy="44" r="21" fill="#fecaca" />
          <rect x="29" y="64" width="42" height="24" rx="10" fill={c} />
          <circle cx="43" cy="42" r="2.5" fill="#1f2937" />
          <circle cx="57" cy="42" r="2.5" fill="#1f2937" />
          <path d="M44 52 Q50 48 56 52" stroke="#1f2937" strokeWidth="2" fill="none" />
          <path d="M30 32 L50 18 L70 32 Z" fill={c} />
        </svg>
      );
    case "pulse":
      return (
        <svg {...common}>
          <circle cx="50" cy="50" r="48" fill={c} opacity="0.12" />
          <circle cx="50" cy="44" r="20" fill="#bfdbfe" />
          <rect x="30" y="64" width="40" height="24" rx="10" fill={c} />
          <circle cx="43" cy="42" r="2.5" fill="#1f2937" />
          <circle cx="57" cy="42" r="2.5" fill="#1f2937" />
          <circle cx="50" cy="50" r="3" fill="#1f2937" />
          <path d="M28 34 Q50 20 72 34" stroke={c} strokeWidth="5" fill="none" />
        </svg>
      );
    case "echo":
      return (
        <svg {...common}>
          <circle cx="50" cy="50" r="48" fill={c} opacity="0.12" />
          <circle cx="50" cy="44" r="20" fill="#ddd6fe" />
          <rect x="30" y="64" width="40" height="24" rx="10" fill={c} />
          <circle cx="43" cy="42" r="2.5" fill="#1f2937" />
          <circle cx="57" cy="42" r="2.5" fill="#1f2937" />
          <path d="M44 50 Q50 56 56 50" stroke="#1f2937" strokeWidth="2" fill="none" />
          <circle cx="50" cy="26" r="6" fill={c} />
        </svg>
      );
    case "zen":
      return (
        <svg {...common}>
          <circle cx="50" cy="50" r="48" fill={c} opacity="0.12" />
          <circle cx="50" cy="44" r="20" fill="#d1fae5" />
          <rect x="30" y="64" width="40" height="24" rx="10" fill={c} />
          <circle cx="43" cy="42" r="2.5" fill="#1f2937" />
          <circle cx="57" cy="42" r="2.5" fill="#1f2937" />
          <path d="M46 50 Q50 52 54 50" stroke="#1f2937" strokeWidth="2" fill="none" />
          <path d="M32 34 Q50 22 68 34" stroke={c} strokeWidth="4" fill="none" />
        </svg>
      );
    default:
      return null;
  }
}