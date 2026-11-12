"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClientShell } from "@/components/layout/ClientShell";
import { AvatarBadge } from "@/components/views/account/AvatarBadge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useApp } from "@/context/AppContext";
import { accountApi, feedbacksApi, type ClientProfile } from "@/lib/api";
import { criterionLabel, feedbackAuthor } from "@/lib/feedback";
import { formatReviewDate } from "@/lib/format";
import { Stars } from "@/components/ui/Stars";
import type { FeedbackSummary } from "@/lib/types";

export default function ClientProfilePage() {
  const router = useRouter();
  const { go, notify } = useApp();
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    accountApi
      .getProfile()
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        // Réputation du client : uniquement les avis publiés reçus.
        setSummaryLoading(true);
        setSummaryError("");
        feedbacksApi
          .summary(data.id)
          .then((value) => {
            if (!cancelled) setSummary(value);
          })
          .catch((err: unknown) => {
            if (!cancelled) {
              setSummary(null);
              setSummaryError(err instanceof Error ? err.message : "Reviews could not be loaded.");
            }
          })
          .finally(() => {
            if (!cancelled) setSummaryLoading(false);
          });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load your profile.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const name = profile ? `${profile.firstName} ${profile.lastName}`.trim() || profile.email : "";
  const location = profile ? [profile.city, profile.governorate, profile.country].filter(Boolean).join(", ") : "";
  const coverStyle = profile?.coverImage
    ? { backgroundImage: `url(${profile.coverImage})`, backgroundSize: "cover" as const, backgroundPosition: "center" }
    : undefined;

  return (
    <ClientShell page="client" go={go} notify={notify}>
      <main className="workspace">
        <div className="workspace-title">
          <div>
            <p>CLIENT WORKSPACE</p>
            <h1>My profile</h1>
            <span>View your public and account profile information.</span>
          </div>
          <Button variant="secondary" onClick={() => router.push("/client/settings")}>Edit in settings</Button>
        </div>

        {loading && <p className="task-empty" role="status">Loading your profile…</p>}
        {!loading && error && <p className="form-error" role="alert">{error}</p>}
        {!loading && !error && profile && (
          <section className="profile-page" style={{ paddingTop: 0 }}>
            <div className="profile-cover" style={coverStyle} />
            <div className="profile-grid" style={{ marginTop: 0 }}>
              <section className="profile-main">
                <div className="profile-header">
                  <AvatarBadge
                    url={profile.avatar || undefined}
                    firstName={profile.firstName}
                    lastName={profile.lastName}
                    preset={profile.avatarPreset}
                    color={profile.avatarColor}
                    size={100}
                    source={profile.avatarSource}
                    avatarConfig={profile.avatarConfig}
                  />
                  <div>
                    <div className="profile-name">
                      <h1>{name}</h1>
                      {profile.emailVerified && <span className="verified"><Icon name="check" size={13} /></span>}
                    </div>
                    <h2>{profile.position || profile.companyName || "Client"}</h2>
                    {location && <p>{location}</p>}
                    <div className="profile-stats">
                      <span>Profile completion <b>{profile.profileCompletion}%</b></span>
                    </div>
                  </div>
                </div>

                <article className="content-card">
                  <h3>About</h3>
                  {profile.personalPresentation || profile.bio || profile.companyDescription ? (
                    <p className="long-copy">{profile.personalPresentation || profile.bio || profile.companyDescription}</p>
                  ) : (
                    <p className="task-empty">No profile description provided yet.</p>
                  )}
                </article>

                {(profile.companyName || profile.industry || profile.companyWebsite || profile.website) && (
                  <article className="content-card">
                    <h3>Company & links</h3>
                    <div className="chips large">
                      {profile.companyName && <span>{profile.companyName}</span>}
                      {profile.industry && <span>{profile.industry}</span>}
                      {profile.companySize && <span>{profile.companySize}</span>}
                    </div>
                    {(profile.companyWebsite || profile.website) && (
                      <p style={{ marginTop: 12 }}>
                        {profile.companyWebsite && <><b>Company website:</b> {profile.companyWebsite}<br /></>}
                        {profile.website && <><b>Website:</b> {profile.website}</>}
                      </p>
                    )}
                  </article>
                )}

                <article className="content-card">
                  <div className="card-heading">
                    <h3>Reviews received</h3>
                    {summary && summary.count > 0 && (
                      <small>{summary.averageRating.toFixed(1)} / 5 · {summary.count} review{summary.count > 1 ? "s" : ""}</small>
                    )}
                  </div>
                  {summaryLoading ? (
                    <p className="task-empty">Loading reviews…</p>
                  ) : summaryError ? (
                    <p className="task-empty">{summaryError}</p>
                  ) : !summary || summary.count === 0 ? (
                    <p className="task-empty">
                      No published review yet. Freelancers can review you once a project is completed, and the review
                      becomes public after both sides submit or after 14 days.
                    </p>
                  ) : (
                    <>
                      <div className="rating-large"><Icon name="star" /><b>{summary.averageRating.toFixed(1)}</b></div>
                      {summary.distribution.map(({ stars, count }) => (
                        <div className="rating-bar" key={stars}>
                          <span>{stars} star</span>
                          <div><i style={{ width: `${summary.count > 0 ? (count / summary.count) * 100 : 0}%` }} /></div>
                          <b>{count}</b>
                        </div>
                      ))}
                      {summary.criteriaReviewCount > 0 && (
                        <div className="feedback-criteria-summary">
                          {Object.entries(summary.criteriaAverages).map(([key, value]) => (
                            <div key={key}><span>{criterionLabel(key)}</span><b>{value.toFixed(2)} / 5</b></div>
                          ))}
                        </div>
                      )}
                      <div className="feedback-list" style={{ marginTop: 14 }}>
                        {summary.reviews.map((item) => (
                          <article className="dash-card feedback-card" key={item.id}>
                            <header>
                              <div>
                                <b>{feedbackAuthor(item)}</b>
                                <small>{formatReviewDate(item.publishedAt || item.createdAt)}</small>
                              </div>
                              <Stars rating={item.rating || Math.round(item.averageRating ?? 0)} />
                            </header>
                            {item.comment && <p>{item.comment}</p>}
                            {item.strengths && <p><b>Positive points:</b> {item.strengths}</p>}
                            {item.improvements && <p><b>To improve:</b> {item.improvements}</p>}
                            <footer>
                              <span><Icon name="briefcase" size={13} /> {item.projectTitle || "Completed project"}</span>
                            </footer>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                </article>
              </section>

              <aside className="hire-card">
                <div className="rate"><span>Account</span><strong>{profile.role}</strong></div>
                <Button variant="secondary" onClick={() => router.push("/client/settings")}>Manage settings</Button>
                <hr />
                <div className="hire-detail"><span><Icon name="globe" /> Email</span><b>{profile.email}</b></div>
                {profile.phone && <div className="hire-detail"><span><Icon name="message" /> Phone</span><b>{profile.phone}</b></div>}
                {location && <div className="hire-detail"><span><Icon name="globe" /> Location</span><b>{location}</b></div>}
              </aside>
            </div>
          </section>
        )}
      </main>
    </ClientShell>
  );
}
