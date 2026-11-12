"use client";
import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { AvatarBadge } from "@/components/views/account/AvatarBadge";
import type { Freelancer, Page, Project } from "@/lib/types";
import { freelancersApi, projectsApi } from "@/lib/api";
import { useMarketplace } from "@/context/MarketplaceContext";
import { TUNISIA_GOVERNORATES } from "@/lib/locations";
import { applyTalentFilters, buildProjectCatalogParams } from "@/lib/directoryFilters";

const PAGE_SIZE = 4;
const TALENT_SORTS = ["Most relevant", "Rate: low to high", "Rate: high to low", "Name A–Z"];
const PROJECT_TYPES = ["Fixed price", "Hourly", "Milestone-based"];

function Directory({
  kind,
  go,
  notify,
  openProject,
  openFreelancer,
  projectItems,
}: {
  kind: "freelancers" | "projects";
  go: (p: Page) => void;
  notify: (s: string) => void;
  openProject?: (project: Project) => void;
  openFreelancer?: (f: Freelancer) => void;
  projectItems?: Project[];
}) {
  const [typedQuery, setTypedQuery] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("");
  const urlQuery = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("q") ?? "",
    () => "",
  );
  const query = typedQuery ?? urlQuery;
  const [grid, setGrid] = useState(true);
  const [pageNumber, setPageNumber] = useState(1);
  const [sort, setSort] = useState("Most relevant");

  // Filtres Talent : compétences (champ texte + chips), gouvernorat, tarif.
  const [minRate, setMinRate] = useState("");
  const [maxRate, setMaxRate] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [skillFocused, setSkillFocused] = useState(false);
  const [locationFilter, setLocationFilter] = useState("");

  // Filtres Find Work : tous transmis au catalogue serveur.
  const [projectType, setProjectType] = useState("");
  const [minBudget, setMinBudget] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [durationValue, setDurationValue] = useState("");
  const [durationUnit, setDurationUnit] = useState("");

  const { catalogProjects, catalogLoading, catalogError, setCatalogSearch } = useMarketplace();

  // L'annuaire des freelances provient des comptes réels de l'API.
  const [liveFreelancers, setLiveFreelancers] = useState<Freelancer[] | null>(null);
  const [freelancersLoading, setFreelancersLoading] = useState(false);
  const [freelancersError, setFreelancersError] = useState("");
  useEffect(() => {
    if (kind !== "freelancers") return;
    let cancelled = false;
    setFreelancersLoading(true);
    setFreelancersError("");
    freelancersApi
      .list()
      .then((items) => {
        if (cancelled) return;
        setLiveFreelancers(
          items.map((item) => ({
            id: item.id,
            name: item.name || "Freelancer",
            role: item.title || "Freelancer",
            rate: item.hourlyRate,
            rating: 0,
            jobs: 0,
            location: item.location,
            avatar: item.avatar,
            avatarSource: item.avatarSource,
            avatarConfig: item.avatarConfig,
            coverImage: item.coverImage ?? "",
            skills: item.skills,
          })),
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFreelancersError(error instanceof Error ? error.message : "Freelancers could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setFreelancersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  // Catégories réellement présentes dans le catalogue (API), pas de liste fictive.
  const [catalogCategories, setCatalogCategories] = useState<string[]>([]);
  useEffect(() => {
    if (kind !== "projects") return;
    let cancelled = false;
    projectsApi
      .catalogCategories()
      .then((rows) => {
        if (!cancelled) setCatalogCategories(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setCatalogCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  // Sans prop explicite, la liste des projets provient du catalogue public.
  const projectList = projectItems ?? catalogProjects;

  // Tous les filtres projet sont construits puis transmis à l'API : le filtrage
  // est réellement effectué côté serveur, pas simulé sur la page courante.
  const catalogParams = useMemo(
    () => buildProjectCatalogParams({ query, category: activeCategory, type: projectType, minBudget, maxBudget, durationValue, durationUnit }),
    [query, activeCategory, projectType, minBudget, maxBudget, durationValue, durationUnit],
  );
  useEffect(() => {
    if (kind !== "projects") return;
    setCatalogSearch(catalogParams);
    setPageNumber(1);
  }, [catalogParams, kind, setCatalogSearch]);

  const titles = {
    freelancers: ["Discover exceptional talent", "Search verified experts by skill, experience, and availability."],
    projects: ["Find work that moves you forward", "Explore quality projects from verified clients around the world."],
  } as const;

  const clearAll = () => {
    setTypedQuery("");
    setActiveCategory("");
    setSort("Most relevant");
    setPageNumber(1);
    setMinRate("");
    setMaxRate("");
    setSelectedSkills([]);
    setSkillInput("");
    setSkillFocused(false);
    setLocationFilter("");
    setProjectType("");
    setMinBudget("");
    setMaxBudget("");
    setDurationValue("");
    setDurationUnit("");
    if (kind === "projects") {
      setCatalogSearch({ q: "", category: "", type: "", minBudget: undefined, maxBudget: undefined, durationValue: undefined, durationUnit: "" });
    }
    notify("All filters cleared");
  };

  // Compétences réelles des profils, triées par fréquence d'apparition.
  const skillCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (liveFreelancers ?? []).forEach((freelancer) => {
      freelancer.skills.forEach((skill) => counts.set(skill, (counts.get(skill) ?? 0) + 1));
    });
    return counts;
  }, [liveFreelancers]);
  const skillOptions = useMemo(
    () => [...skillCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([skill]) => skill),
    [skillCounts],
  );
  const skillSuggestions = useMemo(() => {
    const needle = skillInput.trim().toLowerCase();
    return skillOptions
      .filter((skill) => !selectedSkills.some((selected) => selected.toLowerCase() === skill.toLowerCase()))
      .filter((skill) => !needle || skill.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [skillInput, skillOptions, selectedSkills]);

  const addSkill = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSelectedSkills((current) =>
      current.some((item) => item.toLowerCase() === trimmed.toLowerCase()) ? current : [...current, trimmed],
    );
    setSkillInput("");
    setPageNumber(1);
  };
  const removeSkill = (skill: string) => {
    setSelectedSkills((current) => current.filter((item) => item !== skill));
    setPageNumber(1);
  };
  const onSkillKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addSkill(skillSuggestions[0] ?? skillInput);
    } else if (event.key === "Backspace" && !skillInput && selectedSkills.length > 0) {
      removeSkill(selectedSkills[selectedSkills.length - 1]);
    } else if (event.key === "Escape") {
      setSkillInput("");
      setSkillFocused(false);
    }
  };

  const categoryOptions = useMemo(() => {
    const values = new Set<string>(catalogCategories);
    if (activeCategory) values.add(activeCategory);
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [catalogCategories, activeCategory]);

  const matchedFreelancers = useMemo(
    () => applyTalentFilters(liveFreelancers ?? [], { query, skills: selectedSkills, location: locationFilter, minRate, maxRate, sort }),
    [liveFreelancers, query, sort, minRate, maxRate, selectedSkills, locationFilter],
  );
  // Le catalogue projet est déjà filtré par le serveur : il ne reste que le tri.
  const matchedProjects = useMemo(() => {
    if (sort === "Highest rated") return [...projectList].sort((a, b) => b.proposals - a.proposals);
    return projectList;
  }, [sort, projectList]);

  const hasTalentFilters = Boolean(query.trim() || selectedSkills.length > 0 || minRate.trim() || maxRate.trim() || locationFilter);
  const hasProjectFilters = Boolean(query.trim() || activeCategory || projectType || minBudget.trim() || maxBudget.trim() || durationValue.trim() || durationUnit);
  const total = kind === "freelancers" ? matchedFreelancers.length : matchedProjects.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageNumber, pageCount);
  const slice = <T,>(list: T[]) => list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return <main className="directory-page">
    <div className="directory-hero"><div className="container"><span className="overline">{kind === "projects" ? "OPPORTUNITIES" : "DISCOVER"}</span><h1>{titles[kind][0]}</h1><p>{titles[kind][1]}</p><div className="directory-search"><Icon name="search" /><input value={query} onChange={e => { setTypedQuery(e.target.value); setPageNumber(1); }} placeholder={`Search ${kind}, skills, or keywords`} /><Button onClick={() => notify(query ? `Showing results for “${query}”` : "Showing all results")}>Search</Button></div></div></div>
    <div className="container directory-layout">
      <aside className="filters talent-filters">
        <div className="filter-title"><strong>Filters</strong><button onClick={clearAll}>Clear all</button></div>

        {kind === "freelancers" && <>
          <div className="filter-group talent-skill-filter">
            <div className="filter-group-head"><span>Skills</span>{selectedSkills.length > 0 && <small>{selectedSkills.length} selected</small>}</div>
            {selectedSkills.length > 0 && <div className="talent-skill-chips">{selectedSkills.map((skill) => <span className="talent-skill-chip" key={skill}>{skill}<button type="button" onClick={() => removeSkill(skill)} aria-label={`Remove ${skill}`}><Icon name="close" size={11} /></button></span>)}</div>}
            <div className="talent-skill-input-wrap">
              <Icon name="search" size={14} />
              <input
                value={skillInput}
                onChange={(e) => { setSkillInput(e.target.value); setSkillFocused(true); }}
                onFocus={() => setSkillFocused(true)}
                onBlur={() => window.setTimeout(() => setSkillFocused(false), 120)}
                onKeyDown={onSkillKeyDown}
                placeholder="Type a skill, e.g. React"
                aria-label="Search skills"
                autoComplete="off"
              />
            </div>
            {skillFocused && (skillSuggestions.length > 0 || skillInput.trim()) && (
              <div className="talent-skill-suggestions" role="listbox" aria-label="Skill suggestions">
                {skillSuggestions.length === 0
                  ? <p className="filter-hint">No matching skill in published profiles.</p>
                  : skillSuggestions.map((skill) => <button type="button" key={skill} role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => addSkill(skill)}><span>{skill}</span><small>{skillCounts.get(skill) ?? 0}</small></button>)}
              </div>
            )}
          </div>
          <div className="filter-group">
            <div className="filter-group-head"><span>Hourly rate</span><small>TND / hr</small></div>
            <div className="filter-range"><input type="number" min="0" placeholder="Min" value={minRate} onChange={(e) => { setMinRate(e.target.value); setPageNumber(1); }} aria-label="Minimum hourly rate" /><span>–</span><input type="number" min="0" placeholder="Max" value={maxRate} onChange={(e) => { setMaxRate(e.target.value); setPageNumber(1); }} aria-label="Maximum hourly rate" /></div>
          </div>
          <div className="filter-group">
            <label className="filter-group-head" htmlFor="talent-location"><span>Location</span></label>
            <select id="talent-location" className="filter-select" value={locationFilter} onChange={(e) => { setLocationFilter(e.target.value); setPageNumber(1); }}>
              <option value="">Any location</option>
              {TUNISIA_GOVERNORATES.map((governorate) => <option key={governorate} value={governorate}>{governorate}</option>)}
            </select>
          </div>
        </>}

        {kind === "projects" && <>
          <div className="filter-group">
            <label className="filter-group-head" htmlFor="catalog-category"><span>Category</span></label>
            <select id="catalog-category" className="filter-select" value={activeCategory} onChange={(e) => { setActiveCategory(e.target.value); setPageNumber(1); }}>
              <option value="">All categories</option>
              {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label className="filter-group-head" htmlFor="catalog-type"><span>Project type</span></label>
            <select id="catalog-type" className="filter-select" value={projectType} onChange={(e) => { setProjectType(e.target.value); setPageNumber(1); }}>
              <option value="">Any type</option>
              {PROJECT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <div className="filter-group-head"><span>Budget</span><small>TND</small></div>
            <div className="filter-range"><input type="number" min="0" placeholder="Min" value={minBudget} onChange={(e) => { setMinBudget(e.target.value); setPageNumber(1); }} aria-label="Minimum budget" /><span>–</span><input type="number" min="0" placeholder="Max" value={maxBudget} onChange={(e) => { setMaxBudget(e.target.value); setPageNumber(1); }} aria-label="Maximum budget" /></div>
          </div>
          <div className="filter-group">
            <div className="filter-group-head"><span>Duration</span><small>Maximum</small></div>
            <div className="filter-range duration-range">
              <input type="number" min="1" placeholder="e.g. 2" value={durationValue} onChange={(e) => { setDurationValue(e.target.value); setPageNumber(1); }} aria-label="Maximum duration value" />
              <select className="filter-select" aria-label="Duration unit" value={durationUnit} onChange={(e) => { setDurationUnit(e.target.value); setPageNumber(1); }}>
                <option value="">Any unit</option>
                <option value="Days">Days</option>
                <option value="Weeks">Weeks</option>
                <option value="Months">Months</option>
              </select>
            </div>
          </div>
          <button className="filter-reset" onClick={clearAll} disabled={!hasProjectFilters}>Reset filters</button>
        </>}
      </aside>

      <section className="results">
        <div className="results-head"><div><strong>{total} results</strong><span>Best matches for you</span></div><div className="sort"><select aria-label="Sort results" value={sort} onChange={e => { setSort(e.target.value); setPageNumber(1); }}>{kind === "freelancers" ? TALENT_SORTS.map((option) => <option key={option}>{option}</option>) : <><option>Most relevant</option><option>Highest rated</option></>}</select><button className={grid ? "active" : ""} onClick={() => setGrid(true)}><Icon name="dashboard" /></button><button className={!grid ? "active" : ""} onClick={() => setGrid(false)}><Icon name="menu" /></button></div></div>
        {kind === "freelancers" && <div className={grid ? "talent-grid directory-cards" : "talent-grid directory-cards list"}>{slice(matchedFreelancers).map(f => <article className="talent-card" key={f.id}><div className="talent-top" style={f.coverImage ? { backgroundImage: `url(${f.coverImage})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}><AvatarBadge url={f.avatar || undefined} firstName={f.name.split(" ")[0]} lastName={f.name.split(" ").slice(1).join(" ")} size={88} source={f.avatarSource} avatarConfig={f.avatarConfig} className="talent-avatar" /><span className="available">Available</span></div><div className="talent-details"><h3>{f.name} <span className="verified"><Icon name="check" size={11} /></span></h3><p>{f.role}</p><div className="meta">{f.jobs > 0 ? <span><Icon name="star" size={14} /><b>{f.rating.toFixed(1)}</b> ({f.jobs})</span> : <span>New on FreelanceTN</span>}{f.location && <span>{f.location}</span>}</div>{f.skills.length > 0 && <div className="chips">{f.skills.slice(0, 5).map(s => <span key={s}>{s}</span>)}</div>}<div className="card-foot">{f.rate > 0 ? <strong>{f.rate} TND<small>/hr</small></strong> : <strong className="rate-on-request">Rate<small> on request</small></strong>}<Button variant="secondary" onClick={() => openFreelancer ? openFreelancer(f) : go("profile")}>View profile</Button></div></div></article>)}
          {freelancersLoading && <div className="empty-state" style={{ gridColumn: "1 / -1" }}><span><Icon name="clock" size={20} /></span><b>Loading freelancers…</b><p>Fetching published profiles from FreelanceTN.</p></div>}
          {!freelancersLoading && freelancersError && <div className="empty-state" style={{ gridColumn: "1 / -1" }}><span><Icon name="shield" size={20} /></span><b>Freelancers could not be loaded</b><p>{freelancersError}</p></div>}
          {!freelancersLoading && !freelancersError && matchedFreelancers.length === 0 && <div className="empty-state" style={{ gridColumn: "1 / -1" }}><span><Icon name="users" size={20} /></span><b>{hasTalentFilters ? "No freelancer matches these filters" : "No freelancer profiles published yet"}</b><p>{hasTalentFilters ? "Try a different keyword, remove a skill, or widen the hourly rate range." : "Profiles are created by professionals themselves. Nothing is listed here for the moment."}</p>{hasTalentFilters && <Button variant="secondary" onClick={clearAll}>Clear filters</Button>}</div>}
        </div>}
        {kind === "projects" && <div className="project-list">{slice(matchedProjects).map((p) => <article className="project-card" key={p.id}><div><span className="fresh">Posted {p.time}</span><h3>{p.title}</h3><p>{p.description}</p><div className="chips">{p.skills.map(s => <span key={s}>{s}</span>)}</div></div><div className="project-side"><strong>{p.budget}</strong><span>{p.type} · {p.proposals} proposals</span><Button onClick={() => openProject?.(p)}>View project</Button></div></article>)}
          {catalogLoading && <div className="empty-state"><span><Icon name="clock" size={20} /></span><b>Loading projects…</b><p>Fetching published projects from the API.</p></div>}
          {!catalogLoading && catalogError && <div className="empty-state"><span><Icon name="shield" size={20} /></span><b>Projects could not be loaded</b><p>{catalogError}</p></div>}
          {!catalogLoading && !catalogError && matchedProjects.length === 0 && <div className="empty-state"><span><Icon name="briefcase" size={20} /></span><b>{hasProjectFilters ? "No project matches these filters" : "No projects published yet"}</b><p>{hasProjectFilters ? "Try a different keyword, category, type, budget or duration." : "Projects posted by clients appear here as soon as they are published."}</p>{hasProjectFilters && <Button variant="secondary" onClick={clearAll}>Clear filters</Button>}</div>}
        </div>}
        {pageCount > 1 && <div className="pagination"><button disabled={page === 1} onClick={() => setPageNumber(Math.max(1, page - 1))}>Previous</button>{Array.from({ length: pageCount }, (_, i) => i + 1).map(x => <button onClick={() => setPageNumber(x)} className={x === page ? "active" : ""} key={x}>{x}</button>)}<button disabled={page === pageCount} onClick={() => setPageNumber(Math.min(pageCount, page + 1))}>Next</button></div>}
      </section>
    </div>
  </main>;
}

export { Directory };
