"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  NONE,
  type AvatarConfig,
  type Silhouette,
  defaultAvatarConfig,
  displayHex,
  getStudioSteps,
  migrateAvatarConfig,
  parseAvatarConfig,
  randomizeAvatarConfig,
  renderAvatarSvg,
  stepDefaultPatch,
} from "@/lib/avatar";

export type { AvatarConfig };

function thumbnailSvg(base: AvatarConfig, patch: Partial<AvatarConfig>): string {
  return renderAvatarSvg({ ...base, ...patch, seed: base.seed || "preview" });
}

function SilhouetteCard({
  value,
  label,
  description,
  active,
  onSelect,
}: {
  value: Silhouette;
  label: string;
  description: string;
  active: boolean;
  onSelect: () => void;
}) {
  const svg = useMemo(
    () => renderAvatarSvg(defaultAvatarConfig(value, value === "female" ? "sil-f" : "sil-m")),
    [value],
  );
  return (
    <button
      type="button"
      className={`avatar-silhouette-card ${active ? "active" : ""}`}
      onClick={onSelect}
      aria-pressed={active}
    >
      <span className="avatar-silhouette-preview" dangerouslySetInnerHTML={{ __html: svg || "" }} />
      <strong>{label}</strong>
      <small>{description}</small>
    </button>
  );
}

function resolveSelected(stepKey: string, groupTitle: string, draft: AvatarConfig): string | undefined {
  switch (stepKey) {
    case "silhouette": return draft.silhouette;
    case "faceSkin": return groupTitle.includes("peau") ? draft.skinColor : undefined;
    case "hair": return draft.top;
    case "hairColor": return groupTitle.includes("chapeau") ? draft.hatColor : draft.hairColor;
    case "eyesBrows": return groupTitle.includes("Sourcils") ? draft.eyebrows : draft.eyes;
    case "noseMouth": return draft.mouth;
    case "accessories":
      if (groupTitle.includes("Accessoires")) return draft.accessories && draft.accessories !== NONE ? draft.accessories : NONE;
      if (groupTitle.includes("accessoires")) return draft.accessoriesColor;
      if (groupTitle.includes("Pilosité faciale")) return draft.facialHair && draft.facialHair !== NONE ? draft.facialHair : NONE;
      if (groupTitle.includes("pilosité") || groupTitle.includes("Pilosité")) return draft.facialHairColor;
      return undefined;
    case "clothing":
      if (groupTitle.includes("Couleur")) return draft.clothesColor;
      if (groupTitle.includes("Motif")) return draft.clothingGraphic;
      return draft.clothing;
    case "background": return draft.backgroundColor;
    default: return undefined;
  }
}

export function AvatarStudio({
  initial,
  onSave,
  onCancel,
}: {
  initial?: AvatarConfig | Record<string, unknown>;
  onSave: (config: AvatarConfig) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const migratedInitial = useMemo(() => {
    if (!initial) return undefined;
    return migrateAvatarConfig(initial) ?? (typeof initial === "object" ? (initial as AvatarConfig) : undefined);
  }, [initial]);

  const initialSilhouette: Silhouette | null = migratedInitial?.silhouette === "male" || migratedInitial?.silhouette === "female"
    ? migratedInitial.silhouette
    : null;

  const [silhouette, setSilhouette] = useState<Silhouette | null>(initialSilhouette);
  const [draft, setDraft] = useState<AvatarConfig>(() => {
    if (migratedInitial?.silhouette) return { ...defaultAvatarConfig(migratedInitial.silhouette), ...migratedInitial, silhouette: migratedInitial.silhouette };
    return defaultAvatarConfig("female");
  });
  const [stepIndex, setStepIndex] = useState(initialSilhouette ? 1 : 0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const effectiveSilhouette = silhouette ?? draft.silhouette ?? "female";
  const steps = useMemo(() => getStudioSteps(effectiveSilhouette), [effectiveSilhouette]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const svg = useMemo(() => renderAvatarSvg(draft), [draft]);

  const chooseSilhouette = (value: Silhouette) => {
    const base = defaultAvatarConfig(value, draft.seed);
    // When first choosing, reset to silhouette defaults; preserve seed.
    setSilhouette(value);
    setDraft((current) => {
      // if user already customized beyond initial defaults, keep compatible fields? safer to reset to clean silhouette base
      const next = { ...base, silhouette: value, seed: current.seed || base.seed };
      return next;
    });
    setSaved(false);
    setError("");
  };

  const applyPatch = (patch: Partial<AvatarConfig>) => {
    setDraft((current) => ({ ...current, ...patch, silhouette: effectiveSilhouette }));
    setSaved(false);
    setError("");
  };

  const randomize = () => {
    const next = randomizeAvatarConfig(effectiveSilhouette);
    setDraft(next);
    setSilhouette(effectiveSilhouette);
    setSaved(false);
    setError("");
  };

  const resetStep = () => {
    if (step.key === "silhouette") {
      // reset to no choice? keep current
      setSaved(false);
      return;
    }
    applyPatch(stepDefaultPatch(step.key, effectiveSilhouette));
  };

  const handleCancel = () => {
    setError("");
    setSaved(false);
    if (onCancel) { onCancel(); return; }
    if (migratedInitial) {
      const s = migratedInitial.silhouette === "male" ? "male" : migratedInitial.silhouette === "female" ? "female" : null;
      setSilhouette(s);
      setDraft({ ...defaultAvatarConfig(s ?? "female"), ...migratedInitial, ...(s ? { silhouette: s } : {}) });
      setStepIndex(s ? 1 : 0);
    } else {
      setSilhouette(null);
      setDraft(defaultAvatarConfig("female"));
      setStepIndex(0);
    }
  };

  const handleSave = async () => {
    if (!silhouette && !draft.silhouette) {
      setError("Choisissez d'abord une silhouette (Femme ou Homme).");
      setStepIndex(0);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const finalConfig: AvatarConfig = { ...draft, style: "avataaars", silhouette: effectiveSilhouette };
      await onSave(finalConfig);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "L'avatar n'a pas pu être enregistré.");
    } finally {
      setSaving(false);
    }
  };

  const canGoNext = step.key !== "silhouette" || !!silhouette || !!draft.silhouette;
  const progress = Math.round(((stepIndex + 1) / steps.length) * 100);

  return (
    <div className="avatar-studio avatar-studio-guided">
      <div className="avatar-studio-preview-col">
        <div className="avatar-studio-preview" aria-label="Aperçu de l'avatar">
          {svg ? <div className="avatar-studio-preview-inner" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="task-empty">Aperçu indisponible</div>}
        </div>
        <div className="avatar-studio-progress" aria-label={`Étape ${stepIndex + 1} sur ${steps.length}`}>
          <div className="avatar-studio-progress-bar"><span style={{ width: `${progress}%` }} /></div>
          <small>Étape {stepIndex + 1}/{steps.length} · {step.label}</small>
        </div>
        <div className="avatar-studio-quick-actions">
          <Button variant="secondary" onClick={randomize} disabled={saving || (!silhouette && !draft.silhouette)}>
            Génération aléatoire
          </Button>
          <Button variant="secondary" onClick={resetStep} disabled={saving || step.key === "silhouette"}>
            Réinitialiser l'étape
          </Button>
        </div>
      </div>

      <div className="avatar-studio-body">
        <div className="avatar-studio-step-head">
          <span className="overline">ÉTAPE {stepIndex + 1}</span>
          <h3>{step.label}</h3>
          <p>{step.description}</p>
        </div>

        {step.key === "silhouette" ? (
          <div className="avatar-silhouette-grid">
            <SilhouetteCard value="female" label="Femme" description="Silhouette féminine" active={effectiveSilhouette === "female" && !!(silhouette || draft.silhouette)} onSelect={() => chooseSilhouette("female")} />
            <SilhouetteCard value="male" label="Homme" description="Silhouette masculine" active={effectiveSilhouette === "male" && !!(silhouette || draft.silhouette)} onSelect={() => chooseSilhouette("male")} />
          </div>
        ) : (
          <div className="avatar-studio-groups">
            {step.groups.map((group) => {
              const selected = resolveSelected(step.key, group.title, draft);
              const isColor = !!(step.color || (group as any).colorGroup || group.options[0]?.hex);
              return (
                <section className="avatar-studio-group" key={group.title}>
                  <h4>{group.title}</h4>
                  <div className={`avatar-studio-options ${isColor ? "is-color" : ""}`}>
                    {group.options.map((opt) => {
                      const active = selected === opt.value;
                      if (isColor && opt.hex) {
                        const bg = displayHex(opt.hex);
                        return (
                          <button
                            key={`${group.title}-${opt.value}`}
                            type="button"
                            className={`avatar-option-color ${active ? "active" : ""} ${opt.hex === "transparent" ? "is-transparent" : ""}`}
                            style={{ background: bg === "transparent" ? "repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%) 50% / 10px 10px" : bg }}
                            onClick={() => applyPatch(opt.patch)}
                            aria-label={opt.label}
                            aria-pressed={active}
                            title={opt.label}
                          />
                        );
                      }
                      const thumb = thumbnailSvg(draft, opt.patch);
                      return (
                        <button
                          key={`${group.title}-${opt.value}`}
                          type="button"
                          className={`avatar-option ${active ? "active" : ""}`}
                          onClick={() => applyPatch(opt.patch)}
                          aria-label={opt.label}
                          aria-pressed={active}
                          title={opt.label}
                        >
                          {thumb ? <span className="avatar-option-thumb" dangerouslySetInnerHTML={{ __html: thumb }} /> : <span className="avatar-option-thumb task-empty">–</span>}
                          <small>{opt.label}</small>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
        {saved && <p className="form-success" role="status">Votre avatar a été enregistré.</p>}

        <div className="avatar-studio-nav settings-actions">
          <Button variant="secondary" onClick={() => setStepIndex((i) => Math.max(0, i - 1))} disabled={stepIndex === 0 || saving}>
            Précédent
          </Button>
          {stepIndex < steps.length - 1 ? (
            <Button onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))} disabled={!canGoNext || saving}>
              Suivant
            </Button>
          ) : (
            <Button onClick={() => void handleSave()} disabled={saving || (!silhouette && !draft.silhouette)}>
              {saving ? "Enregistrement…" : "Enregistrer l'avatar"}
            </Button>
          )}
          <Button variant="secondary" onClick={handleCancel} disabled={saving}>
            Annuler
          </Button>
        </div>
      </div>
    </div>
  );
}

export { parseAvatarConfig };
