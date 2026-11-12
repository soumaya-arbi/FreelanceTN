"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { FormField, EditorHeading } from "@/components/ui/Form";
import { useApp } from "@/context/AppContext";
import { useMarketplace } from "@/context/MarketplaceContext";
import { CvPreview } from "./CvPreview";
import { useUser } from "@/context/UserContext";
import {
  ApiError,
  portfolioApi,
  type AuthUser,
  type CvCertification,
  type CvEducation,
  type CvExperience,
  type CvImportResult,
  type CvLanguage,
  type UpdateProfileInput,
} from "@/lib/api";

const LANGUAGE_LEVELS = ["Basic", "Intermediate", "Advanced", "Native"] as const;
const PROJECT_TYPES = ["Fixed-price projects", "Hourly contracts", "Long-term engagements", "One-time consultations"];
const WORK_PREFERENCES = ["Remote only", "Remote and on-site"];

/** Alias FR/EN → valeur canonique backend. Ne jamais inventer un niveau absent. */
const LANGUAGE_LEVEL_ALIASES: Record<string, (typeof LANGUAGE_LEVELS)[number]> = {
  basic: "Basic",
  beginner: "Basic",
  debutant: "Basic",
  débutant: "Basic",
  notions: "Basic",
  intermediate: "Intermediate",
  intermediaire: "Intermediate",
  intermédiaire: "Intermediate",
  moyen: "Intermediate",
  advanced: "Advanced",
  avance: "Advanced",
  avancé: "Advanced",
  courant: "Advanced",
  fluent: "Advanced",
  native: "Native",
  natif: "Native",
  maternelle: "Native",
  bilingue: "Native",
};

type Section = "profile" | "skills" | "experience" | "education" | "certifications" | "languages" | "preview";

const canonicalizeLanguageLevel = (value: string | undefined | null): string => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  const exact = LANGUAGE_LEVELS.find((level) => level.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  const alias = LANGUAGE_LEVEL_ALIASES[trimmed.toLowerCase()];
  return alias ?? trimmed;
};

const normalizeExperience = (item: CvExperience): CvExperience => ({
  id: item.id,
  role: item.role ?? "",
  company: item.company ?? "",
  location: item.location ?? "",
  period: item.period ?? "",
  startDate: item.startDate ?? "",
  endDate: item.endDate ?? "",
  isCurrent: Boolean(item.isCurrent),
  technologies: Array.isArray(item.technologies) ? item.technologies : [],
  description: item.description ?? "",
});

const normalizeEducation = (item: CvEducation): CvEducation => ({
  id: item.id,
  degree: item.degree ?? "",
  institution: item.institution ?? "",
  specialty: item.specialty ?? "",
  location: item.location ?? "",
  period: item.period ?? "",
  startDate: item.startDate ?? "",
  endDate: item.endDate ?? "",
  description: item.description ?? "",
});

const normalizeCertification = (item: CvCertification): CvCertification => ({
  id: item.id,
  name: item.name ?? "",
  issuer: item.issuer ?? "",
  year: item.year ?? "",
});

const normalizeLanguage = (item: CvLanguage): CvLanguage => ({
  id: item.id,
  name: item.name ?? "",
  // Ne pas forcer Intermediate : un niveau vide reste vide jusqu'au choix utilisateur.
  level: canonicalizeLanguageLevel(item.level),
});

const emptyExperience = (): CvExperience => ({
  role: "",
  company: "",
  location: "",
  period: "",
  startDate: "",
  endDate: "",
  isCurrent: false,
  technologies: [],
  description: "",
});
const emptyEducation = (): CvEducation => ({
  degree: "",
  institution: "",
  specialty: "",
  location: "",
  period: "",
  startDate: "",
  endDate: "",
  description: "",
});
const emptyLanguage = (): CvLanguage => ({ name: "", level: "" });
const emptyCertification = (): CvCertification => ({ name: "", issuer: "", year: "" });

/** Période affichée : dates normalisées d'abord, texte libre conservé pour les anciennes données. */
const formatPeriod = (item: { startDate?: string; endDate?: string; isCurrent?: boolean; period?: string }): string => {
  const start = item.startDate?.trim() ?? "";
  const end = item.endDate?.trim() ?? "";
  if (start && (end || item.isCurrent)) return `${start} — ${item.isCurrent ? "Présent" : end}`;
  if (start) return start;
  return item.period?.trim() ?? "";
};

const composePeriod = (item: { startDate?: string; endDate?: string; isCurrent?: boolean; period?: string }): string => {
  const start = item.startDate?.trim() ?? "";
  const end = item.endDate?.trim() ?? "";
  if (start && (end || item.isCurrent)) return `${start} — ${item.isCurrent ? "Présent" : end}`;
  if (start) return start;
  return item.period?.trim() ?? "";
};

/**
 * Même règle de réenroulement que le PDF : les lignes coupées par la mise en
 * page du CV d'origine sont recollées, les listes à puces gardent leurs retours.
 */
const flowText = (value: string | undefined | null): string => {
  const lines = (value ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return "";
  const hasBullets = lines.some((line) => line.length > 1 && "•·▪◦-*".includes(line[0]) && /\s/.test(line[1]));
  return hasBullets ? lines.join("\n") : lines.join(" ").replace(/[^\S\n]{2,}/g, " ");
};

const hasText = (value: string | undefined | null): boolean => Boolean(value && value.trim().length > 0);

const uniqueMerge = (current: string[], incoming: string[]): string[] => {
  const next = [...current];
  for (const value of incoming) {
    const trimmed = value.trim();
    if (trimmed && !next.some((item) => item.toLowerCase() === trimmed.toLowerCase())) next.push(trimmed);
  }
  return next;
};

/** Saisie de technologies : le texte est commité au blur / Entrée pour ne pas casser la virgule en cours de frappe. */
function TechnologiesInput({ value, onCommit }: { value: string[]; onCommit: (next: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));

  useEffect(() => {
    setText(value.join(", "));
  }, [value]);

  const commit = () => onCommit(text.split(",").map((item) => item.trim()).filter(Boolean));

  return (
    <input
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
      placeholder="React, TypeScript, MongoDB…"
      maxLength={500}
    />
  );
}

export function PortfolioCvEditor() {
  const { notify } = useApp();
  const { authUser, status, updateProfile, uploadAvatar } = useUser();
  const { portfolio } = useMarketplace();

  // Le PDF n'imprime que les réalisations publiées : l'aperçu suit la même règle.
  const publishedProjects = useMemo(() => portfolio.filter((item) => item.published), [portfolio]);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [github, setGithub] = useState("");
  const [website, setWebsite] = useState("");
  const [avatar, setAvatar] = useState("");
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [newSkill, setNewSkill] = useState("");
  const [hourlyRate, setHourlyRate] = useState("0");
  const [experiences, setExperiences] = useState<CvExperience[]>([]);
  const [education, setEducation] = useState<CvEducation[]>([]);
  const [certifications, setCertifications] = useState<CvCertification[]>([]);
  const [languages, setLanguages] = useState<CvLanguage[]>([]);
  const [projectTypes, setProjectTypes] = useState<string[]>([]);
  const [workPreference, setWorkPreference] = useState("");
  const [minimumBudget, setMinimumBudget] = useState("");

  const [section, setSection] = useState<Section>("profile");
  const [editingExp, setEditingExp] = useState<number | null>(null);
  const [editingEdu, setEditingEdu] = useState<number | null>(null);
  const [editingCert, setEditingCert] = useState<number | null>(null);
  const [confirming, setConfirming] = useState("");

  const [dirty, setDirtyState] = useState(false);
  const dirtyRef = useRef(false);
  const hydratedKey = useRef<string | null>(null);
  const hydratedUserId = useRef<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [pendingImport, setPendingImport] = useState<CvImportResult | null>(null);
  const [importError, setImportError] = useState("");
  const [showImportPanel, setShowImportPanel] = useState(false);

  const markDirty = () => {
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      setDirtyState(true);
    }
  };

  const hydrate = (user: AuthUser) => {
    setFirstName(user.firstName ?? "");
    setLastName(user.lastName ?? "");
    setTitle(user.title ?? "");
    setLocation(user.location ?? "");
    setPhone(user.phone ?? "");
    setLinkedin(user.linkedin ?? "");
    setGithub(user.github ?? "");
    setWebsite(user.website ?? "");
    setAvatar(user.avatar ?? "");
    setBio(user.bio ?? "");
    setSkills(Array.isArray(user.skills) ? user.skills : []);
    setHourlyRate(String(user.hourlyRate ?? 0));
    setExperiences((user.experiences ?? []).map(normalizeExperience));
    setEducation((user.education ?? []).map(normalizeEducation));
    setCertifications((user.certifications ?? []).map(normalizeCertification));
    setLanguages((user.languages ?? []).map(normalizeLanguage));
    setProjectTypes(user.workPreferences?.projectTypes ?? []);
    setWorkPreference(user.workPreferences?.workPreference ?? "");
    setMinimumBudget(user.workPreferences?.minimumBudget ?? "");
    dirtyRef.current = false;
    setDirtyState(false);
  };

  // La session est chargée après le montage : l'état du formulaire est
  // resynchronisé dès que le compte réel arrive, et jamais écrasé par une
  // réponse tardive lorsque l'utilisateur a déjà commencé à modifier.
  useEffect(() => {
    if (!authUser) return;

    const key = `${authUser.id}:${authUser.updatedAt ?? ""}`;
    const differentUser = hydratedUserId.current !== null && hydratedUserId.current !== authUser.id;
    if (hydratedKey.current === key) return;
    if (hydratedKey.current !== null && dirtyRef.current && !differentUser) return;

    hydratedKey.current = key;
    hydratedUserId.current = authUser.id;
    hydrate(authUser);
  }, [authUser]);

  const patchExperience = (index: number, patch: Partial<CvExperience>) => {
    setExperiences((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    markDirty();
  };
  const patchEducation = (index: number, patch: Partial<CvEducation>) => {
    setEducation((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    markDirty();
  };
  const patchCertification = (index: number, patch: Partial<CvCertification>) => {
    setCertifications((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    markDirty();
  };
  const patchLanguage = (index: number, patch: Partial<CvLanguage>) => {
    setLanguages((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    markDirty();
  };

  const addSkill = () => {
    const value = newSkill.trim();
    if (!value) return;
    if (skills.some((item) => item.toLowerCase() === value.toLowerCase())) {
      setNewSkill("");
      return;
    }
    setSkills([...skills, value]);
    setNewSkill("");
    markDirty();
  };

  const toggleProjectType = (value: string) => {
    setProjectTypes((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
    markDirty();
  };

  const removeExperience = (index: number) => {
    setExperiences((current) => current.filter((_, i) => i !== index));
    setEditingExp(null);
    setConfirming("");
    markDirty();
  };
  const removeEducation = (index: number) => {
    setEducation((current) => current.filter((_, i) => i !== index));
    setEditingEdu(null);
    setConfirming("");
    markDirty();
  };
  const removeCertification = (index: number) => {
    setCertifications((current) => current.filter((_, i) => i !== index));
    setEditingCert(null);
    setConfirming("");
    markDirty();
  };
  const removeLanguage = (index: number) => {
    setLanguages((current) => current.filter((_, i) => i !== index));
    setConfirming("");
    markDirty();
  };

  const buildPayload = (): UpdateProfileInput => ({
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    title: title.trim(),
    location: location.trim(),
    phone: phone.trim(),
    linkedin: linkedin.trim(),
    github: github.trim(),
    website: website.trim(),
    avatar,
    bio: bio.trim(),
    skills,
    hourlyRate: hasText(hourlyRate) ? Number.parseFloat(hourlyRate.replace(",", ".")) || 0 : undefined,
    experiences: experiences
      .filter((item) =>
        [item.role, item.company, item.location, item.period, item.startDate, item.endDate, item.description].some(hasText) ||
        item.technologies.length > 0,
      )
      .map((item) => ({
        ...item,
        period: composePeriod(item),
        technologies: Array.isArray(item.technologies) ? item.technologies : [],
      })),
    education: education
      .filter((item) =>
        [item.degree, item.institution, item.specialty, item.location, item.period, item.startDate, item.endDate, item.description].some(hasText),
      )
      .map((item) => ({
        ...item,
        period: composePeriod(item),
      })),
    certifications: certifications.filter((item) => hasText(item.name)),
    languages: languages
      .filter((item) => hasText(item.name))
      .map((item) => ({
        ...item,
        level: canonicalizeLanguageLevel(item.level),
      })),
    workPreferences: {
      projectTypes,
      workPreference,
      minimumBudget: minimumBudget.trim(),
    },
  });

  const save = async () => {
    if (!hasText(firstName) || !hasText(lastName)) {
      notify("Le prénom et le nom sont obligatoires.");
      setSection("profile");
      return;
    }

    const payload = buildPayload();
    setSaving(true);
    try {
      const user = await updateProfile(payload);
      hydratedKey.current = `${user.id}:${user.updatedAt ?? ""}`;
      hydratedUserId.current = user.id;
      hydrate(user);
      notify("CV enregistré");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Impossible d'enregistrer le CV.");
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async () => {
    if (dirty) {
      notify("Enregistrez vos modifications avant de télécharger le PDF.");
      return;
    }
    setDownloading(true);
    try {
      await portfolioApi.downloadCv();
      notify("CV PDF téléchargé");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Impossible de générer le CV PDF.");
    } finally {
      setDownloading(false);
    }
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      notify("Le fichier doit être au format PDF.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      notify("Le CV ne peut pas dépasser 10 Mo.");
      return;
    }
    setImporting(true);
    setImportError("");
    try {
      const result = await portfolioApi.importCv(file);
      setPendingImport(result);
      setShowImportPanel(true);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "L'importation du CV a échoué.";
      setImportError(message);
      notify(message);
    } finally {
      setImporting(false);
    }
  };

  const applyImport = () => {
    if (!pendingImport) return;
    const imported = pendingImport;

    if (hasText(imported.firstName)) setFirstName(imported.firstName.trim());
    if (hasText(imported.lastName)) setLastName(imported.lastName.trim());
    if (hasText(imported.title)) setTitle(imported.title.trim());
    if (hasText(imported.summary)) setBio(imported.summary.trim());
    if (hasText(imported.phone)) setPhone(imported.phone.trim());
    if (hasText(imported.location)) setLocation(imported.location.trim());
    if (hasText(imported.linkedin)) setLinkedin(imported.linkedin.trim());
    if (hasText(imported.github)) setGithub(imported.github.trim());
    if (hasText(imported.website)) setWebsite(imported.website.trim());
    if (imported.skills.length > 0) setSkills(imported.skills);
    if (imported.experiences.length > 0) setExperiences(imported.experiences.map(normalizeExperience));
    if (imported.education.length > 0) setEducation(imported.education.map(normalizeEducation));
    if (imported.certifications.length > 0) setCertifications(imported.certifications.map(normalizeCertification));
    if (imported.languages.length > 0) setLanguages(imported.languages.map(normalizeLanguage));

    setPendingImport(null);
    setShowImportPanel(false);
    setSection("profile");
    markDirty();
    notify("Données importées. Vérifiez chaque champ puis cliquez sur Enregistrer.");
  };

  const handleAvatarUpload = async (file: File | null) => {
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const user = await uploadAvatar(file);
      setAvatar(user.avatar ?? "");
      notify("Photo de profil mise à jour");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Impossible de téléverser la photo.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const sections: { id: Section; label: string; count?: number }[] = [
    { id: "profile", label: "Profil" },
    { id: "skills", label: "Compétences", count: skills.length },
    { id: "experience", label: "Expériences", count: experiences.length },
    { id: "education", label: "Formations", count: education.length },
    { id: "certifications", label: "Certifications", count: certifications.length },
    { id: "languages", label: "Langues", count: languages.length },
    { id: "preview", label: "Aperçu CV" },
  ];

  return (
    <div className="cv-editor">
      <div className="cv-actionbar">
        <div className="cv-actionbar-status">
          {status === "loading" && <span className="cv-unsaved"><Icon name="clock" size={14} /> Chargement du profil…</span>}
          {status !== "loading" && dirty && <span className="cv-unsaved"><Icon name="file" size={14} /> Modifications non enregistrées</span>}
        </div>
        <div className="cv-actionbar-actions">
          <label className={`btn btn-secondary${importing ? " is-disabled" : ""}`} style={{ cursor: importing ? "wait" : "pointer" }}>
            {importing ? "Importation…" : "Importer un CV PDF"}
            <input
              type="file"
              accept="application/pdf,.pdf"
              style={{ display: "none" }}
              disabled={importing}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                void handleImportFile(file);
                event.target.value = "";
              }}
            />
          </label>
          <Button onClick={handleDownload} disabled={downloading || dirty} title={dirty ? "Enregistrez vos modifications avant de télécharger" : undefined}>
            {downloading ? "Génération…" : "Télécharger mon CV PDF"}
          </Button>
          <Button onClick={save} disabled={saving} icon="check">
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </div>

      {importError && <p className="form-error" role="alert">{importError}</p>}

      {showImportPanel && pendingImport && (
        <div className="dash-card cv-import-panel">
          <EditorHeading
            title="Prévisualisation du CV importé"
            text="Corrigez les informations ci-dessous puis appliquez-les au formulaire. Rien n'est enregistré avant votre validation."
          />
          <p className="cv-import-meta">
            {pendingImport.pageCount} page(s) · {pendingImport.pagesWithText} avec texte · {pendingImport.extractedCharacters} caractères extraits
          </p>

          {pendingImport.uncertain.length > 0 && (
            <div className="cv-uncertain">
              <b>À vérifier</b>
              <ul>
                {pendingImport.uncertain.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </div>
          )}

          {pendingImport.warnings.length > 0 && (
            <ul className="cv-import-warnings">
              {pendingImport.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
            </ul>
          )}

          <div className="form-split">
            <FormField label="Prénom">
              <input value={pendingImport.firstName} onChange={(e) => setPendingImport({ ...pendingImport, firstName: e.target.value })} maxLength={80} />
            </FormField>
            <FormField label="Nom">
              <input value={pendingImport.lastName} onChange={(e) => setPendingImport({ ...pendingImport, lastName: e.target.value })} maxLength={80} />
            </FormField>
          </div>
          <FormField label="Titre professionnel">
            <input value={pendingImport.title} onChange={(e) => setPendingImport({ ...pendingImport, title: e.target.value })} maxLength={120} />
          </FormField>
          <FormField label="Résumé">
            <textarea value={pendingImport.summary} onChange={(e) => setPendingImport({ ...pendingImport, summary: e.target.value })} maxLength={2000} />
          </FormField>
          <div className="form-split">
            <FormField label="Téléphone détecté">
              <input value={pendingImport.phone} onChange={(e) => setPendingImport({ ...pendingImport, phone: e.target.value })} maxLength={40} />
            </FormField>
            <FormField label="Localisation détectée">
              <input value={pendingImport.location} onChange={(e) => setPendingImport({ ...pendingImport, location: e.target.value })} maxLength={160} />
            </FormField>
          </div>
          <div className="form-split">
            <FormField label="LinkedIn détecté">
              <input value={pendingImport.linkedin} onChange={(e) => setPendingImport({ ...pendingImport, linkedin: e.target.value })} maxLength={500} />
            </FormField>
            <FormField label="GitHub détecté">
              <input value={pendingImport.github} onChange={(e) => setPendingImport({ ...pendingImport, github: e.target.value })} maxLength={500} />
            </FormField>
          </div>
          <FormField label="Site web détecté">
            <input value={pendingImport.website} onChange={(e) => setPendingImport({ ...pendingImport, website: e.target.value })} maxLength={500} />
          </FormField>
          <FormField label="Compétences détectées (séparées par des virgules)">
            <textarea
              value={pendingImport.skills.join(", ")}
              onChange={(e) => setPendingImport({ ...pendingImport, skills: e.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
            />
          </FormField>

          {pendingImport.experiences.length > 0 && (
            <div className="cv-import-block">
              <b>Expériences ({pendingImport.experiences.length})</b>
              {pendingImport.experiences.map((experience, index) => (
                <article key={index} className="cv-import-entry">
                  <div className="form-split">
                    <FormField label="Poste">
                      <input
                        value={experience.role}
                        onChange={(e) =>
                          setPendingImport({
                            ...pendingImport,
                            experiences: pendingImport.experiences.map((item, i) => (i === index ? { ...item, role: e.target.value } : item)),
                          })
                        }
                      />
                    </FormField>
                    <FormField label="Entreprise">
                      <input
                        value={experience.company}
                        onChange={(e) =>
                          setPendingImport({
                            ...pendingImport,
                            experiences: pendingImport.experiences.map((item, i) => (i === index ? { ...item, company: e.target.value } : item)),
                          })
                        }
                      />
                    </FormField>
                  </div>
                  <div className="form-split">
                    <FormField label="Lieu">
                      <input
                        value={experience.location}
                        onChange={(e) =>
                          setPendingImport({
                            ...pendingImport,
                            experiences: pendingImport.experiences.map((item, i) => (i === index ? { ...item, location: e.target.value } : item)),
                          })
                        }
                      />
                    </FormField>
                    <FormField label="Période">
                      <input
                        value={experience.period}
                        onChange={(e) =>
                          setPendingImport({
                            ...pendingImport,
                            experiences: pendingImport.experiences.map((item, i) => (i === index ? { ...item, period: e.target.value } : item)),
                          })
                        }
                      />
                    </FormField>
                  </div>
                  <FormField label="Description">
                    <textarea
                      value={experience.description}
                      onChange={(e) =>
                        setPendingImport({
                          ...pendingImport,
                          experiences: pendingImport.experiences.map((item, i) => (i === index ? { ...item, description: e.target.value } : item)),
                        })
                      }
                    />
                  </FormField>
                </article>
              ))}
            </div>
          )}

          {pendingImport.education.length > 0 && (
            <div className="cv-import-block">
              <b>Formations ({pendingImport.education.length})</b>
              {pendingImport.education.map((item, index) => (
                <article key={index} className="cv-import-entry">
                  <div className="form-split">
                    <FormField label="Diplôme">
                      <input
                        value={item.degree}
                        onChange={(e) =>
                          setPendingImport({
                            ...pendingImport,
                            education: pendingImport.education.map((entry, i) => (i === index ? { ...entry, degree: e.target.value } : entry)),
                          })
                        }
                      />
                    </FormField>
                    <FormField label="Établissement">
                      <input
                        value={item.institution}
                        onChange={(e) =>
                          setPendingImport({
                            ...pendingImport,
                            education: pendingImport.education.map((entry, i) => (i === index ? { ...entry, institution: e.target.value } : entry)),
                          })
                        }
                      />
                    </FormField>
                  </div>
                  <div className="form-split">
                    <FormField label="Spécialité">
                      <input
                        value={item.specialty}
                        onChange={(e) =>
                          setPendingImport({
                            ...pendingImport,
                            education: pendingImport.education.map((entry, i) => (i === index ? { ...entry, specialty: e.target.value } : entry)),
                          })
                        }
                      />
                    </FormField>
                    <FormField label="Période">
                      <input
                        value={item.period}
                        onChange={(e) =>
                          setPendingImport({
                            ...pendingImport,
                            education: pendingImport.education.map((entry, i) => (i === index ? { ...entry, period: e.target.value } : entry)),
                          })
                        }
                      />
                    </FormField>
                  </div>
                </article>
              ))}
            </div>
          )}

          {pendingImport.languages.length > 0 && (
            <div className="cv-import-block">
              <b>Langues parlées ({pendingImport.languages.length})</b>
              {pendingImport.languages.map((language, index) => (
                <div key={index} className="cv-lang-edit">
                  <input
                    value={language.name}
                    onChange={(e) =>
                      setPendingImport({
                        ...pendingImport,
                        languages: pendingImport.languages.map((entry, i) => (i === index ? { ...entry, name: e.target.value } : entry)),
                      })
                    }
                    maxLength={60}
                  />
                  <select
                    value={canonicalizeLanguageLevel(language.level)}
                    onChange={(e) =>
                      setPendingImport({
                        ...pendingImport,
                        languages: pendingImport.languages.map((entry, i) => (i === index ? { ...entry, level: e.target.value } : entry)),
                      })
                    }
                  >
                    <option value="">À préciser</option>
                    {LANGUAGE_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}

          {pendingImport.certifications.length > 0 && (
            <div className="cv-import-block">
              <b>Certifications ({pendingImport.certifications.length})</b>
              {pendingImport.certifications.map((item, index) => (
                <div key={index} className="form-split">
                  <FormField label="Certification">
                    <input
                      value={item.name}
                      onChange={(e) =>
                        setPendingImport({
                          ...pendingImport,
                          certifications: pendingImport.certifications.map((entry, i) => (i === index ? { ...entry, name: e.target.value } : entry)),
                        })
                      }
                    />
                  </FormField>
                  <FormField label="Organisme">
                    <input
                      value={item.issuer}
                      onChange={(e) =>
                        setPendingImport({
                          ...pendingImport,
                          certifications: pendingImport.certifications.map((entry, i) => (i === index ? { ...entry, issuer: e.target.value } : entry)),
                        })
                      }
                    />
                  </FormField>
                  <FormField label="Année">
                    <input
                      value={item.year}
                      onChange={(e) =>
                        setPendingImport({
                          ...pendingImport,
                          certifications: pendingImport.certifications.map((entry, i) => (i === index ? { ...entry, year: e.target.value } : entry)),
                        })
                      }
                    />
                  </FormField>
                </div>
              ))}
            </div>
          )}

          <div className="title-actions" style={{ marginTop: 14 }}>
            <Button onClick={applyImport} icon="check">Appliquer au formulaire</Button>
            <Button variant="secondary" onClick={() => { setPendingImport(null); setShowImportPanel(false); }}>Annuler</Button>
          </div>
        </div>
      )}

      <div className="module-summary">
        <article><span><Icon name="file" /></span><b>{skills.length}</b><small>Compétences</small></article>
        <article><span><Icon name="briefcase" /></span><b>{experiences.length}</b><small>Expériences</small></article>
        <article><span><Icon name="shield" /></span><b>{education.length + certifications.length}</b><small>Formations &amp; certifs</small></article>
        <article><span><Icon name="globe" /></span><b>{languages.length}</b><small>Langues</small></article>
      </div>

      <nav className="cv-tabs" aria-label="Sections du CV">
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            className={section === item.id ? "active" : ""}
            onClick={() => setSection(item.id)}
          >
            {item.label}
            {typeof item.count === "number" && <em>{item.count}</em>}
          </button>
        ))}
      </nav>

      {section === "profile" && (
        <section className="dash-card cv-section">
          <EditorHeading title="Profil" text="Vos informations d'identité et de contact, reprises dans l'aperçu et le PDF." />

          <div className="cv-photo-row">
            {avatar ? (
              <img src={avatar} alt="Photo de profil" className="cv-photo" />
            ) : (
              <div className="cv-photo cv-photo-empty">Photo</div>
            )}
            <div>
              <label className="btn btn-secondary" style={{ cursor: uploadingAvatar ? "wait" : "pointer" }}>
                {uploadingAvatar ? "Téléversement…" : "Changer la photo"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: "none" }}
                  disabled={uploadingAvatar}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    void handleAvatarUpload(file);
                    event.target.value = "";
                  }}
                />
              </label>
              <small>JPG, PNG ou WebP. La photo apparaît dans le CV PDF.</small>
            </div>
          </div>

          <div className="form-split">
            <FormField label="Prénom">
              <input value={firstName} onChange={(e) => { setFirstName(e.target.value); markDirty(); }} maxLength={80} />
            </FormField>
            <FormField label="Nom">
              <input value={lastName} onChange={(e) => { setLastName(e.target.value); markDirty(); }} maxLength={80} />
            </FormField>
          </div>
          <FormField label="Titre professionnel">
            <input value={title} onChange={(e) => { setTitle(e.target.value); markDirty(); }} placeholder="ex. Développeur full-stack" maxLength={120} />
          </FormField>
          <FormField label="Email du compte (non modifiable ici)">
            <input value={authUser?.email ?? ""} readOnly />
          </FormField>
          <div className="form-split">
            <FormField label="Localisation">
              <input value={location} onChange={(e) => { setLocation(e.target.value); markDirty(); }} placeholder="Tunis, Tunisie" maxLength={160} />
            </FormField>
            <FormField label="Téléphone">
              <input value={phone} onChange={(e) => { setPhone(e.target.value); markDirty(); }} placeholder="+216 20 000 000" maxLength={40} />
            </FormField>
          </div>
          <div className="form-split">
            <FormField label="LinkedIn">
              <input value={linkedin} onChange={(e) => { setLinkedin(e.target.value); markDirty(); }} placeholder="https://linkedin.com/in/…" maxLength={500} />
            </FormField>
            <FormField label="GitHub">
              <input value={github} onChange={(e) => { setGithub(e.target.value); markDirty(); }} placeholder="https://github.com/…" maxLength={500} />
            </FormField>
          </div>
          <FormField label="Site web / portfolio">
            <input value={website} onChange={(e) => { setWebsite(e.target.value); markDirty(); }} placeholder="https://…" maxLength={500} />
          </FormField>
          <FormField label="Résumé professionnel">
            <textarea value={bio} onChange={(e) => { setBio(e.target.value); markDirty(); }} placeholder="Présentez votre expertise et vos réalisations." maxLength={2000} />
          </FormField>

          <EditorHeading title="Tarifs et préférences" text="Ces informations figurent en fin de CV." />
          <div className="form-split">
            <FormField label="Tarif horaire">
              <div className="money-input"><span>TND</span><input value={hourlyRate} onChange={(e) => { setHourlyRate(e.target.value); markDirty(); }} inputMode="decimal" /><em>/h</em></div>
            </FormField>
            <FormField label="Budget minimum">
              <input value={minimumBudget} onChange={(e) => { setMinimumBudget(e.target.value); markDirty(); }} placeholder="ex. 2 500 TND" maxLength={60} />
            </FormField>
          </div>
          <FormField label="Types de projets">
            <div className="check-grid">
              {PROJECT_TYPES.map((type) => (
                <label key={type}><input type="checkbox" checked={projectTypes.includes(type)} onChange={() => toggleProjectType(type)} /> {type}</label>
              ))}
            </div>
          </FormField>
          <FormField label="Mode de travail">
            <select value={workPreference} onChange={(e) => { setWorkPreference(e.target.value); markDirty(); }}>
              <option value="">Sélectionner</option>
              {WORK_PREFERENCES.map((pref) => <option key={pref} value={pref}>{pref}</option>)}
            </select>
          </FormField>
        </section>
      )}

      {section === "skills" && (
        <section className="dash-card cv-section">
          <EditorHeading title="Compétences techniques" text="Langages, frameworks, outils et méthodologies. Les langues parlées ont leur propre section." />
          <div className="cv-badges">
            {skills.map((skill) => (
              <span className="cv-badge" key={skill}>
                {skill}
                <button
                  type="button"
                  aria-label={`Supprimer ${skill}`}
                  onClick={() => { setSkills(skills.filter((item) => item !== skill)); markDirty(); }}
                >
                  <Icon name="close" size={13} />
                </button>
              </span>
            ))}
            {skills.length === 0 && <p className="cv-empty">Aucune compétence ajoutée.</p>}
          </div>
          <div className="add-skill">
            <input
              value={newSkill}
              onChange={(e) => setNewSkill(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }}
              placeholder="Ajouter une compétence (ex. React)"
              maxLength={60}
            />
            <Button onClick={addSkill}>Ajouter</Button>
          </div>
        </section>
      )}

      {section === "experience" && (
        <section className="dash-card cv-section">
          <EditorHeading title="Expériences" text="Poste, entreprise, lieu, dates et réalisations. Cliquez sur Modifier pour ouvrir le panneau d'édition." />

          <div className="cv-card-list">
            {experiences.map((experience, index) => {
              const key = `exp-${experience.id ?? index}`;
              return (
                <article className="cv-card" key={key}>
                  <div className="cv-card-head">
                    <div>
                      <b>{experience.role || "Poste à compléter"}</b>
                      <small>
                        {[experience.company, experience.location].filter(Boolean).join(" · ")}
                        {formatPeriod(experience) ? `${experience.company || experience.location ? " · " : ""}${formatPeriod(experience)}` : ""}
                      </small>
                    </div>
                    <div className="cv-card-actions">
                      <button type="button" onClick={() => setEditingExp(editingExp === index ? null : index)}>
                        {editingExp === index ? "Fermer" : "Modifier"}
                      </button>
                      {confirming === key ? (
                        <span className="cv-confirm">
                          <button type="button" className="danger" onClick={() => removeExperience(index)}>Confirmer</button>
                          <button type="button" onClick={() => setConfirming("")}>Annuler</button>
                        </span>
                      ) : (
                        <button type="button" className="danger" onClick={() => setConfirming(key)}>Supprimer</button>
                      )}
                    </div>
                  </div>

                  {editingExp !== index && experience.description && <p className="cv-card-text">{experience.description}</p>}
                  {editingExp !== index && experience.technologies.length > 0 && (
                    <div className="cv-badges small">
                      {experience.technologies.map((technology) => <span className="cv-badge" key={technology}>{technology}</span>)}
                    </div>
                  )}

                  {editingExp === index && (
                    <div className="cv-edit-panel">
                      <div className="form-split">
                        <FormField label="Poste"><input value={experience.role} onChange={(e) => patchExperience(index, { role: e.target.value })} maxLength={120} /></FormField>
                        <FormField label="Entreprise"><input value={experience.company} onChange={(e) => patchExperience(index, { company: e.target.value })} maxLength={120} /></FormField>
                      </div>
                      <FormField label="Lieu"><input value={experience.location} onChange={(e) => patchExperience(index, { location: e.target.value })} placeholder="Tunis, Tunisie" maxLength={160} /></FormField>
                      <div className="form-split">
                        <FormField label="Début (AAAA-MM)"><input value={experience.startDate} onChange={(e) => patchExperience(index, { startDate: e.target.value })} placeholder="2021-03" maxLength={20} /></FormField>
                        <FormField label="Fin (AAAA-MM)"><input value={experience.endDate} onChange={(e) => patchExperience(index, { endDate: e.target.value })} placeholder="2023-06" maxLength={20} disabled={experience.isCurrent} /></FormField>
                      </div>
                      <label className="cv-check"><input type="checkbox" checked={experience.isCurrent} onChange={(e) => patchExperience(index, { isCurrent: e.target.checked })} /> Poste en cours</label>
                      <FormField label="Période libre (si dates inconnues)"><input value={experience.period} onChange={(e) => patchExperience(index, { period: e.target.value })} placeholder="2021 — 2023" maxLength={60} /></FormField>
                      <FormField label="Technologies (séparées par des virgules)"><TechnologiesInput value={experience.technologies} onCommit={(next) => patchExperience(index, { technologies: next })} /></FormField>
                      <FormField label="Description"><textarea value={experience.description} onChange={(e) => patchExperience(index, { description: e.target.value })} maxLength={1000} /></FormField>
                    </div>
                  )}
                </article>
              );
            })}
            {experiences.length === 0 && <p className="cv-empty">Aucune expérience ajoutée.</p>}
          </div>

          <Button variant="secondary" onClick={() => { setExperiences([...experiences, emptyExperience()]); setEditingExp(experiences.length); markDirty(); }}>
            Ajouter une expérience
          </Button>
        </section>
      )}

      {section === "education" && (
        <section className="dash-card cv-section">
          <EditorHeading title="Formations" text="Diplômes et cursus. Les certifications professionnelles sont gérées dans leur section dédiée." />

          <div className="cv-card-list">
            {education.map((item, index) => {
              const key = `edu-${item.id ?? index}`;
              return (
                <article className="cv-card" key={key}>
                  <div className="cv-card-head">
                    <div>
                      <b>{item.degree || "Diplôme à compléter"}</b>
                      <small>
                        {[item.specialty, item.institution, item.location].filter(Boolean).join(" · ")}
                        {formatPeriod(item) ? `${[item.specialty, item.institution, item.location].filter(Boolean).length > 0 ? " · " : ""}${formatPeriod(item)}` : ""}
                      </small>
                    </div>
                    <div className="cv-card-actions">
                      <button type="button" onClick={() => setEditingEdu(editingEdu === index ? null : index)}>
                        {editingEdu === index ? "Fermer" : "Modifier"}
                      </button>
                      {confirming === key ? (
                        <span className="cv-confirm">
                          <button type="button" className="danger" onClick={() => removeEducation(index)}>Confirmer</button>
                          <button type="button" onClick={() => setConfirming("")}>Annuler</button>
                        </span>
                      ) : (
                        <button type="button" className="danger" onClick={() => setConfirming(key)}>Supprimer</button>
                      )}
                    </div>
                  </div>

                  {editingEdu !== index && item.description && <p className="cv-card-text">{item.description}</p>}

                  {editingEdu === index && (
                    <div className="cv-edit-panel">
                      <div className="form-split">
                        <FormField label="Diplôme"><input value={item.degree} onChange={(e) => patchEducation(index, { degree: e.target.value })} maxLength={120} /></FormField>
                        <FormField label="Spécialité"><input value={item.specialty} onChange={(e) => patchEducation(index, { specialty: e.target.value })} maxLength={160} /></FormField>
                      </div>
                      <div className="form-split">
                        <FormField label="Établissement"><input value={item.institution} onChange={(e) => patchEducation(index, { institution: e.target.value })} maxLength={120} /></FormField>
                        <FormField label="Lieu"><input value={item.location} onChange={(e) => patchEducation(index, { location: e.target.value })} maxLength={160} /></FormField>
                      </div>
                      <div className="form-split">
                        <FormField label="Début (AAAA-MM)"><input value={item.startDate} onChange={(e) => patchEducation(index, { startDate: e.target.value })} placeholder="2016-09" maxLength={20} /></FormField>
                        <FormField label="Fin (AAAA-MM)"><input value={item.endDate} onChange={(e) => patchEducation(index, { endDate: e.target.value })} placeholder="2019-06" maxLength={20} /></FormField>
                      </div>
                      <FormField label="Période libre (si dates inconnues)"><input value={item.period} onChange={(e) => patchEducation(index, { period: e.target.value })} placeholder="2016 — 2019" maxLength={60} /></FormField>
                      <FormField label="Description"><textarea value={item.description} onChange={(e) => patchEducation(index, { description: e.target.value })} maxLength={1000} /></FormField>
                    </div>
                  )}
                </article>
              );
            })}
            {education.length === 0 && <p className="cv-empty">Aucune formation ajoutée.</p>}
          </div>

          <Button variant="secondary" onClick={() => { setEducation([...education, emptyEducation()]); setEditingEdu(education.length); markDirty(); }}>
            Ajouter une formation
          </Button>
        </section>
      )}

      {section === "certifications" && (
        <section className="dash-card cv-section">
          <EditorHeading title="Certifications" text="Certifications professionnelles, organismes et années." />

          <div className="cv-card-list">
            {certifications.map((item, index) => {
              const key = `cert-${item.id ?? index}`;
              return (
                <article className="cv-card" key={key}>
                  <div className="cv-card-head">
                    <div>
                      <b>{item.name || "Certification à compléter"}</b>
                      <small>{[item.issuer, item.year].filter(Boolean).join(" · ")}</small>
                    </div>
                    <div className="cv-card-actions">
                      <button type="button" onClick={() => setEditingCert(editingCert === index ? null : index)}>
                        {editingCert === index ? "Fermer" : "Modifier"}
                      </button>
                      {confirming === key ? (
                        <span className="cv-confirm">
                          <button type="button" className="danger" onClick={() => removeCertification(index)}>Confirmer</button>
                          <button type="button" onClick={() => setConfirming("")}>Annuler</button>
                        </span>
                      ) : (
                        <button type="button" className="danger" onClick={() => setConfirming(key)}>Supprimer</button>
                      )}
                    </div>
                  </div>

                  {editingCert === index && (
                    <div className="cv-edit-panel">
                      <FormField label="Certification"><input value={item.name} onChange={(e) => patchCertification(index, { name: e.target.value })} maxLength={160} /></FormField>
                      <div className="form-split">
                        <FormField label="Organisme"><input value={item.issuer} onChange={(e) => patchCertification(index, { issuer: e.target.value })} maxLength={160} /></FormField>
                        <FormField label="Année"><input value={item.year} onChange={(e) => patchCertification(index, { year: e.target.value })} maxLength={20} /></FormField>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
            {certifications.length === 0 && <p className="cv-empty">Aucune certification ajoutée.</p>}
          </div>

          <Button variant="secondary" onClick={() => { setCertifications([...certifications, emptyCertification()]); setEditingCert(certifications.length); markDirty(); }}>
            Ajouter une certification
          </Button>
        </section>
      )}

      {section === "languages" && (
        <section className="dash-card cv-section">
          <EditorHeading title="Langues parlées" text="Français, anglais, arabe… Les technologies ne sont jamais classées ici." />

          <div className="cv-card-list">
            {languages.map((language, index) => {
              const key = `lang-${language.id ?? index}`;
              return (
                <article className="cv-card cv-lang-card" key={key}>
                  <div className="cv-lang-row">
                    <input
                      value={language.name}
                      onChange={(e) => patchLanguage(index, { name: e.target.value })}
                      placeholder="ex. Français"
                      maxLength={60}
                      aria-label="Langue"
                    />
                    <select
                      value={canonicalizeLanguageLevel(language.level)}
                      onChange={(e) => patchLanguage(index, { level: e.target.value })}
                      aria-label="Niveau"
                    >
                      <option value="">À préciser</option>
                      {LANGUAGE_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                    </select>
                    {confirming === key ? (
                      <span className="cv-confirm">
                        <button type="button" className="danger" onClick={() => removeLanguage(index)}>Confirmer</button>
                        <button type="button" onClick={() => setConfirming("")}>Annuler</button>
                      </span>
                    ) : (
                      <button type="button" className="cv-icon-btn danger" aria-label="Supprimer la langue" onClick={() => setConfirming(key)}>
                        <Icon name="close" size={15} />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
            {languages.length === 0 && <p className="cv-empty">Aucune langue ajoutée.</p>}
          </div>

          <Button variant="secondary" onClick={() => { setLanguages([...languages, emptyLanguage()]); markDirty(); }}>
            Ajouter une langue
          </Button>
        </section>
      )}

      {section === "preview" && (
        <section className="dash-card cv-section cv-preview-section">
          <EditorHeading
            title="Aperçu CV"
            text={dirty ? "Aperçu des modifications non enregistrées. Enregistrez pour générer un PDF identique." : "Aperçu identique au PDF généré depuis vos données enregistrées."}
          />

          <CvPreview
            fullName={`${firstName} ${lastName}`.trim()}
            title={title}
            phone={phone}
            email={authUser?.email ?? ""}
            location={location}
            linkedin={linkedin}
            github={github}
            website={website}
            avatar={avatar}
            bio={bio}
            skills={skills}
            experiences={experiences}
            education={education}
            certifications={certifications}
            languages={languages}
            hourlyRate={hourlyRate}
            projectTypes={projectTypes}
            workPreference={workPreference}
            minimumBudget={minimumBudget}
            publishedProjects={publishedProjects}
          />
        </section>
      )}

      <div className="cv-bottom-actions">
        <Button onClick={save} disabled={saving} icon="check">{saving ? "Enregistrement…" : "Enregistrer"}</Button>
      </div>
    </div>
  );
}
