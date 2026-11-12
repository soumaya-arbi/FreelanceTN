"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Role } from "@/lib/types";
import { ApiError, accountApi, authApi, normalizeRole, type AuthUser, type RegisterInput, type RegisterResult, type UpdateProfileInput } from "@/lib/api";

export type SessionUser = {
  name: string;
  firstName: string;
  email: string;
  company: string;
  avatar: string;
  title: string;
  location: string;
};

// "error" distingue une panne réseau ou serveur d'une session réellement
// expirée : une coupure temporaire ne doit jamais déconnecter l'utilisateur.
export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";

/** Une réponse 401 est la seule preuve fiable que la session n'est plus valide. */
const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;

type UserContextValue = {
  role: Role;
  user: SessionUser;
  authUser: AuthUser | null;
  status: AuthStatus;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<
    | { requiresTwoFactor: true; preAuthToken: string }
    | { requiresTwoFactor: false; user: AuthUser }
  >;
  verifyTwoFactor: (preAuthToken: string, code: string) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<AuthUser>;
  uploadAvatar: (file: File) => Promise<AuthUser>;
  refreshUser: () => Promise<AuthUser | null>;
  retrySession: () => Promise<void>;
};

const emptySessionUser: SessionUser = {
  name: "",
  firstName: "",
  email: "",
  company: "",
  avatar: "",
  title: "",
  location: "",
};

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: React.ReactNode }) {
  // État d'authentification réel : la session n'est jamais déduite d'une valeur
  // locale — elle est vérifiée auprès de GET /api/auth/me (cookie httpOnly).
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  // Incrémenté à chaque changement de session (connexion, inscription,
  // déconnexion). La requête /me lancée au montage est ignorée si la session
  // a changé entre-temps : sans cela, son réponse 401 (arrivée après une
  // connexion réussie) réinitialisait la session et renvoyait l'utilisateur
  // vers /login.
  const sessionVersion = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const startedAt = sessionVersion.current;
    authApi
      .me()
      .then((user) => {
        if (cancelled || sessionVersion.current !== startedAt) return;
        setAuthUser(user);
        setStatus("authenticated");
      })
      .catch((error: unknown) => {
        if (cancelled || sessionVersion.current !== startedAt) return;
        if (isUnauthorized(error)) {
          setAuthUser(null);
          setStatus("unauthenticated");
          return;
        }
        // Panne réseau ou serveur : la session n'est pas déclarée expirée.
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string, rememberMe = false) => {
    const result = await authApi.login({ email, password, rememberMe });
    if ("requiresTwoFactor" in result && result.requiresTwoFactor) {
      return { requiresTwoFactor: true as const, preAuthToken: (result as { preAuthToken: string }).preAuthToken };
    }
    const user = result.user!;
    sessionVersion.current += 1;
    setAuthUser(user);
    setStatus("authenticated");
    return { requiresTwoFactor: false as const, user };
  }, []);

  const verifyTwoFactor = useCallback(async (preAuthToken: string, code: string) => {
    const result = await authApi.verifyTwoFactor({ preAuthToken, code });
    sessionVersion.current += 1;
    setAuthUser(result.user);
    setStatus("authenticated");
    return result.user;
  }, []);

  // L'inscription crée le compte (rôle choisi puis validé par le backend) puis
  // connecte : le cookie de session n'est posé qu'à la connexion.
  const register = useCallback(async (input: RegisterInput) => {
    return authApi.register(input);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      sessionVersion.current += 1;
      setAuthUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  const updateProfile = useCallback(async (input: UpdateProfileInput) => {
    const user = await authApi.updateMe(input);
    sessionVersion.current += 1;
    setAuthUser(user);
    return user;
  }, []);

  const uploadAvatar = useCallback(async (file: File) => {
    const user = await authApi.uploadAvatar(file);
    sessionVersion.current += 1;
    setAuthUser(user);
    return user;
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const user = await authApi.me();
      sessionVersion.current += 1;
      setAuthUser(user);
      setStatus("authenticated");
      return user;
    } catch (error: unknown) {
      if (isUnauthorized(error)) {
        sessionVersion.current += 1;
        setAuthUser(null);
        setStatus("unauthenticated");
      } else {
        // Le compte déjà chargé reste affiché : seule une 401 déconnecte.
        setStatus((current) => (current === "authenticated" ? current : "error"));
      }
      return null;
    }
  }, []);

  // Nouvelle tentative explicite après une panne réseau : aucune donnée de
  // session n'est effacée tant que le serveur n'a pas répondu 401.
  const retrySession = useCallback(async () => {
    setStatus("loading");
    await refreshUser();
  }, [refreshUser]);

  // Applique le thème enregistré côté compte : effet réel sur toute l'application.
  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    accountApi
      .getPreferences()
      .then((preferences) => {
        if (cancelled) return;
        document.documentElement.classList.toggle("dark", preferences.theme === "dark");
        document.documentElement.dataset.locale = preferences.language;
        document.documentElement.dataset.currency = preferences.currency;
      })
      .catch(() => {
        // Préférences indisponibles : le thème local reste inchangé.
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  // Le rôle affiché provient uniquement du compte authentifié (champ "role"
  // renvoyé par l'API) : aucune valeur de rôle n'est conservée localement.
  const role = useMemo<Role>(() => normalizeRole(authUser?.role), [authUser]);

  // L'utilisateur affiché est toujours dérivé du compte réellement authentifié.
  // Aucune donnée de session n'est inventée ni conservée localement.
  const user = useMemo<SessionUser>(() => {
    if (!authUser) return emptySessionUser;
    const firstName = authUser.firstName ?? "";
    const lastName = authUser.lastName ?? "";
    const name = `${firstName} ${lastName}`.trim() || authUser.email || "";
    return {
      name,
      firstName,
      email: authUser.email ?? "",
      company: authUser.companyName ?? "",
      avatar: authUser.avatar ?? "",
      title: authUser.title ?? "",
      location: authUser.location ?? "",
    };
  }, [authUser]);

  const value = useMemo<UserContextValue>(
    () => ({
      role,
      user,
      authUser,
      status,
      login,
      verifyTwoFactor,
      register,
      logout,
      updateProfile,
      uploadAvatar,
      refreshUser,
      retrySession,
    }),
    [role, user, authUser, status, login, verifyTwoFactor, register, logout, updateProfile, uploadAvatar, refreshUser, retrySession],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const context = useContext(UserContext);
  if (!context) throw new Error("useUser must be used inside UserProvider");
  return context;
}
