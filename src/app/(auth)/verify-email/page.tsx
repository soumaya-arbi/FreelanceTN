"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";
import { ApiError, authApi } from "@/lib/api";

type Status = "loading" | "success" | "error" | "missing";

export default function VerifyEmailPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState("");
  const [resendError, setResendError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [devLink, setDevLink] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const params = new URLSearchParams(window.location.search);
      const token = params.get("token");
      // Le lien de vérification peut aussi transporter l'adresse concernée :
      // elle est préremplie pour faciliter un renvoi après expiration.
      const emailParam = params.get("email");
      if (emailParam) setEmail(emailParam);

      if (!token) {
        setStatus("missing");
        return;
      }

      authApi
        .verifyEmail(token)
        .then((response) => {
          if (cancelled) return;
          setMessage(response.message);
          if (response.email) setEmail(response.email);
          setStatus("success");
        })
        .catch((caught) => {
          if (cancelled) return;
          setVerifyError(
            caught instanceof ApiError
              ? caught.message
              : "Ce lien de vérification est invalide, a déjà été utilisé ou a expiré.",
          );
          setStatus("error");
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // Compte à rebours du délai anti-abus : le bouton reste désactivé tant que
  // le backend refuserait un nouvel envoi.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const resend = async () => {
    if (!email) {
      setResendError("Saisissez votre adresse e-mail.");
      return;
    }

    setResending(true);
    setResendError("");
    setNotice("");

    try {
      const response = await authApi.resendVerification(email);
      setNotice(response.message);
      if (response.devVerificationUrl) setDevLink(response.devVerificationUrl);
      if (response.cooldownSeconds && response.cooldownSeconds > 0) {
        setCooldown(response.cooldownSeconds);
      }
    } catch (caught) {
      setResendError(caught instanceof ApiError ? caught.message : "L'e-mail n'a pas pu être renvoyé.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="auth-modal">
        <Logo onClick={() => router.push("/")} />
        <span className="overline">ACCOUNT VERIFICATION</span>
        <h2>
          {status === "success"
            ? "E-mail vérifié"
            : status === "loading"
              ? "Vérification..."
              : "Vérifier votre e-mail"}
        </h2>

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
        ) : status === "loading" ? (
          <p>Validation de votre lien en cours...</p>
        ) : (
          <>
            <p>
              {status === "missing"
                ? "Ce lien ne contient aucun jeton de vérification. Saisissez votre adresse e-mail pour recevoir un nouveau lien."
                : verifyError ||
                  "Ce lien est invalide, a déjà été utilisé ou a expiré. Saisissez votre adresse e-mail pour recevoir un nouveau lien."}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void resend();
              }}
            >
              <label>
                Email address
                <input
                  required
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              {notice && <p className="form-notice">{notice}</p>}
              {resendError && (
                <p className="form-error" role="alert">
                  {resendError}
                </p>
              )}
              {devLink && (
                <p className="form-notice">
                  <a href={devLink}>Ouvrir le lien de vérification</a>
                </p>
              )}
              <Button type="submit" disabled={resending || cooldown > 0}>
                {resending ? "Envoi..." : cooldown > 0 ? `Renvoyer dans ${cooldown} s` : "Renvoyer le lien"}
              </Button>
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
