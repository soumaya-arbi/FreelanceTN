"use client";

import { useRouter } from "next/navigation";
import { notFound } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { ModuleShell } from "@/components/modules/ModuleShell";
import { useMarketplace } from "@/context/MarketplaceContext";

export function PortfolioPreview({ id }: { id: string }) {
  const router = useRouter();
  const { portfolio, portfolioLoading, portfolioError, refreshPortfolio } = useMarketplace();
  const item = portfolio.find((entry) => entry.id === id);

  if (!item && portfolioLoading) {
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

  if (!item && portfolioError) {
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

  if (!item) notFound();

  return (
    <ModuleShell role="freelancer" page="portfolio">
      <main className="workspace module-page">
        <div className="workspace-title">
          <div>
            <p>{item.category.toUpperCase()}</p>
            <h1>{item.title}</h1>
            <span>{item.summary}</span>
          </div>
          <div className="doc-actions">
            <Button variant="secondary" onClick={() => router.push("/freelancer/portfolio")}>All items</Button>
            <Button icon="check" onClick={() => router.push(`/freelancer/portfolio/${item.id}/edit`)}>Edit item</Button>
          </div>
        </div>

        {item.image ? (
          <img className="portfolio-hero" src={item.image} alt={item.title} />
        ) : (
          <div className="portfolio-cover-fallback portfolio-hero"><Icon name="portfolio" /></div>
        )}

        <div className="module-summary">
          <article><span><Icon name="users" /></span><b>{item.role || "Not specified"}</b><small>Your role</small></article>
          <article><span><Icon name="clock" /></span><b>{item.duration || "Not specified"}</b><small>Duration</small></article>
          <article><span><Icon name="globe" /></span><b>{item.visibility}</b><small>Visibility</small></article>
          <article><span><Icon name="file" /></span><b>{item.published ? "Published" : "Draft"}</b><small>Status</small></article>
        </div>

        <div className="portfolio-story">
          <article className="dash-card">
            <h2>The challenge</h2>
            <p>{item.challenge || "No challenge documented yet."}</p>
          </article>
          <article className="dash-card">
            <h2>The solution</h2>
            <p>{item.solution || "No solution documented yet."}</p>
          </article>
          <article className="dash-card">
            <h2>The outcome</h2>
            <p>{item.outcome || "No outcome documented yet."}</p>
          </article>
        </div>

        <div className="dash-card portfolio-meta">
          <h3>Skills</h3>
          <div className="chips">{item.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>
          {item.link && (
            <a className="text-btn" href={item.link} target="_blank" rel="noopener noreferrer">
              {item.link}
            </a>
          )}
        </div>
      </main>
    </ModuleShell>
  );
}
