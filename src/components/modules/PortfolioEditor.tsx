"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { notFound } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { ModuleShell } from "@/components/modules/ModuleShell";
import { useApp } from "@/context/AppContext";
import { useMarketplace } from "@/context/MarketplaceContext";
import { ApiError, type CreatePortfolioItemInput } from "@/lib/api";
import type { PortfolioItem } from "@/lib/types";

const empty: CreatePortfolioItemInput = {
  title: "",
  summary: "",
  category: "",
  role: "",
  duration: "",
  challenge: "",
  solution: "",
  outcome: "",
  skills: [],
  link: "",
  image: "",
  visibility: "Public",
  published: false,
};

const toDraft = (item: PortfolioItem): CreatePortfolioItemInput => ({
  title: item.title,
  summary: item.summary,
  category: item.category,
  role: item.role,
  duration: item.duration,
  challenge: item.challenge,
  solution: item.solution,
  outcome: item.outcome,
  skills: item.skills,
  link: item.link,
  image: item.image,
  visibility: item.visibility,
  published: item.published,
});

const isValidHttpUrl = (value: string): boolean => {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const validateDraft = (draft: CreatePortfolioItemInput): string => {
  if (draft.title.trim().length < 5) return "The title must contain at least 5 characters.";
  if (draft.title.trim().length > 160) return "The title cannot exceed 160 characters.";
  if (draft.summary.trim().length < 10) return "The summary must contain at least 10 characters.";
  if (draft.summary.trim().length > 1000) return "The summary cannot exceed 1,000 characters.";
  if (!draft.category.trim()) return "The category is required.";
  if (draft.category.trim().length > 120) return "The category cannot exceed 120 characters.";
  if (draft.role.trim().length > 120) return "Your role cannot exceed 120 characters.";
  if (draft.duration.trim().length > 60) return "The duration cannot exceed 60 characters.";
  if (draft.challenge.trim().length > 2000) return "The challenge cannot exceed 2,000 characters.";
  if (draft.solution.trim().length > 2000) return "The solution cannot exceed 2,000 characters.";
  if (draft.outcome.trim().length > 2000) return "The outcome cannot exceed 2,000 characters.";
  if (draft.skills.length > 20) return "20 skills maximum.";
  if (draft.skills.some((skill) => skill.length > 40)) return "Each skill cannot exceed 40 characters.";
  if (!isValidHttpUrl(draft.link)) return "The external link must be a valid http(s) URL.";
  if (!isValidHttpUrl(draft.image)) return "The image URL must be a valid http(s) URL.";
  return "";
};

export function PortfolioEditor({ editId }: { editId?: string }) {
  const router = useRouter();
  const { notify } = useApp();
  const {
    portfolio,
    portfolioLoading,
    portfolioError,
    refreshPortfolio,
    addPortfolioItem,
    updatePortfolioItem,
  } = useMarketplace();

  const existing = editId ? portfolio.find((item) => item.id === editId) : undefined;

  const [draft, setDraft] = useState<CreatePortfolioItemInput>(empty);
  const [skillInput, setSkillInput] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const loadedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!existing || loadedIdRef.current === existing.id) return;
    loadedIdRef.current = existing.id;
    setDraft(toDraft(existing));
  }, [existing]);

  const set = <K extends keyof CreatePortfolioItemInput,>(key: K, value: CreatePortfolioItemInput[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const addSkill = () => {
    const value = skillInput.trim();
    if (!value) return;
    if (value.length > 40) {
      notify("Each skill cannot exceed 40 characters.");
      return;
    }
    if (draft.skills.length >= 20) {
      notify("20 skills maximum.");
      return;
    }
    if (draft.skills.some((skill) => skill.toLowerCase() === value.toLowerCase())) return;
    set("skills", [...draft.skills, value]);
    setSkillInput("");
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;

    const validationError = validateDraft(draft);
    if (validationError) {
      setFormError(validationError);
      notify(validationError);
      return;
    }

    setFormError("");
    setSaving(true);
    const payload: CreatePortfolioItemInput = {
      ...draft,
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      category: draft.category.trim(),
      role: draft.role.trim(),
      duration: draft.duration.trim(),
      challenge: draft.challenge.trim(),
      solution: draft.solution.trim(),
      outcome: draft.outcome.trim(),
      link: draft.link.trim(),
      image: draft.image.trim(),
    };

    try {
      const saved = existing && editId
        ? await updatePortfolioItem(editId, payload)
        : await addPortfolioItem(payload);
      notify(existing ? "Portfolio item updated" : "Portfolio item created");
      router.push(`/freelancer/portfolio/${saved.id}`);
    } catch (error) {
      const message = error instanceof ApiError
        ? error.message
        : "The portfolio item could not be saved. Please try again.";
      setFormError(message);
      notify(message);
    } finally {
      setSaving(false);
    }
  };

  if (editId && !existing && portfolioLoading) {
    return (
      <ModuleShell role="freelancer" page="portfolio">
        <main className="workspace module-page">
          <div className="empty-state" style={{ margin: "60px auto" }}>
            <span><Icon name="clock" size={20} /></span>
            <b>Loading portfolio item…</b>
          </div>
        </main>
      </ModuleShell>
    );
  }

  if (editId && !existing && portfolioError) {
    return (
      <ModuleShell role="freelancer" page="portfolio">
        <main className="workspace module-page">
          <div className="empty-state" style={{ margin: "60px auto" }}>
            <span><Icon name="file" size={20} /></span>
            <b>Portfolio item unavailable</b>
            <p>{portfolioError}</p>
            <Button variant="secondary" onClick={() => { void refreshPortfolio(); }}>Try again</Button>
          </div>
        </main>
      </ModuleShell>
    );
  }

  if (editId && !existing) notFound();

  return (
    <ModuleShell role="freelancer" page="portfolio">
      <main className="workspace module-page">
        <div className="workspace-title">
          <div>
            <p>FREELANCER WORKSPACE</p>
            <h1>{existing ? "Edit portfolio item" : "New portfolio item"}</h1>
            <span>Tell the story behind the work: the challenge, your approach, and the measurable outcome.</span>
          </div>
          <Button variant="secondary" onClick={() => router.push("/freelancer/portfolio")}>Back to portfolio</Button>
        </div>

        <form onSubmit={save} className="editor-page portfolio-editor">
          <div className="dash-card editor-form">
            <div className="editor-heading"><h2>Project story</h2><p>Everything here appears on your public case study.</p></div>
            <label className="editor-field">
              Title
              <input value={draft.title} onChange={(event) => set("title", event.target.value)} placeholder="Banking app redesign" maxLength={160} />
            </label>
            <label className="editor-field">
              Summary
              <textarea value={draft.summary} onChange={(event) => set("summary", event.target.value)} placeholder="A short description clients see first." maxLength={1000} />
            </label>
            <div className="editor-two-col">
              <label className="editor-field">
                Category
                <input value={draft.category} onChange={(event) => set("category", event.target.value)} maxLength={120} />
              </label>
              <label className="editor-field">
                Your role
                <input value={draft.role} onChange={(event) => set("role", event.target.value)} maxLength={120} />
              </label>
              <label className="editor-field">
                Duration
                <input value={draft.duration} onChange={(event) => set("duration", event.target.value)} maxLength={60} />
              </label>
              <label className="editor-field">
                Visibility
                <select value={draft.visibility} onChange={(event) => set("visibility", event.target.value as PortfolioItem["visibility"])}>
                  <option>Public</option>
                  <option>Registered clients only</option>
                  <option>Private</option>
                </select>
              </label>
            </div>
            <label className="editor-field">
              Challenge
              <textarea value={draft.challenge} onChange={(event) => set("challenge", event.target.value)} maxLength={2000} />
            </label>
            <label className="editor-field">
              Solution
              <textarea value={draft.solution} onChange={(event) => set("solution", event.target.value)} maxLength={2000} />
            </label>
            <label className="editor-field">
              Outcome
              <textarea value={draft.outcome} onChange={(event) => set("outcome", event.target.value)} maxLength={2000} />
            </label>

            <div className="editor-field">
              Skills
              <div className="skill-editor">
                <div className="editor-chips">
                  {draft.skills.map((skill) => (
                    <span key={skill} className="selected">
                      {skill}
                      <button type="button" onClick={() => set("skills", draft.skills.filter((item) => item !== skill))} aria-label={`Remove ${skill}`}>
                        <Icon name="close" size={11} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="add-skill">
                  <input value={skillInput} onChange={(event) => setSkillInput(event.target.value)} placeholder="Add a skill" maxLength={40} />
                  <Button type="button" variant="secondary" onClick={addSkill}>Add</Button>
                </div>
              </div>
            </div>

            <label className="editor-field">
              External link
              <input value={draft.link} onChange={(event) => set("link", event.target.value)} placeholder="https://" maxLength={2048} />
            </label>
          </div>

          <aside className="dash-card editor-form">
            <div className="editor-heading"><h2>Cover image</h2><p>Paste a public image URL. Only the URL is stored.</p></div>
            {draft.image && !imageFailed ? (
              <img className="portfolio-cover-preview" src={draft.image} alt="Cover preview" onError={() => setImageFailed(true)} />
            ) : (
              <div className="portfolio-cover-fallback portfolio-cover-preview"><Icon name="portfolio" /></div>
            )}
            <label className="editor-field" style={{ marginTop: 14 }}>
              Image URL
              <input value={draft.image} onChange={(event) => { setImageFailed(false); set("image", event.target.value); }} placeholder="https://" maxLength={2048} />
            </label>
            <label className="publish-toggle">
              <input type="checkbox" checked={draft.published} onChange={(event) => set("published", event.target.checked)} />
              Publish this item on my portfolio
            </label>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <Button type="submit" icon="check" disabled={saving}>
              {saving ? "Saving…" : existing ? "Save changes" : "Create item"}
            </Button>
          </aside>
        </form>
      </main>
    </ModuleShell>
  );
}
