"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AvatarBadge } from "@/components/views/account/AvatarBadge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Stars } from "@/components/ui/Stars";
import { accountApi, feedbacksApi, type PublicClientProfile } from "@/lib/api";
import { criterionLabel, feedbackAuthor } from "@/lib/feedback";
import { formatReviewDate } from "@/lib/format";
import type { FeedbackSummary } from "@/lib/types";

const isHttpLink = (value: string) => /^https?:\/\//i.test(value);

/**
 * Profil public d'un client, consultable par un freelance depuis une invitation.
 *
 * La vue ne consomme que l'action serveur `getPublicClientProfile` (projection
 * publique) et le résumé public des avis publiés. Aucun champ privé (email,
 * téléphone, adresse, facturation) n'est demandé ni affiché.
 */
export function ClientPublicProfile({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [profile, setProfile] = useState<PublicClientProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    accountApi
      .getPublicProfile(clientId)
      .then((value) => {
        if (cancelled) return;
        setProfile(value);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setProfile(null);
        setError(requestError instanceof Error ? requestError.message : "This client profile is not available.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    setSummaryError("");
    // Résumé calculé côté API à partir des seuls avis publiés reçus par ce
    // client : les demandes en attente et les avis masqués sont exclus.
    feedbacksApi
      .summary(clientId)
      .then((value) => {
        if (!cancelled) setSummary(value);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setSummary(null);
          setSummaryError(requestError instanceof Error ? requestError.message : "Reviews could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // Retour à l'écran précédent (liste des invitations) pour conserver son
  // état local ; repli déterministe si la page a été ouverte directement.
  const backToInvitations = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/freelancer/invitations");
  };
  const name = profile ? profile.displayName.trim() || profile.companyName.trim() || "Client" : "";
  const nameParts = name.split(" ").filter(Boolean);
  const firstName = nameParts[0] || "Client";
  const lastName = nameParts.slice(1).join(" ");
  const location = profile ? [profile.city, profile.governorate, profile.country].filter(Boolean).join(", ") : "";
  const coverStyle = profile?.coverImage
    ? { backgroundImage: `url(${profile.coverImage})`, backgroundSize: "cover" as const, backgroundPosition: "center" }
    : undefined;
  const publishedCount = summary?.count ?? 0;
  const publishedAverage = summary?.averageRating ?? 0;

  return (
    <main className="workspace module-page">
      <div className="workspace-title">
        <div>
          <p>CLIENT PROFILE</p>
          <h1>{name || "Client profile"}</h1>
          <span>Public information shared by this client. Private account data is never shown.</span>
        </div>
        <Button variant="secondary" onClick={backToInvitations} icon="arrow">Back to invitations</Button>
      </div>

      {loading && <p className="task-empty" role="status">Loading client profile…</p>}
      {!loading && error && (
        <div className="empty-state" style={{ margin: "40px auto" }}>
          <span><Icon name="users" size={20} /></span>
          <b>This client profile is not available</b>
          <p>{error}</p>
          <Button onClick={backToInvitations}>Back to invitations</Button>
        </div>
      )}

      {!loading && !error && profile && (
        <section className="profile-page" style={{ paddingTop: 0 }}>
          <div className="profile-cover" style={coverStyle} />
          <div className="profile-grid" style={{ marginTop: 0 }}>
            <section className="profile-main">
              <div className="profile-header">
                <AvatarBadge
                  url={profile.avatar || undefined}
                  firstName={firstName}
                  lastName={lastName}
                  size={100}
                  source={profile.avatarSource}
                  avatarConfig={profile.avatarConfig}
                />
                <div>
                  <div className="profile-name">
                    <h1>{name}</h1>
                    {profile.verified && <span className="verified"><Icon name="check" size={13} /></span>}
                  </div>
                  {(profile.position || profile.companyName) && (
                    <h2>{profile.position || profile.companyName}</h2>
                  )}
                  {location && <p>{location}</p>}
                  <div className="profile-stats">
                    {profile.createdAt && (
                      <span><Icon name="clock" size={16} /> Member since <b>{formatReviewDate(profile.createdAt)}</b></span>
                    )}
                    <span>
                      <Icon name="star" size={16} />
                      {summaryLoading ? (
                        <b>Loading reviews…</b>
                      ) : summaryError ? (
                        <b>Reviews unavailable</b>
                      ) : publishedCount > 0 ? (
                        <><b>{publishedAverage.toFixed(1)}</b> ({publishedCount} review{publishedCount > 1 ? "s" : ""})</>
                      ) : (
                        <b>No published review yet</b>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <article className="content-card">
                <h3>About</h3>
                {profile.personalPresentation || profile.companyDescription ? (
                  <p className="long-copy">{profile.personalPresentation || profile.companyDescription}</p>
                ) : (
                  <p className="task-empty">No profile description provided yet.</p>
                )}
              </article>

              {(profile.companyName || profile.industry || profile.companySize || profile.companyWebsite) && (
                <article className="content-card">
                  <h3>Company &amp; links</h3>
                  {(profile.companyName || profile.industry || profile.companySize) && (
                    <div className="chips large">
                      {profile.companyName && <span>{profile.companyName}</span>}
                      {profile.industry && <span>{profile.industry}</span>}
                      {profile.companySize && <span>{profile.companySize}</span>}
                    </div>
                  )}
                  {profile.companyWebsite && (
                    <p style={{ marginTop: 12 }}>
                      {isHttpLink(profile.companyWebsite) ? (
                        <a className="text-btn" href={profile.companyWebsite} target="_blank" rel="noopener noreferrer">
                          Visit company website <Icon name="arrow" size={13} />
                        </a>
                      ) : (
                        <span>{profile.companyWebsite}</span>
                      )}
                    </p>
                  )}
                </article>
              )}

              <article className="content-card">
                <div className="card-heading">
                  <h3>Reviews received</h3>
                  {publishedCount > 0 && (
                    <small>{publishedAverage.toFixed(1)} / 5 · {publishedCount} review{publishedCount > 1 ? "s" : ""}</small>
                  )}
                </div>
                {summaryLoading ? (
                  <p className="task-empty">Loading reviews…</p>
                ) : summaryError ? (
                  <p className="task-empty">{summaryError}</p>
                ) : publishedCount === 0 ? (
                  <p className="task-empty">
                    No published review yet. Freelancers can review this client once a project is completed, and the
                    review becomes public after both sides submit or after the 14-day review window.
                  </p>
                ) : (
                  <>
                    <div className="feedback-layout" style={{ gridTemplateColumns: "1fr", marginBottom: 18 }}>
                      <section className="feedback-score" style={{ textAlign: "left" }}>
                        <div className="rating-large" style={{ justifyContent: "flex-start" }}>
                          <Icon name="star" />
                          <b>{publishedAverage.toFixed(1)}</b>
                        </div>
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
                          <small>{summary.recommendationRate}% of freelancers recommend this client</small>
                        )}
                      </section>
                    </div>
                    <div className="feedback-list">
                      {(summary?.reviews ?? []).map((item) => (
                        <article className="dash-card feedback-card" key={item.id}>
                          <header>
                            <div>
                              <b>{feedbackAuthor(item)}</b>
                              <small>{formatReviewDate(item.publishedAt || item.createdAt)}</small>
                            </div>
                            <Stars rating={item.rating || Math.round(item.averageRating ?? 0)} />
                          </header>
                          {item.comment && <p>{item.comment}</p>}
                          {item.strengths && <p><b>Strengths:</b> {item.strengths}</p>}
                          {item.improvements && <p><b>To improve:</b> {item.improvements}</p>}
                          <footer>
                            <span><Icon name="briefcase" size={13} /> {item.projectTitle || "Completed project"}</span>
                            {item.recommend === true && <span>Recommended</span>}
                            {item.recommend === false && <span>Not recommended</span>}
                          </footer>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </article>
            </section>

            <aside className="hire-card">
              <div className="rate">
                <span>Client</span>
                <strong>{profile.companyName || "FreelanceTN client"}</strong>
              </div>
              <Button variant="secondary" onClick={backToInvitations}>Back to invitations</Button>
              <hr />
              {profile.industry && (
                <div className="hire-detail"><span><Icon name="briefcase" /> Industry</span><b>{profile.industry}</b></div>
              )}
              <div className="hire-detail">
                <span><Icon name="globe" /> Location</span>
                <b>{location || "Not provided"}</b>
              </div>
              {profile.createdAt && (
                <div className="hire-detail">
                  <span><Icon name="clock" /> Member since</span>
                  <b>{formatReviewDate(profile.createdAt)}</b>
                </div>
              )}
              {publishedCount > 0 && (
                <div className="hire-detail">
                  <span><Icon name="star" /> Published reviews</span>
                  <b>{publishedCount}</b>
                </div>
              )}
            </aside>
          </div>
        </section>
      )}
    </main>
  );
}
