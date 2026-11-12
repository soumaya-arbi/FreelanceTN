"use client";

import { useUser } from "@/context/UserContext";

/**
 * Affiché lorsqu'une panne réseau ou serveur empêche de vérifier la session.
 * On ne redirige jamais vers /login dans ce cas : la session peut être encore
 * valide et une simple nouvelle tentative suffit.
 */
export function SessionLoading() {
  return (
    <main className="session-error" role="status" aria-live="polite">
      <div>
        <span className="session-error-icon session-loading-icon" aria-hidden="true" />
        <h1>Loading your workspace…</h1>
        <p>Checking your session securely.</p>
      </div>
    </main>
  );
}

export function SessionError() {
  const { retrySession, status } = useUser();
  return (
    <main className="session-error" role="alert">
      <div>
        <span className="session-error-icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </span>
        <h1>We couldn&apos;t reach FreelanceTN</h1>
        <p>
          Your session is still saved. Check your connection and try again — you don&apos;t need to
          sign in again.
        </p>
        <button className="btn btn-primary" onClick={() => void retrySession()} disabled={status === "loading"}>
          {status === "loading" ? "Trying again…" : "Try again"}
        </button>
      </div>
    </main>
  );
}
