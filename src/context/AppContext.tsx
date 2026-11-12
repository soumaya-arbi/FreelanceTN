"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useOnline } from "@/hooks/useOnline";
import { useUser } from "@/context/UserContext";
import { Icon } from "@/components/ui/Icon";
import { Header } from "@/components/ui/Header";
import { OfflineNotice } from "@/components/views/OfflineNotice";
import { clientProcessPath, editorPath, isPublicPath, pathFor } from "@/lib/navigation";
import type { ClientProcessMode, EditorMode, Page, Project } from "@/lib/types";

type AppContextValue = {
  dark: boolean;
  setDark: (value: boolean) => void;
  toast: string;
  notify: (message: string) => void;
  go: (page: Page) => void;
  goBack: () => void;
  openProject: (project: Project) => void;
  openEditor: (mode: EditorMode) => void;
  openClientProcess: (mode: ClientProcessMode) => void;
  openAuth: () => void;
  invitee: string;
  setInvitee: (name: string) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { role } = useUser();
  const [dark, setDark] = useLocalStorage<boolean>("freelance-tn-dark", false);
  const [toast, setToast] = useState("");
  const [invitee, setInvitee] = useState("");

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout((window as unknown as { __freelanceToast?: number }).__freelanceToast);
    (window as unknown as { __freelanceToast?: number }).__freelanceToast = window.setTimeout(() => setToast(""), 2600);
  }, []);

  const go = useCallback(
    (page: Page) => {
      router.push(pathFor(page, role, invitee));
    },
    [router, role, invitee],
  );

  const goBack = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }, [router]);

  const openProject = useCallback(
    (project: Project) => {
      router.push(`/projects/${project.id}`);
    },
    [router],
  );

  const openEditor = useCallback((mode: EditorMode) => router.push(editorPath(mode)), [router]);
  const openClientProcess = useCallback((mode: ClientProcessMode) => router.push(clientProcessPath(mode)), [router]);
  const openAuth = useCallback(() => router.push("/login"), [router]);

  const value = useMemo<AppContextValue>(
    () => ({
      dark,
      setDark,
      toast,
      notify,
      go,
      goBack,
      openProject,
      openEditor,
      openClientProcess,
      openAuth,
      invitee,
      setInvitee,
    }),
    [dark, setDark, toast, notify, go, goBack, openProject, openEditor, openClientProcess, openAuth, invitee],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}

export function AppFrame({ children }: { children: React.ReactNode }) {
  const { dark, setDark, toast, go, goBack, openAuth } = useApp();
  const pathname = usePathname();
  // Une coupure peut survenir alors qu'une page est déjà affichée (dashboard,
  // listes, etc.). Dans ce cas le service worker n'intervient pas : on masque
  // tout le contenu de la page et on ne laisse que le chrome offline minimal.
  // Le contenu d'origine revient automatiquement au retour du réseau.
  const online = useOnline();

  // Un message d'échec ne doit pas s'afficher avec une coche verte.
  const toastIsError =
    /(indisponible|erreur|échec|échou|refus|rejet|impossible|invalide|expir|non abouti|introuvable|insuffisant|incorrect|ne peut pas|n'a pas pu)/i.test(
      toast,
    );

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [pathname]);

  const offlineRoute = pathname === "/offline";
  const showOffline = !online && !offlineRoute;
  const publicRoute = isPublicPath(pathname);
  const adminRoute = pathname.startsWith("/admin");
  const backClass = publicRoute ? "public-back" : adminRoute ? "admin-back" : "workspace-back";
  const showBack =
    online &&
    pathname !== "/" &&
    pathname !== "/offline" &&
    pathname !== "/login" &&
    pathname !== "/register" &&
    pathname !== "/onboarding/role" &&
    pathname !== "/verify-email" &&
    pathname !== "/reset-password";

  return (
    <div className={dark ? "app dark" : "app"}>
      {showOffline ? (
        <>
          <Header go={go} dark={dark} setDark={setDark} openAuth={openAuth} />
          <main className="container offline-main">
            <OfflineNotice />
          </main>
        </>
      ) : (
        children
      )}
      {online && toast && (
        <div className={toastIsError ? "toast is-error" : "toast"}>
          <span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {toastIsError ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="m5 12 4 4L19 6" />}
            </svg>
          </span>
          {toast}
        </div>
      )}
      {showBack && (
        <button className={`global-back ${backClass}`} onClick={goBack} aria-label="Go back to previous screen">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: "rotate(180deg)" }}>
            <path d="M5 12h14" />
            <path d="m13 6 6 6-6 6" />
          </svg>
          Back
        </button>
      )}
      <PwaRegister />
    </div>
  );
}

function PwaRegister() {
  const [updateReady, setUpdateReady] = useState(false);
  // Un rechargement n'est déclenché que par une action explicite : on retient
  // l'état « il y avait déjà un contrôleur » pour éviter de proposer un
  // rechargement lors de la première installation (aucun contrôleur actif).
  const hadController = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;

    const watchRegistration = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        setUpdateReady(true);
      }
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            setUpdateReady(true);
          }
        });
      });
    };

    const onControllerChange = () => {
      // Le nouveau service worker a pris le contrôle après un skipWaiting :
      // l'ancien code est encore chargé dans l'onglet, on invite à recharger.
      if (hadController.current) setUpdateReady(true);
    };

    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        if (cancelled) return;
        hadController.current = Boolean(navigator.serviceWorker.controller);
        watchRegistration(registration);
      })
      .catch(() => {
        // The app still works if service worker registration is unavailable.
      });

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const reload = () => {
    setUpdateReady(false);
    window.location.reload();
  };

  if (!updateReady) return null;

  return (
    <div className="pwa-update" role="status" aria-live="polite">
      <span>A new version of FreelanceTN is ready.</span>
      <button onClick={reload}>Reload</button>
      <button className="pwa-update-dismiss" onClick={() => setUpdateReady(false)} aria-label="Dismiss">
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}
