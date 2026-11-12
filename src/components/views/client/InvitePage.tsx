"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { ClientShell } from "@/components/layout/ClientShell";
import { useMarketplace } from "@/context/MarketplaceContext";
import type { Page } from "@/lib/types";
import { ApiError, freelancersApi, invitationsApi, type PublicFreelancer } from "@/lib/api";
import { AvatarBadge } from "@/components/views/account/AvatarBadge";

type ProfileState = {
  id: string;
  profile: PublicFreelancer | null;
  loading: boolean;
  error: string;
};

function InvitePage({ freelancerId, go, notify }: { freelancerId: string; go: (p: Page) => void; notify: (s: string) => void }) {
  const router = useRouter();
  const { projects, projectsLoading, projectsError } = useMarketplace();
  const [profileState, setProfileState] = useState<ProfileState>({ id: freelancerId, profile: null, loading: true, error: "" });
  const [step, setStep] = useState(1);
  const [projectId, setProjectId] = useState("");
  const [message, setMessage] = useState("");
  const [rate, setRate] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sent, setSent] = useState(false);

  // Le profil est chargé depuis l'API : aucune donnée statique ne peut être
  // utilisée pour préparer une invitation.
  useEffect(() => {
    let cancelled = false;
    setProfileState({ id: freelancerId, profile: null, loading: true, error: "" });
    freelancersApi
      .get(freelancerId)
      .then((profile) => {
        if (cancelled) return;
        setProfileState({ id: freelancerId, profile, loading: false, error: "" });
        setMessage(`Hi ${profile.name.split(" ")[0] || "there"},\n\nI would love to discuss a project with you.`);
        if (profile.hourlyRate > 0) setRate(String(profile.hourlyRate));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setProfileState({
          id: freelancerId,
          profile: null,
          loading: false,
          error: error instanceof ApiError ? error.message : "This profile is not available.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [freelancerId]);

  // Le projet peut être présélectionné depuis la page projet
  // (/client/invite/{id}?project={projectId}).
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("project") ?? "";
    if (requested) setProjectId(requested);
  }, []);

  const profile = profileState.id === freelancerId ? profileState.profile : null;
  const loading = profileState.id !== freelancerId || profileState.loading;
  const error = profileState.id === freelancerId ? profileState.error : "";

  // Le backend n'accepte que les projets publiés et non attribués : le
  // formulaire ne propose donc que des cibles réellement invitables.
  const invitableProjects = useMemo(
    () => projects.filter((project) => project.status === "Open" && !project.assignedTo),
    [projects],
  );
  const selectedProject = invitableProjects.find((project) => project.id === projectId) ?? null;

  const goBackToProfile = () => router.push(`/client/talent/${freelancerId}`);

  const submit = async () => {
    if (!profile || !selectedProject) {
      setSendError("Select a published project before sending the invitation.");
      return;
    }
    if (message.trim().length < 10) {
      setSendError("Add a short message so the freelancer understands your request.");
      return;
    }
    setSending(true);
    setSendError("");
    try {
      await invitationsApi.create({
        projectId: selectedProject.id,
        freelancerId: profile.id,
        message: message.trim(),
        offeredPrice: rate.trim() ? `${rate.trim()} TND/hr` : undefined,
      });
      setSent(true);
      notify(`Invitation sent to ${profile.name}`);
    } catch (invitationError) {
      setSendError(invitationError instanceof ApiError ? invitationError.message : "The invitation could not be sent.");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <ClientShell go={go} notify={notify}>
        <main className="invite-page">
          <div className="empty-state" style={{ margin: "60px auto" }}>
            <span><Icon name="clock" size={20} /></span>
            <b>Loading this profile…</b>
            <p>Fetching the freelancer account from the API.</p>
          </div>
        </main>
      </ClientShell>
    );
  }

  if (!profile) {
    return (
      <ClientShell go={go} notify={notify}>
        <main className="invite-page">
          <div className="empty-state" style={{ margin: "60px auto" }}>
            <span><Icon name="users" size={20} /></span>
            <b>This profile is not available</b>
            <p>{error || "No freelancer account matches this address, so no invitation can be prepared."}</p>
            <Button variant="secondary" onClick={() => go("client-talent")}>Browse talent</Button>
          </div>
        </main>
      </ClientShell>
    );
  }

  if (sent) {
    return (
      <ClientShell go={go} notify={notify}>
        <main className="invite-page">
          <div className="invite-success">
            <span><Icon name="check" size={34} /></span>
            <div className="success-avatars">
              <span className="company-avatar">{(profile.name.charAt(0) || "C").toUpperCase()}</span>
              <i><Icon name="arrow" /></i>
              <AvatarBadge url={profile.avatar || undefined} firstName={profile.name.split(" ")[0]} lastName={profile.name.split(" ").slice(1).join(" ")} size={54} source={profile.avatarSource} avatarConfig={profile.avatarConfig} />
            </div>
            <span className="overline">INVITATION SENT</span>
            <h1>Your invitation has been sent.</h1>
            <p>
              {profile.name} will find your invitation and a notification in their workspace. You can follow the response from your project page.
            </p>
            <div className="success-details">
              <div><Icon name="briefcase" /><span><b>{selectedProject?.title ?? "Project"}</b><small>Invitation linked to this project</small></span></div>
              <div><Icon name="bell" /><span><b>Notification delivered</b><small>The freelancer is notified when the invitation is created</small></span></div>
            </div>
            <div>
              {selectedProject && <Button onClick={() => router.push(`/client/projects/${selectedProject.id}`)}>View project</Button>}
              <Button variant="secondary" onClick={goBackToProfile}>Back to profile</Button>
            </div>
          </div>
        </main>
      </ClientShell>
    );
  }

  return (
    <ClientShell go={go} notify={notify}>
      <main className="invite-page">
        <button className="back-link" onClick={goBackToProfile}><Icon name="arrow" size={16} /> Back to profile</button>
        <div className="invite-heading">
          <div>
            <span className="overline">DIRECT INVITATION</span>
            <h1>Invite {profile.name} to your project</h1>
            <p>Share the opportunity, align on expectations, and start a conversation.</p>
          </div>
          <div className="invite-person">
            <AvatarBadge url={profile.avatar || undefined} firstName={profile.name.split(" ")[0]} lastName={profile.name.split(" ").slice(1).join(" ")} size={46} source={profile.avatarSource} avatarConfig={profile.avatarConfig} />
            <span>
              <b>{profile.name}</b>
              <small>{profile.title || "Freelancer"}</small>
              <em><Icon name="star" size={11} /> {profile.hourlyRate > 0 ? `${profile.hourlyRate} TND/hr` : "Rate on request"}</em>
            </span>
          </div>
        </div>

        <div className="invite-progress">
          <div className={step >= 1 ? "active" : ""}><span>{step > 1 ? <Icon name="check" size={13} /> : "1"}</span><b>Project</b></div><i />
          <div className={step >= 2 ? "active" : ""}><span>{step > 2 ? <Icon name="check" size={13} /> : "2"}</span><b>Invitation</b></div><i />
          <div className={step >= 3 ? "active" : ""}><span>3</span><b>Review</b></div>
        </div>

        <div className="invite-layout">
          <section className="dash-card invite-form-card">
            {step === 1 && (
              <>
                <h2>Choose a project</h2>
                <p>Select one of your published projects that is still open for hiring.</p>
                {projectsLoading && <p className="task-empty">Loading your projects…</p>}
                {!projectsLoading && projectsError && <p className="task-empty">{projectsError}</p>}
                {!projectsLoading && !projectsError && invitableProjects.length === 0 && (
                  <div className="empty-state">
                    <span><Icon name="file" size={20} /></span>
                    <b>No project is open for invitations</b>
                    <p>Publish a project first. Only published projects that are not already assigned can receive an invitation.</p>
                    <Button variant="secondary" onClick={() => go("client-post")}>Post a project</Button>
                  </div>
                )}
                {!projectsLoading && !projectsError && invitableProjects.length > 0 && (
                  <div className="project-choice">
                    {invitableProjects.map((project, index) => (
                      <button className={projectId === project.id ? "selected" : ""} onClick={() => setProjectId(project.id)} key={project.id}>
                        <span className={`project-symbol p${index % 3}`}><Icon name="file" /></span>
                        <span><b>{project.title}</b><small>{project.budget || "Budget not set"} · {project.proposals} proposals</small></span>
                        <i>{projectId === project.id && <Icon name="check" size={14} />}</i>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <h2>Personalize your invitation</h2>
                <p>A thoughtful message helps talented professionals understand why they're a strong fit.</p>
                <label className="invite-label">Your message
                  <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1500} />
                  <small>{message.length}/1,500 characters</small>
                </label>
                <div className="form-split">
                  <label className="invite-label">Suggested hourly rate
                    <div className="money-input">
                      <span>TND</span>
                      <input type="number" min="0" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="Optional" />
                      <em>/hr</em>
                    </div>
                  </label>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h2>Review your invitation</h2>
                <p>Make sure everything looks right before sending it.</p>
                <div className="invite-review-block">
                  <small>INVITING</small>
                  <div className="review-person">
                    <AvatarBadge url={profile.avatar || undefined} firstName={profile.name.split(" ")[0]} lastName={profile.name.split(" ").slice(1).join(" ")} size={40} source={profile.avatarSource} avatarConfig={profile.avatarConfig} />
                    <span><b>{profile.name}</b><em>{profile.title || "Freelancer"}</em></span>
                  </div>
                </div>
                <div className="invite-review-block">
                  <small>PROJECT</small>
                  <b>{selectedProject?.title ?? "No project selected"}</b>
                  <p>{selectedProject ? `${selectedProject.budget || "Budget not set"} · ${selectedProject.proposals} proposals` : "Go back to select a project."}</p>
                </div>
                <div className="invite-review-block">
                  <small>MESSAGE</small>
                  <p className="message-preview">{message}</p>
                </div>
                <div className="demo-disclosure">
                  <Icon name="shield" />
                  <span><b>Invitation</b><small>The freelancer receives a notification. No contract or payment is created by this action.</small></span>
                </div>
              </>
            )}

            {sendError && <p className="form-error" role="alert">{sendError}</p>}

            <div className="invite-actions">
              <Button variant="ghost" onClick={() => step === 1 ? goBackToProfile() : setStep(step - 1)}>{step === 1 ? "Cancel" : "Back"}</Button>
              {step < 3 ? (
                <Button
                  onClick={() => {
                    setSendError("");
                    if (step === 1 && !selectedProject) {
                      setSendError("Select a project to continue.");
                      return;
                    }
                    setStep(step + 1);
                  }}
                  icon="chevron"
                >
                  Continue
                </Button>
              ) : (
                <Button onClick={submit} icon="arrow" disabled={sending || !selectedProject}>
                  {sending ? "Sending…" : "Send invitation"}
                </Button>
              )}
            </div>
          </section>

          <aside className="invite-tips">
            <article>
              <span><Icon name="star" /></span>
              <h3>About {profile.name}</h3>
              <ul>
                <li>{profile.title || "Freelancer"}</li>
                <li>{profile.location || "Location not provided"}</li>
                <li>{profile.hourlyRate > 0 ? `${profile.hourlyRate} TND/hr` : "Rate on request"}</li>
              </ul>
              {profile.skills.length > 0 && <div className="chips">{profile.skills.slice(0, 6).map((skill) => <span key={skill}>{skill}</span>)}</div>}
              <Button variant="secondary" onClick={goBackToProfile}>View full profile</Button>
            </article>
            <article>
              <span><Icon name="shield" /></span>
              <h3>Hire with confidence</h3>
              <p>You won't be charged until the freelancer accepts and you approve contract terms.</p>
            </article>
          </aside>
        </div>
      </main>
    </ClientShell>
  );
}

export { InvitePage };
