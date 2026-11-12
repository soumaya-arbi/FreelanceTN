"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";
import { accountApi, ApiError, type TeamMember } from "@/lib/api";

type Status = "loading" | "ready" | "missing" | "accepted" | "declined" | "error";

export default function TeamAcceptPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [member, setMember] = useState<TeamMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = new URLSearchParams(window.location.search).get("token");
      if (!value) {
        setStatus("missing");
        return;
      }
      setToken(value);
      setStatus("ready");
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const activate = async () => {
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await accountApi.activateInvitation(token, password);
      setMember(result);
      setStatus("accepted");
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.errors.length > 0
            ? `${caught.message} ${caught.errors.join(" ")}`
            : caught.message
          : "Cette invitation n'a pas pu être traitée.",
      );
      setStatus("error");
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await accountApi.declineInvitation(token);
      setMember(result);
      setStatus("declined");
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.errors.length > 0
            ? `${caught.message} ${caught.errors.join(" ")}`
            : caught.message
          : "Cette invitation n'a pas pu être traitée.",
      );
      setStatus("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="auth-modal">
        <Logo onClick={() => router.push("/")} />
        <span className="overline">TEAM INVITATION</span>
        <h2>
          {status === "accepted"
            ? "Invitation acceptée"
            : status === "declined"
              ? "Invitation refusée"
              : "Rejoindre une équipe"}
        </h2>

        {status === "loading" && <p className="task-empty">Vérification de l&apos;invitation…</p>}

        {status === "missing" && (
          <>
            <p>Ce lien d&apos;invitation est incomplet ou invalide.</p>
            <Button onClick={() => router.push("/login")}>Retour à la connexion</Button>
          </>
        )}

        {status === "ready" && (
          <>
            <p>
              Vous avez été invité à rejoindre l&apos;équipe d&apos;un compte client FreelanceTN.
              Définissez votre mot de passe pour activer votre accès.
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <label className="editor-field">
              Mot de passe
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
              />
            </label>
            <label className="editor-field">
              Confirmer le mot de passe
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                minLength={8}
              />
            </label>
            <div className="settings-actions">
              <Button onClick={activate} disabled={busy}>
                {busy ? "Traitement..." : "Activer mon accès"}
              </Button>
              <Button variant="secondary" onClick={decline} disabled={busy}>
                Refuser
              </Button>
            </div>
          </>
        )}

        {(status === "accepted" || status === "declined") && (
          <>
            <div className="reset-success">
              <span>
                <Icon name={status === "accepted" ? "check" : "close"} size={24} />
              </span>
              <p>
                {status === "accepted"
                  ? "Votre accès à l'équipe est actif. Connectez-vous avec votre email et votre mot de passe."
                  : "L'invitation a été refusée. Aucun accès n'a été accordé."}
              </p>
            </div>
            {member && (
              <p className="transport-note">
                Invitation : <b>{member.email}</b> · rôle <b>{member.role}</b> · statut{" "}
                <b>{member.status}</b>
              </p>
            )}
            <Button onClick={() => router.push("/login")}>Se connecter</Button>
          </>
        )}

        {status === "error" && (
          <>
            <p className="form-error" role="alert">
              {error}
            </p>
            <Button onClick={() => router.push("/login")}>Retour à la connexion</Button>
          </>
        )}
      </div>
    </div>
  );
}