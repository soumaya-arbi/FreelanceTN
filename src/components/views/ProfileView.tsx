"use client";
import React, { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Stars } from "@/components/ui/Stars";
import { AvatarBadge } from "@/components/views/account/AvatarBadge";
import { criterionLabel, feedbackAuthor } from "@/lib/feedback";
import { formatReviewDate } from "@/lib/format";
import type { Feedback, FeedbackSummary, Freelancer, Page, PortfolioItem } from "@/lib/types";

const isHttpLink = (value: string) => /^https?:\/\//i.test(value);

function Profile({ go, notify, invite, freelancer, feedback = [], summary = null, loading = false, error = "", feedbackLoading = false, feedbackError = "", portfolio = [], portfolioLoading = false, portfolioError = "" }: { go: (p: Page) => void; notify: (s: string) => void; invite: (name: string) => void; freelancer?: Freelancer; feedback?: Feedback[]; summary?: FeedbackSummary | null; loading?: boolean; error?: string; feedbackLoading?: boolean; feedbackError?: string; portfolio?: PortfolioItem[]; portfolioLoading?: boolean; portfolioError?: string }) {
  const [tab, setTab] = useState("Overview");
  void notify;
  const f = freelancer;
  // Aucun profil n'est inventé : sans profil réel, la page affiche un état vide.
  if (loading) {
    return <main className="profile-page"><div className="profile-cover" /><div className="container"><div className="empty-state" style={{ margin: "60px auto" }}><span><Icon name="clock" size={20} /></span><b>Loading profile…</b><p>Fetching this professional&apos;s public profile.</p></div></div></main>;
  }
  if (!f) {
    return <main className="profile-page"><div className="profile-cover" /><div className="container"><div className="empty-state" style={{ margin: "60px auto" }}><span><Icon name="users" size={20} /></span><b>This profile is not available</b><p>{error || "No public freelancer profile exists for this address yet. Profiles appear here once a professional publishes one from their own workspace."}</p><Button onClick={() => go("freelancers")}>Browse talent</Button></div></div></main>;
  }
  const coverStyle = f.coverImage ? { backgroundImage: `url(${f.coverImage})`, backgroundSize: "cover" as const, backgroundPosition: "center" } : undefined;
  // Réputation calculée côté API à partir des seuls avis publiés : les avis
  // masqués et les demandes non soumises n'apparaissent jamais ici.
  const publishedCount = summary?.count ?? feedback.length;
  const publishedAverage = summary?.averageRating ?? f.rating;
  return <main className="profile-page"><div className="profile-cover" style={coverStyle} /><div className="container profile-grid"><section className="profile-main">
    <div className="profile-header"><AvatarBadge url={f.avatar || undefined} firstName={f.name.split(" ")[0]} lastName={f.name.split(" ").slice(1).join(" ")} size={100} source={f.avatarSource} avatarConfig={f.avatarConfig} /><div><div className="profile-name"><h1>{f.name}</h1><span className="verified"><Icon name="check" size={13} /></span></div><h2>{f.role}</h2>{f.location && <p>{f.location}</p>}<div className="profile-stats"><span><Icon name="star" size={16} />{feedbackLoading ? <b>Loading reviews…</b> : feedbackError ? <b>Reviews unavailable</b> : publishedCount > 0 ? <><b>{publishedAverage.toFixed(1)}</b> ({publishedCount} review{publishedCount > 1 ? "s" : ""})</> : <b>No rating yet</b>}</span></div></div></div>
    <div className="profile-tabs">{["Overview", "Portfolio", "Reviews"].map(x => <button onClick={() => setTab(x)} className={tab === x ? "active" : ""} key={x}>{x}</button>)}</div>
    {tab === "Overview" && <><article className="content-card"><h3>About me</h3>{f.bio ? <p className="long-copy">{f.bio}</p> : <p className="task-empty">No biography has been provided yet.</p>}</article><article className="content-card"><h3>Skills &amp; expertise</h3>{f.skills.length > 0 ? <div className="chips large">{f.skills.map(s => <span key={s}>{s}</span>)}</div> : <p className="task-empty">No skills listed yet.</p>}</article></>}
    {tab === "Portfolio" && <article className="content-card"><div className="card-heading"><h3>Selected work</h3></div>{portfolioLoading ? <p className="task-empty">Loading portfolio…</p> : portfolioError ? <p className="task-empty">{portfolioError}</p> : portfolio.length === 0 ? <p className="task-empty">No portfolio items published yet.</p> : <div className="portfolio-grid">{portfolio.map((item) => <article className="portfolio-item" key={item.id}>{item.image ? <img src={item.image} alt={item.title} /> : <div className="portfolio-cover-fallback"><Icon name="portfolio" /></div>}<div className="portfolio-item-body">{item.category && <span className="status">{item.category}</span>}<h3>{item.title}</h3><p>{item.summary}</p>{item.skills.length > 0 && <div className="chips">{item.skills.slice(0, 4).map((skill) => <span key={skill}>{skill}</span>)}</div>}{item.link && isHttpLink(item.link) && <a className="text-btn" href={item.link} target="_blank" rel="noopener noreferrer">View project <Icon name="arrow" size={13} /></a>}</div></article>)}</div>}</article>}
    {tab === "Reviews" && <article className="content-card">
      <div className="card-heading"><h3>Client reviews</h3>{publishedCount > 0 && <small>{publishedAverage.toFixed(1)} / 5 · {publishedCount} review{publishedCount > 1 ? "s" : ""}</small>}</div>
      {feedbackLoading ? <p className="task-empty">Loading reviews…</p> : feedbackError ? <p className="task-empty">{feedbackError}</p> : publishedCount === 0 ? <p className="task-empty">No published review yet. Reviews appear here once both participants have submitted, or after the 14-day review window.</p> : <>
        <div className="feedback-layout" style={{ gridTemplateColumns: "1fr", marginBottom: 18 }}>
          <section className="feedback-score" style={{ textAlign: "left" }}>
            <div className="rating-large" style={{ justifyContent: "flex-start" }}><Icon name="star" /><b>{publishedAverage.toFixed(1)}</b></div>
            <small>Average across {publishedCount} published review{publishedCount > 1 ? "s" : ""}</small>
            {(summary?.distribution ?? []).map(({ stars, count }) => (
              <div className="rating-bar" key={stars}>
                <span>{stars} star</span>
                <div><i style={{ width: `${publishedCount > 0 ? (count / publishedCount) * 100 : 0}%` }} /></div>
                <b>{count}</b>
              </div>
            ))}
            {summary && summary.criteriaReviewCount > 0 && (
              <div className="feedback-criteria-summary">
                {Object.entries(summary.criteriaAverages).map(([key, value]) => (
                  <div key={key}><span>{criterionLabel(key)}</span><b>{value.toFixed(2)} / 5</b></div>
                ))}
              </div>
            )}
            {summary?.recommendationRate !== null && summary?.recommendationRate !== undefined && (
              <small>{summary.recommendationRate}% of clients recommend this freelancer</small>
            )}
          </section>
        </div>
        <div className="feedback-list">{feedback.map(item => <article className="dash-card feedback-card" key={item.id}><header><div><b>{feedbackAuthor(item)}</b><small>{formatReviewDate(item.publishedAt || item.createdAt)}</small></div><Stars rating={item.rating || Math.round(item.averageRating ?? 0)} /></header>{item.comment && <p>{item.comment}</p>}{item.strengths && <p><b>Strengths:</b> {item.strengths}</p>}{item.improvements && <p><b>To improve:</b> {item.improvements}</p>}<footer><span><Icon name="briefcase" size={13} /> {item.projectTitle || "Completed project"}</span>{item.recommend === true && <span>Recommended</span>}{item.recommend === false && <span>Not recommended</span>}</footer></article>)}</div>
      </>}
    </article>}
  </section><aside className="hire-card"><div className="rate"><span>Hourly rate</span><strong>{f.rate} TND<small>/hr</small></strong></div><Button onClick={() => invite(f.name)}>Invite to a project</Button><hr /><div className="hire-detail"><span><Icon name="globe" /> Location</span><b>{f.location || "Not provided"}</b></div></aside></div></main>;
}

export { Profile };
