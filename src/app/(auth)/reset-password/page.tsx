"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";
import { ApiError, authApi } from "@/lib/api";

type Status = "form" | "missing" | "success";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Status>("form");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = new URLSearchParams(window.location.search).get("token");
      if (!value) {
        setStatus("missing");
        return;
      }
      setToken(value);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmPassword") ?? "");

    if (password !== confirmation) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);
    try {
      const response = await authApi.resetPassword({ token, password });
      setMessage(response.message);
      setStatus("success");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Le mot de passe n'a pas pu être réinitialisé.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="auth-modal">
        <Logo onClick={() => router.push("/")} />
        <span className="overline">ACCOUNT RECOVERY</span>
        <h2>{status === "success" ? "Mot de passe modifié" : "Nouveau mot de passe"}</h2>

        {status === "success" ? (
          <>
            <div className="reset-success">
              <span>
                <Icon name="check" size={24} />
              </span>
              <p>{message}</p>
            </div>
            <Button onClick={() => router.push("/login")}>Se connecter</Button>
          </>
        ) : status === "missing" ? (
          <>
            <p>Ce lien de réinitialisation est incomplet ou invalide.</p>
            <Button onClick={() => router.push("/login")}>Retour à la connexion</Button>
          </>
        ) : (
          <>
            <p>Choisissez un nouveau mot de passe pour votre compte FreelanceTN.</p>
            <form onSubmit={submit}>
              <label>
                Nouveau mot de passe
                <input
                  required
                  name="password"
                  minLength={8}
                  type="password"
                  autoComplete="new-password"
                  placeholder="Au moins 8 caractères"
                />
              </label>
              <label>
                Confirmez le mot de passe
                <input
                  required
                  name="confirmPassword"
                  minLength={8}
                  type="password"
                  autoComplete="new-password"
                  placeholder="Répétez votre mot de passe"
                />
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit">{loading ? "Enregistrement..." : "Réinitialiser le mot de passe"}</Button>
            </form>
            <p className="switch-auth">
              <button onClick={() => router.push("/login")}>Retour à la connexion</button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
