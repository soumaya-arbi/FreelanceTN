"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CvCertification, CvEducation, CvExperience, CvLanguage } from "@/lib/api";
import type { PortfolioItem } from "@/lib/types";

type CvPreviewProps = {
  fullName: string;
  title: string;
  phone: string;
  email: string;
  location: string;
  linkedin: string;
  github: string;
  website: string;
  avatar: string;
  bio: string;
  skills: string[];
  experiences: CvExperience[];
  education: CvEducation[];
  certifications: CvCertification[];
  languages: CvLanguage[];
  hourlyRate: string;
  projectTypes: string[];
  workPreference: string;
  minimumBudget: string;
  publishedProjects: PortfolioItem[];
};

const PT_TO_PX = 96 / 72;
const PAGE_WIDTH_PT = 595;
const PAGE_HEIGHT_PT = 842;
const PAGE_MARGIN_PT = 36;
const CONTENT_TOP_PADDING_PT = 10;
const PAGE_WIDTH_PX = PAGE_WIDTH_PT * PT_TO_PX;
const PAGE_HEIGHT_PX = PAGE_HEIGHT_PT * PT_TO_PX;
const SECTION_GAP_PX = 12 * PT_TO_PX;
const ENSURE_SPACE_PX = 72 * PT_TO_PX;

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

const formatPeriod = (item: { startDate?: string; endDate?: string; isCurrent?: boolean; period?: string }): string => {
  const start = item.startDate?.trim() ?? "";
  const end = item.endDate?.trim() ?? "";
  if (start && (end || item.isCurrent)) return `${start} — ${item.isCurrent ? "Présent" : end}`;
  if (start) return start;
  return item.period?.trim() ?? "";
};

type Atom = { key: string; node: React.ReactNode; gapBefore: number; height?: number };
type Section = { key: string; heading: string; headingGap: number; atoms: Atom[]; headingHeight?: number };

export function CvPreview(props: CvPreviewProps) {
  const {
    fullName, title, phone, email, location, linkedin, github, website, avatar, bio,
    skills, experiences, education, certifications, languages, hourlyRate, projectTypes,
    workPreference, minimumBudget, publishedProjects,
  } = props;

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    let index = 0;
    const headingGap = () => (index === 0 ? 0 : SECTION_GAP_PX);

    if (bio?.trim()) {
      out.push({
        key: "profil",
        heading: "Profil",
        headingGap: headingGap(),
        atoms: [{ key: "profil", gapBefore: 0, node: <p className="cv-preline cv-profile-text">{flowText(bio)}</p> }],
      });
      index++;
    }
    if (skills.length > 0) {
      out.push({
        key: "competences",
        heading: "Compétences",
        headingGap: headingGap(),
        atoms: [{
          key: "competences",
          gapBefore: 0,
          node: (
            <div className="cv-chips">
              {skills.map((skill) => <span className="cv-chip" key={skill}>{skill}</span>)}
            </div>
          ),
        }],
      });
      index++;
    }
    if (experiences.length > 0) {
      out.push({
        key: "experiences",
        heading: "Expériences professionnelles",
        headingGap: headingGap(),
        atoms: experiences.map((experience, i) => ({
          key: `exp-${experience.id ?? i}`,
          gapBefore: 0,
          node: (
            <div className={`cv-entry${i === 0 ? " first" : ""}`}>
              <div className="cv-entry-head">
                <b>{experience.role || "Poste"}</b>
                {formatPeriod(experience) && <span>{formatPeriod(experience)}</span>}
              </div>
              {(experience.company || experience.location) && (
                <div className="cv-entry-org">{[experience.company, experience.location].filter(Boolean).join("  ·  ")}</div>
              )}
              {experience.description && <p className="cv-preline cv-entry-text">{flowText(experience.description)}</p>}
              {experience.technologies.length > 0 && (
                <div className="cv-chips cv-entry-chips">
                  {experience.technologies.map((technology) => <span className="cv-chip cv-chip-tech" key={technology}>{technology}</span>)}
                </div>
              )}
              {i < experiences.length - 1 && <div className="cv-entry-divider" />}
            </div>
          ),
        })),
      });
      index++;
    }
    if (education.length > 0) {
      out.push({
        key: "formations",
        heading: "Formations",
        headingGap: headingGap(),
        atoms: education.map((item, i) => ({
          key: `edu-${item.id ?? i}`,
          gapBefore: 0,
          node: (
            <div className={`cv-entry${i === 0 ? " first" : ""}`}>
              <div className="cv-entry-head">
                <b>{item.degree || "Diplôme"}</b>
                {formatPeriod(item) && <span>{formatPeriod(item)}</span>}
              </div>
              {(item.institution || item.specialty || item.location) && (
                <div className="cv-entry-org">{[item.institution, item.specialty, item.location].filter(Boolean).join("  ·  ")}</div>
              )}
              {item.description && <p className="cv-preline cv-entry-text">{flowText(item.description)}</p>}
              {i < education.length - 1 && <div className="cv-entry-divider" />}
            </div>
          ),
        })),
      });
      index++;
    }
    if (certifications.length > 0) {
      out.push({
        key: "certifications",
        heading: "Certifications",
        headingGap: headingGap(),
        atoms: [{
          key: "certifications",
          gapBefore: 0,
          node: (
            <div className="cv-cert-list">
              {certifications.map((item, i) => {
                const line = [item.name, item.issuer].filter(Boolean).join(" — ") + (item.year ? ` (${item.year})` : "");
                return <div className="cv-cert-line" key={item.id ?? i}>{line}</div>;
              })}
            </div>
          ),
        }],
      });
      index++;
    }
    if (languages.length > 0) {
      const labels = languages
        .filter((language) => language.name?.trim())
        .map((language) => (language.level?.trim() ? `${language.name.trim()} — ${language.level.trim()}` : language.name.trim()));
      if (labels.length > 0) {
        out.push({
          key: "langues",
          heading: "Langues",
          headingGap: headingGap(),
          atoms: [{
            key: "langues",
            gapBefore: 0,
            node: (
              <div className="cv-chips">
                {labels.map((label, i) => <span className="cv-chip" key={i}>{label}</span>)}
              </div>
            ),
          }],
        });
        index++;
      }
    }

    const hasPreferences =
      Number.parseFloat(hourlyRate) > 0 ||
      projectTypes.length > 0 ||
      Boolean(workPreference) ||
      Boolean(minimumBudget);
    if (hasPreferences) {
      const lines: string[] = [];
      if (Number.parseFloat(hourlyRate) > 0) lines.push(`Tarif horaire : ${Number.parseFloat(hourlyRate)} TND/h`);
      if (projectTypes.length > 0) lines.push(`Types de projets : ${projectTypes.join(", ")}`);
      if (workPreference) lines.push(`Modalité : ${workPreference}`);
      if (minimumBudget) lines.push(`Budget minimum : ${minimumBudget}`);
      out.push({
        key: "preferences",
        heading: "Préférences",
        headingGap: headingGap(),
        atoms: [{
          key: "preferences",
          gapBefore: 0,
          node: <p className="cv-pref-text">{lines.join("\n")}</p>,
        }],
      });
      index++;
    }
    if (publishedProjects.length > 0) {
      out.push({
        key: "projets",
        heading: "Projets du portfolio",
        headingGap: headingGap(),
        atoms: publishedProjects.map((project, i) => {
          const meta = [project.category, project.role, project.duration].filter(Boolean);
          return {
            key: `proj-${project.id ?? i}`,
            gapBefore: 0,
            node: (
              <div className={`cv-entry${i === 0 ? " first" : ""}`}>
                {project.title && <div className="cv-project-title">{project.title}</div>}
                {meta.length > 0 && <div className="cv-project-meta">{meta.join("  ·  ")}</div>}
                {project.summary && <p className="cv-preline cv-entry-text">{flowText(project.summary)}</p>}
                {project.skills?.length > 0 && (
                  <div className="cv-chips cv-entry-chips">
                    {project.skills.map((skill) => <span className="cv-chip cv-chip-tech" key={skill}>{skill}</span>)}
                  </div>
                )}
                {project.link && <div className="cv-project-link">{project.link}</div>}
                {i < publishedProjects.length - 1 && <div className="cv-entry-divider" />}
              </div>
            ),
          };
        }),
      });
      index++;
    }
    return out;
  }, [bio, skills, experiences, education, certifications, languages, hourlyRate, projectTypes, workPreference, minimumBudget, publishedProjects]);

  const [pagination, setPagination] = useState<{
    pages: Array<Array<{ key: string; node: React.ReactNode; gap: number }>>;
  } | null>(null);
  const [scale, setScale] = useState(1);

  const measureRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const renderHeader = () => (
    <header className="cv-page-header">
      <div className={`cv-head-row${avatar ? " has-photo" : ""}`}>
        {avatar && <img className="cv-head-photo" src={avatar} alt="" />}
        <div className="cv-head-col">
          <div className="cv-head-name">{fullName || "Prénom Nom"}</div>
          {title && <div className="cv-head-title">{title}</div>}
          {(phone || email || location) && (
            <div className="cv-head-contacts">{[phone, email, location].filter(Boolean).join("   •   ")}</div>
          )}
          {(linkedin || github || website) && (
            <div className="cv-head-links">{[linkedin, github, website].filter(Boolean).join("   •   ")}</div>
          )}
        </div>
      </div>
      <div className="cv-head-rule" />
    </header>
  );

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => setScale(Math.min(1, host.clientWidth / PAGE_WIDTH_PX));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, [pagination]);

  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    let cancelled = false;

    const measure = () => {
      if (cancelled) return;
      const headerEl = root.querySelector('[data-measure="__header"]') as HTMLElement | null;
      const footerEl = root.querySelector('[data-measure="__footer"]') as HTMLElement | null;
      const headerH = headerEl?.getBoundingClientRect().height ?? 0;
      const footerH = footerEl?.getBoundingClientRect().height ?? 0;
      const pageInnerPx = (PAGE_HEIGHT_PT - PAGE_MARGIN_PT * 2) * PT_TO_PX;
      const contentH = pageInnerPx - headerH - footerH - CONTENT_TOP_PADDING_PT * PT_TO_PX;

      const heights = new Map<string, number>();
      root.querySelectorAll("[data-measure]").forEach((el) => {
        const key = el.getAttribute("data-measure");
        if (key) heights.set(key, (el as HTMLElement).getBoundingClientRect().height);
      });

      const measuredSections = sections.map((section) => ({
        ...section,
        headingHeight: heights.get(`heading-${section.key}`) ?? 0,
        atoms: section.atoms.map((atom) => ({ ...atom, height: heights.get(atom.key) ?? 0 })),
      }));

      const pages: Array<Array<{ key: string; node: React.ReactNode; gap: number }>> = [[]];
      let used = 0;
      const place = (key: string, node: React.ReactNode, height: number, gap: number) => {
        const g = used === 0 ? 0 : gap;
        if (used > 0 && used + g + height > contentH) {
          pages.push([]);
          used = 0;
        }
        const actualGap = used === 0 ? 0 : gap;
        pages[pages.length - 1].push({ key, node, gap: actualGap });
        used += actualGap + height;
      };

      for (let si = 0; si < measuredSections.length; si++) {
        const section = measuredSections[si];
        const headingGap = si === 0 ? 0 : SECTION_GAP_PX;
        const firstAtomH = section.atoms[0]?.height ?? 0;

        if (used > 0 && contentH - used < ENSURE_SPACE_PX) {
          pages.push([]);
          used = 0;
        }
        if (used > 0) {
          const needed = headingGap + (section.headingHeight ?? 0) + firstAtomH;
          if (used + needed > contentH && contentH - used >= headingGap + (section.headingHeight ?? 0)) {
            pages.push([]);
            used = 0;
          }
        }
        place(`heading-${section.key}`, <div className="cv-heading"><div className="cv-section-title">{section.heading}</div><div className="cv-section-rule" /></div>, section.headingHeight ?? 0, headingGap);
        for (const atom of section.atoms) {
          place(atom.key, atom.node, atom.height ?? 0, 0);
        }
      }

      if (!cancelled) setPagination({ pages });
    };

    measure();
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) measure();
      });
    }
    return () => {
      cancelled = true;
    };
  }, [sections]);

  const renderFooter = (pageIndex: number, total: number) => (
    <div className="cv-page-footer">
      CV généré depuis FreelanceTN  ·  page {pageIndex + 1} / {total}
    </div>
  );

  if (!pagination) {
    return (
      <div className="cv-preview">
        <div className="cv-preview-skeleton">Chargement de l’aperçu…</div>
        <div ref={measureRef} className="cv-preview-measure" aria-hidden="true">
          <div data-measure="__header">{renderHeader()}</div>
          <div data-measure="__footer" className="cv-page-footer">
            CV généré depuis FreelanceTN  ·  page 1 / 1
          </div>
          {sections.map((s) => (
            <div key={s.key}>
              <div data-measure={`heading-${s.key}`} className="cv-heading">
                <div className="cv-section-title">{s.heading}</div>
                <div className="cv-section-rule" />
              </div>
              {s.atoms.map((a) => (
                <div key={a.key} data-measure={a.key}>{a.node}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="cv-preview">
      <div className="cv-preview-pages" ref={hostRef}>
        {pagination.pages.map((page, pageIndex) => (
          <div
            key={pageIndex}
            className="cv-preview-frame"
            style={{ width: `${PAGE_WIDTH_PX * scale}px`, height: `${PAGE_HEIGHT_PX * scale}px` }}
          >
            <div className="cv-page" style={scale !== 1 ? { transform: `scale(${scale})` } : undefined}>
              {renderHeader()}
              <div className="cv-page-content">
                {page.map((item) => (
                  <div key={item.key} className="cv-preview-atom" style={{ marginTop: `${item.gap}px` }}>
                    {item.node}
                  </div>
                ))}
              </div>
              {renderFooter(pageIndex, pagination.pages.length)}
            </div>
          </div>
        ))}
      </div>
      <div ref={measureRef} className="cv-preview-measure" aria-hidden="true">
        <div data-measure="__header">{renderHeader()}</div>
        <div data-measure="__footer" className="cv-page-footer">
          CV généré depuis FreelanceTN  ·  page 1 / 1
        </div>
        {sections.map((s) => (
          <div key={s.key}>
            <div data-measure={`heading-${s.key}`} className="cv-heading">
              <div className="cv-section-title">{s.heading}</div>
              <div className="cv-section-rule" />
            </div>
            {s.atoms.map((a) => (
              <div key={a.key} data-measure={a.key}>{a.node}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
