"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { useUser } from "@/context/UserContext";
import { ApiError, authApi, type AuthUser, type EmailDelivery } from "@/lib/api";
import type { Role } from "@/lib/types";

type Mode = "login" | "signup" | "forgot" | "registered" | "twoFactor";

const authErrorMessages: Record<string, string> = {
  google_cancelled: "La connexion Google a été annulée.",
  google_failed: "La connexion Google a échoué. Réessayez ou utilisez votre mot de passe.",
  google_not_configured:
    "La connexion Google n'est pas configurée sur ce serveur. Utilisez votre adresse e-mail.",
  email_not_verified: "Vérifiez votre adresse e-mail avant de vous connecter.",
  account_exists_unverified:
    "Un compte non vérifié existe déjà avec cette adresse. Vérifiez votre e-mail ou connectez-vous avec votre mot de passe.",
  account_mismatch:
    "Les données de ce compte sont incohérentes. Contactez le support FreelanceTN.",
  role_required: "Choisissez votre rôle avant de créer un compte avec Google.",
  invalid_state: "La session Google a expiré. Réessayez.",
  invalid_callback: "La réponse de Google est incomplète. Réessayez.",
  invalid_nonce: "La session Google est invalide. Réessayez.",
  invalid_id_token: "Google n'a pas pu confirmer votre identité. Réessayez.",
  token_exchange_failed: "Google a refusé la connexion. Réessayez.",
  missing_id_token: "Google n'a pas renvoyé les informations nécessaires. Réessayez.",
  userinfo_invalid: "Le profil Google est incomplet. Réessayez.",
  email_delivery_failed:
    "L'e-mail n'a pas pu être envoyé. Vérifiez la configuration e-mail du serveur.",
};

function AuthModal({
  close,
  complete,
  initialSignup = false,
}: {
  close: () => void;
  complete: (user: AuthUser) => void;
  initialSignup?: boolean;
}) {
  const { login, register, verifyTwoFactor } = useUser();
  const [mode, setMode] = useState<Mode>(initialSignup ? "signup" : "login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("freelancer");
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [registeredMessage, setRegisteredMessage] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [canResend, setCanResend] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState<boolean | null>(null);
  const [delivery, setDelivery] = useState<EmailDelivery | null>(null);
  const [devLink, setDevLink] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [twoFactorPreAuthToken, setTwoFactorPreAuthToken] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");

  useEffect(() => {
    let cancelled = false;

    authApi
      .providers()
      .then((providers) => {
        if (!cancelled) setGoogleEnabled(providers.google);
      })
      .catch(() => {
        if (!cancelled) setGoogleEnabled(false);
      });

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const params = new URLSearchParams(window.location.search);
      const authError = params.get("authError");
      if (authError === "account_exists_unverified") {
        const hint = params.get("emailHint");
        const verificationSent = params.get("verificationSent") === "1";
        const seconds = Number.parseInt(params.get("cooldown") ?? "", 10);
        const target = hint ? ` pour ${hint}` : "";

        setError(
          `Un compte FreelanceTN non vérifié existe déjà${target}. ` +
            (verificationSent
              ? "Un nouvel e-mail de vérification vient d'être envoyé : ouvrez-le, puis réessayez avec Google."
              : seconds > 0
                ? `Un e-mail de vérification a déjà été envoyé récemment. Réessayez dans ${seconds} s.`
                : "L'e-mail de vérification n'a pas pu être envoyé. Saisissez votre adresse ci-dessous puis utilisez « Renvoyer l'e-mail de vérification »."),
        );
        // L'adresse complète n'est jamais transmise : le renvoi manuel ne
        // s'affiche qu'une fois une adresse saisie dans le formulaire.
        setCanResend(true);
        if (Number.isFinite(seconds) && seconds > 0) setCooldown(seconds);
      } else if (authError) {
        setError(authErrorMessages[authError] ?? "L'authentification a échoué. Réessayez.");
      }
      if (authError === "email_not_verified") {
        setCanResend(true);
        const emailParam = params.get("email");
        if (emailParam) setEmail(emailParam);
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // Compte à rebours du délai anti-abus renvoyé par le backend : le bouton
  // « Renvoyer » reste désactivé tant qu'un nouvel envoi est refusé.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setNotice("");
    setCanResend(false);
    setForgotSent(false);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);

    const data = new FormData(event.currentTarget);
    const emailValue = String(data.get("email") ?? email).trim();
    const password = String(data.get("password") ?? "");

    try {
      if (mode === "signup") {
        const confirmPassword = String(data.get("confirmPassword") ?? "");
        if (password !== confirmPassword) {
          setError("Les mots de passe ne correspondent pas.");
          setLoading(false);
          return;
        }

        const fullName = String(data.get("name") ?? "").trim().split(/\s+/).filter(Boolean);
        const firstName = fullName[0] ?? "";
        const lastName = fullName.length > 1 ? fullName.slice(1).join(" ") : firstName;

        const result = await register({ email: emailValue, password, firstName, lastName, role });
        setRegisteredEmail(result.email);
        setRegisteredMessage(result.message);
        setDelivery(result.emailDelivery ?? null);
        setDevLink(result.emailDelivery?.devVerificationUrl ?? "");
        setCooldown(0);
        setCanResend(true);
        setEmail(result.email);
        setMode("registered");
        setLoading(false);
        return;
      }

      if (mode === "forgot") {
        await authApi.forgotPassword(emailValue);
        setForgotSent(true);
        setEmail(emailValue);
        setLoading(false);
        return;
      }

      const rememberMe = data.get("remember") !== null;
      const loginResult = await login(emailValue, password, rememberMe);
      if (loginResult.requiresTwoFactor) {
        setTwoFactorPreAuthToken((loginResult as { preAuthToken: string }).preAuthToken);
        setMode("twoFactor");
        setLoading(false);
        return;
      }
      complete((loginResult as { user: any }).user);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Une erreur est survenue. Veuillez réessayer.");
      setCanResend(caught instanceof ApiError && caught.status === 403);
      setEmail(emailValue);
      setLoading(false);
    }
  };

  const handleVerifyTwoFactor = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await verifyTwoFactor(twoFactorPreAuthToken, twoFactorCode);
      complete(user);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Code invalide.");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    const targetEmail = registeredEmail || email;
    if (!targetEmail) return;

    setError("");
    setNotice("");
    setLoading(true);

    try {
      const response = await authApi.resendVerification(targetEmail);
      setNotice(response.message);
      if (response.devVerificationUrl) setDevLink(response.devVerificationUrl);
      if (response.cooldownSeconds && response.cooldownSeconds > 0) {
        setCooldown(response.cooldownSeconds);
      }
      setCanResend(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "L'e-mail n'a pas pu être renvoyé.");
    } finally {
      setLoading(false);
    }
  };

  const continueWithGoogle = () => {
    if (googleEnabled === false) {
      setError("");
      setNotice(
        "La connexion Google n'est pas configurée sur ce serveur. Renseignez Auth:Google:ClientId et Auth:Google:ClientSecret pour l'activer.",
      );
      return;
    }
    window.location.href = authApi.googleStartUrl(mode === "signup" ? role : undefined);
  };

  const title =
    mode === "registered"
      ? "Vérifiez votre e-mail"
      : mode === "forgot"
        ? forgotSent
          ? "E-mail envoyé"
          : "Mot de passe oublié"
        : mode === "signup"
          ? "Créez votre compte"
          : "Bon retour";

  if (mode === "twoFactor") {
    return (
      <div className="modal-backdrop" onMouseDown={close}>
        <div className="auth-modal" onMouseDown={(event) => event.stopPropagation()}>
          <button className="modal-close" onClick={close} aria-label="Fermer">
            <Icon name="close" />
          </button>
          <Logo onClick={close} />
          <span className="overline">WELCOME TO FREELANCETN</span>
          <h2>Vérification 2FA</h2>
          <p>Entrez le code à 6 chiffres de votre application d'authentification.</p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <form onSubmit={handleVerifyTwoFactor}>
            <label>
              Code
              <input
                required
                name="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={twoFactorCode}
                onChange={(event) => setTwoFactorCode(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={loading}>
              {loading ? "Vérification..." : "Valider"}
            </Button>
          </form>
          <p className="switch-auth">
            <button onClick={() => switchMode("login")}>Retour à la connexion</button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="auth-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={close} aria-label="Fermer">
          <Icon name="close" />
        </button>
        <Logo onClick={close} />
        <span className="overline">WELCOME TO FREELANCETN</span>
        <h2>{title}</h2>

        {mode === "registered" ? (
          <>
            {delivery ? (
              delivery.sent === false ? (
                <p className="form-error" role="alert">
                  Votre compte est créé, mais l&apos;e-mail de vérification n&apos;a pas pu être
                  envoyé. Utilisez « Renvoyer l&apos;e-mail » pour réessayer.
                </p>
              ) : delivery.transport === "dev-outbox" ? (
                <p>
                  Votre compte a été créé pour <strong>{registeredEmail}</strong>. Aucun serveur SMTP
                  n&apos;est configuré : l&apos;e-mail de vérification n&apos;a pas été expédié, il a
                  seulement été enregistré localement pour le développement.
                </p>
              ) : (
                <p>
                  Un lien de confirmation a été envoyé à <strong>{registeredEmail}</strong>. Ouvrez-le
                  pour activer votre compte avant de vous connecter.
                </p>
              )
            ) : (
              <p>{registeredMessage}</p>
            )}
            {notice && <p className="form-notice">{notice}</p>}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {devLink && (
              <p className="form-notice">
                Mode développement :{" "}
                <a href={devLink}>vérifier mon adresse e-mail</a> (lien également écrit dans
                App_Data/dev-emails).
              </p>
            )}
            <div className="reset-success">
              <span>
                <Icon name="shield" size={22} />
              </span>
              <Button onClick={resend} disabled={loading || cooldown > 0}>
                {loading
                  ? "Envoi..."
                  : cooldown > 0
                    ? `Renvoyer dans ${cooldown} s`
                    : "Renvoyer l'e-mail"}
              </Button>
            </div>
            <p className="switch-auth">
              <button onClick={() => switchMode("login")}>Aller à la connexion</button>
            </p>
          </>
        ) : mode === "forgot" ? (
          forgotSent ? (
            <>
              <p>
                Si un compte correspond à <strong>{email}</strong>, un lien de réinitialisation vient d'être
                envoyé. Ce lien expire rapidement et ne peut être utilisé qu'une fois.
              </p>
              <div className="reset-success">
                <span>
                  <Icon name="clock" size={22} />
                </span>
                <Button onClick={() => switchMode("login")}>Back to login</Button>
              </div>
            </>
          ) : (
            <>
              <p>Entrez l'adresse e-mail de votre compte. Un lien sécurisé vous sera envoyé.</p>
              <form onSubmit={submit}>
                <label>
                  Email address
                  <input
                    required
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <Button type="submit">{loading ? "Envoi..." : "Envoyer le lien"}</Button>
              </form>
              <p className="switch-auth">
                <button onClick={() => switchMode("login")}>Back to login</button>
              </p>
            </>
          )
        ) : (
          <>
            <p>
              {mode === "signup"
                ? "Rejoignez les professionnels indépendants et les clients de FreelanceTN."
                : "Connectez-vous pour continuer vers votre espace de travail."}
            </p>

            <div className="social-row">
              <Button variant="secondary" onClick={continueWithGoogle}>
                Continuer avec Google
              </Button>
            </div>
            {googleEnabled === false && (
              <p className="demo-note">
                <Icon name="shield" size={14} /> La connexion Google n&apos;est pas disponible pour
                le moment. Utilisez votre adresse e-mail.
              </p>
            )}

            <div className="divider">
              <span>ou continuer avec un e-mail</span>
            </div>

            <form onSubmit={submit}>
              {mode === "signup" && (
                <label>
                  Full name
                  <input required name="name" autoComplete="name" placeholder="Votre nom complet" />
                </label>
              )}

              {mode === "signup" && (
                <div className="role-picker">
                  <span>Je m'inscris comme</span>
                  <div className="role-picker-grid">
                    <button
                      type="button"
                      className={role === "freelancer" ? "active" : ""}
                      aria-pressed={role === "freelancer"}
                      onClick={() => setRole("freelancer")}
                    >
                      <span className="role-visual freelancer-visual">
                        <Icon name="portfolio" size={18} />
                      </span>
                      <span className="role-picker-text">
                        <b>Freelancer</b>
                        <small>Proposer mes compétences et trouver des missions</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={role === "client" ? "active" : ""}
                      aria-pressed={role === "client"}
                      onClick={() => setRole("client")}
                    >
                      <span className="role-visual client-visual">
                        <Icon name="briefcase" size={18} />
                      </span>
                      <span className="role-picker-text">
                        <b>Client</b>
                        <small>Recruter des talents et gérer des projets</small>
                      </span>
                    </button>
                  </div>
                </div>
              )}

              <label>
                Email address
                <input
                  required
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>

              <label>
                Password
                <input
                  required
                  name="password"
                  minLength={8}
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder="At least 8 characters"
                />
              </label>

              {mode === "signup" && (
                <label>
                  Confirm password
                  <input
                    required
                    name="confirmPassword"
                    minLength={8}
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repeat your password"
                  />
                </label>
              )}

              {mode === "login" && (
                <div className="form-extra">
                  <label className="remember">
                    <input type="checkbox" name="remember" /> Remember me
                  </label>
                  <button type="button" onClick={() => switchMode("forgot")}>
                    Forgot password?
                  </button>
                </div>
              )}

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {notice && <p className="form-notice">{notice}</p>}

              {canResend && (registeredEmail || email) && (
                <p className="form-extra">
                  <button type="button" onClick={resend} disabled={loading || cooldown > 0}>
                    {cooldown > 0
                      ? `Renvoyer l'e-mail dans ${cooldown} s`
                      : "Renvoyer l'e-mail de vérification"}
                  </button>
                </p>
              )}

              {canResend && devLink && (
                <p className="form-notice">
                  Mode développement :{" "}
                  <a href={devLink}>ouvrir le lien de vérification</a> (également écrit dans
                  App_Data/dev-emails).
                </p>
              )}

              <Button type="submit">{loading ? "Veuillez patienter…" : mode === "signup" ? "Créer mon compte" : "Se connecter"}</Button>
            </form>

            <p className="switch-auth">
              {mode === "signup" ? "Vous avez déjà un compte ?" : "Nouveau sur FreelanceTN ?"}{" "}
              <button onClick={() => switchMode(mode === "signup" ? "login" : "signup")}>
                {mode === "signup" ? "Se connecter" : "Créer un compte"}
              </button>
            </p>

            <small className="demo-note">
              <Icon name="shield" size={14} /> Votre mot de passe est chiffré et n'est jamais partagé.
            </small>
          </>
        )}
      </div>
    </div>
  );
}

export { AuthModal };
