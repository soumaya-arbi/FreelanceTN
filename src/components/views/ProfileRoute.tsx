"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Profile } from "@/components/views/ProfileView";
import { useApp } from "@/context/AppContext";
import { ApiError, feedbacksApi, freelancersApi, portfolioApi, type PublicFreelancer } from "@/lib/api";
import type { Feedback, FeedbackSummary, Freelancer, PortfolioItem } from "@/lib/types";

type ProfileState = {
  id: string;
  profile: PublicFreelancer | null;
  loading: boolean;
  error: string;
};

type SummaryState = {
  id: string;
  summary: FeedbackSummary | null;
  loading: boolean;
  error: string;
};

type PortfolioState = {
  id: string;
  items: PortfolioItem[];
  loading: boolean;
  error: string;
};

export function ProfileRoute({ freelancerId }: { freelancerId: string }) {
  const { go, notify, setInvitee } = useApp();
  const router = useRouter();
  const [profileState, setProfileState] = useState<ProfileState>({
    id: freelancerId,
    profile: null,
    loading: true,
    error: "",
  });
  const [feedbackState, setFeedbackState] = useState<SummaryState>({
    id: freelancerId,
    summary: null,
    loading: true,
    error: "",
  });
  const [portfolioState, setPortfolioState] = useState<PortfolioState>({
    id: freelancerId,
    items: [],
    loading: true,
    error: "",
  });

  useEffect(() => {
    let cancelled = false;
    freelancersApi
      .get(freelancerId)
      .then((item) => {
        if (cancelled) return;
        setProfileState({ id: freelancerId, profile: item, loading: false, error: "" });
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setProfileState({
          id: freelancerId,
          profile: null,
          loading: false,
          error: requestError instanceof ApiError ? requestError.message : "This profile is not available.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [freelancerId]);

  useEffect(() => {
    let cancelled = false;
    // Le résumé de réputation est calculé côté API à partir des seuls avis
    // publiés : aucun avis masqué ni demande en attente n'est compté.
    feedbacksApi
      .summary(freelancerId)
      .then((summary) => {
        if (cancelled) return;
        setFeedbackState({ id: freelancerId, summary, loading: false, error: "" });
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setFeedbackState({
          id: freelancerId,
          summary: null,
          loading: false,
          error: requestError instanceof ApiError ? requestError.message : "Reviews could not be loaded.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [freelancerId]);

  useEffect(() => {
    let cancelled = false;
    portfolioApi
      .forFreelancer(freelancerId)
      .then((items) => {
        if (cancelled) return;
        setPortfolioState({ id: freelancerId, items, loading: false, error: "" });
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setPortfolioState({
          id: freelancerId,
          items: [],
          loading: false,
          error: requestError instanceof ApiError ? requestError.message : "Portfolio could not be loaded.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [freelancerId]);

  const loading = profileState.id !== freelancerId || profileState.loading;
  const profile = profileState.id === freelancerId ? profileState.profile : null;
  const error = profileState.id === freelancerId ? profileState.error : "";
  const summary = feedbackState.id === freelancerId ? feedbackState.summary : null;
  const feedback = useMemo<Feedback[]>(() => summary?.reviews ?? [], [summary]);
  const feedbackLoading = feedbackState.id !== freelancerId || feedbackState.loading;
  const feedbackError = feedbackState.id === freelancerId ? feedbackState.error : "";
  const portfolio = useMemo(
    () => (portfolioState.id === freelancerId ? portfolioState.items : []),
    [portfolioState.id, portfolioState.items, freelancerId],
  );
  const portfolioLoading = portfolioState.id !== freelancerId || portfolioState.loading;
  const portfolioError = portfolioState.id === freelancerId ? portfolioState.error : "";

  const freelancer = useMemo<Freelancer | null>(() => {
    if (!profile) return null;
    return {
      id: profile.id,
      name: profile.name,
      role: profile.title || "Freelancer",
      rate: profile.hourlyRate,
      rating: summary?.averageRating ?? 0,
      jobs: summary?.count ?? 0,
      location: profile.location,
      avatar: profile.avatar,
      avatarSource: profile.avatarSource ?? "initials",
      avatarConfig: profile.avatarConfig,
      coverImage: profile.coverImage,
      skills: profile.skills,
      bio: profile.bio,
      experiences: profile.experiences,
      education: profile.education,
      languages: profile.languages,
    };
  }, [profile, summary]);

  return (
    <Profile
      go={go}
      notify={notify}
      freelancer={freelancer ?? undefined}
      feedback={feedback}
      summary={summary}
      loading={loading}
      error={error}
      feedbackLoading={feedbackLoading}
      feedbackError={feedbackError}
      portfolio={portfolio}
      portfolioLoading={portfolioLoading}
      portfolioError={portfolioError}
      invite={(name) => {
        setInvitee(name);
        // L'invitation cible l'identifiant réel du compte : le nom affiché
        // n'est jamais utilisé comme clé de routage. Le contexte de projet
        // éventuel est transmis pour présélectionner la bonne opportunité.
        const projectId = new URLSearchParams(window.location.search).get("project");
        const suffix = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
        router.push(`/client/invite/${profile?.id || freelancerId}${suffix}`);
      }}
    />
  );
}
