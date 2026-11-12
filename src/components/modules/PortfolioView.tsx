"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { ModuleShell } from "@/components/modules/ModuleShell";
import { PortfolioCvEditor } from "@/components/modules/PortfolioCvEditor";
import { useApp } from "@/context/AppContext";
import { useMarketplace } from "@/context/MarketplaceContext";
import { ApiError } from "@/lib/api";

const PAGE_SIZE = 6;

export function PortfolioView({ role = "freelancer" as const }: { role?: "freelancer" }) {
  const router = useRouter();
  const { notify } = useApp();
  const { portfolio, portfolioLoading, portfolioError, refreshPortfolio, deletePortfolioItem } = useMarketplace();
  const [tab, setTab] = useState<"cv" | "work">("cv");
  const [filter, setFilter] = useState("All");
  const [deletingId, setDeletingId] = useState("");
  const [confirmingId, setConfirmingId] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const categories = useMemo(() => ["All", ...new Set(portfolio.map((item) => item.category).filter(Boolean))], [portfolio]);
  const filtered = useMemo(
    () => portfolio.filter((item) => filter === "All" || item.category === filter),
    [portfolio, filter],
  );
  const visible = filtered.slice(0, visibleCount);

  const selectFilter = (category: string) => {
    setFilter(category);
    setVisibleCount(PAGE_SIZE);
    setConfirmingId("");
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      await deletePortfolioItem(id);
      notify("Portfolio item removed");
      setConfirmingId("");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "The portfolio item could not be deleted.");
    } finally {
      setDeletingId("");
    }
  };

  return (
    <ModuleShell role={role} page="portfolio">
      <main className="workspace module-page">
        <div className="workspace-title">
          <div>
            <p>FREELANCER WORKSPACE</p>
            <h1>Portfolio &amp; CV</h1>
            <span>Build your professional CV and showcase the outcomes clients care about.</span>
          </div>
          {tab === "work" && (
            <Button icon="check" onClick={() => router.push("/freelancer/portfolio/new")}>New portfolio item</Button>
          )}
        </div>

        <div className="module-tabs">
          <button type="button" className={tab === "cv" ? "active" : ""} onClick={() => setTab("cv")}>CV</button>
          <button type="button" className={tab === "work" ? "active" : ""} onClick={() => setTab("work")}>Case studies</button>
        </div>

        {/* Les deux panneaux restent montés : changer d'onglet ne perd aucune saisie. */}
        <div className={tab === "cv" ? "module-tab-panel" : "module-tab-panel is-hidden"}>
          <PortfolioCvEditor />
        </div>

        <div className={tab === "work" ? "module-tab-panel" : "module-tab-panel is-hidden"}>
          <div className="module-summary">
            <article><span><Icon name="portfolio" /></span><b>{portfolio.length}</b><small>Portfolio items</small></article>
            <article><span><Icon name="globe" /></span><b>{portfolio.filter((item) => item.published).length}</b><small>Published</small></article>
            <article><span><Icon name="file" /></span><b>{Math.max(0, categories.length - 1)}</b><small>Categories</small></article>
            <article><span><Icon name="users" /></span><b>{portfolio.reduce((sum, item) => sum + item.skills.length, 0)}</b><small>Skills showcased</small></article>
          </div>

          {categories.length > 1 && (
            <div className="module-tabs">
              {categories.map((category) => (
                <button
                  type="button"
                  key={category}
                  className={filter === category ? "active" : ""}
                  onClick={() => selectFilter(category)}
                >
                  {category}
                </button>
              ))}
            </div>
          )}

          <div className="portfolio-manage-grid">
            {portfolioLoading && <p className="task-empty">Loading your portfolio…</p>}

            {!portfolioLoading && portfolioError && (
              <div className="task-empty">
                <p>{portfolioError}</p>
                <Button variant="secondary" onClick={() => { void refreshPortfolio(); }}>Try again</Button>
              </div>
            )}

            {!portfolioLoading && !portfolioError && filtered.length === 0 && (
              <p className="task-empty">
                {portfolio.length === 0
                  ? "No portfolio items yet. Add your first case study to showcase your work."
                  : "No case study matches this category."}
              </p>
            )}

            {!portfolioLoading && !portfolioError && visible.map((item) => (
              <article className="portfolio-item" key={item.id}>
                {item.image ? (
                  <img src={item.image} alt={item.title} />
                ) : (
                  <div className="portfolio-cover-fallback"><Icon name="portfolio" /></div>
                )}
                <div className="portfolio-item-body">
                  <span className={item.published ? "status" : "status paused"}>{item.published ? "Published" : "Draft"}</span>
                  <h3>{item.title}</h3>
                  <p>{item.summary || "No summary yet."}</p>
                  <div className="chips">
                    {item.skills.slice(0, 3).map((skill) => <span key={skill}>{skill}</span>)}
                  </div>
                  <div className="portfolio-item-actions">
                    <button type="button" onClick={() => router.push(`/freelancer/portfolio/${item.id}`)}>Preview <Icon name="arrow" /></button>
                    <button type="button" onClick={() => router.push(`/freelancer/portfolio/${item.id}/edit`)}>Edit</button>
                    {confirmingId === item.id ? (
                      <span className="cv-confirm">
                        <button type="button" className="danger" disabled={deletingId === item.id} onClick={() => { void remove(item.id); }}>
                          {deletingId === item.id ? "Deleting…" : "Confirm"}
                        </button>
                        <button type="button" onClick={() => setConfirmingId("")}>Cancel</button>
                      </span>
                    ) : (
                      <button type="button" className="danger" onClick={() => setConfirmingId(item.id)}>Delete</button>
                    )}
                  </div>
                  <small>{item.visibility}</small>
                </div>
              </article>
            ))}
          </div>

          {!portfolioLoading && !portfolioError && filtered.length > PAGE_SIZE && (
            <div className="cv-more">
              {visibleCount < filtered.length ? (
                <Button variant="secondary" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                  Voir plus ({filtered.length - visibleCount})
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setVisibleCount(PAGE_SIZE)}>Voir moins</Button>
              )}
            </div>
          )}
        </div>
      </main>
    </ModuleShell>
  );
}
