"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

// Contenu de la zone hors ligne : c'est le seul bloc affiché sous la navbar
// (aucun contenu de page, aucune donnée de session, pas de footer).
type Connection = "unknown" | "offline" | "online" | "restored";

function OfflineNotice() {
  const [connection, setConnection] = useState<Connection>("unknown");

  useEffect(() => {
    let timer: number | undefined;

    // Le service worker redirige une navigation échouée vers /offline?from=…
    // On retient la page demandée pour y revenir dès que le réseau revient.
    const params = new URLSearchParams(window.location.search);
    const from = params.get("from");
    const target =
      from && from.startsWith("/") && !from.startsWith("//") && !from.startsWith("/offline") ? from : null;

    const sync = () => setConnection(navigator.onLine ? "online" : "offline");
    const onOffline = () => setConnection("offline");
    const onOnline = () => {
      setConnection("restored");
      // Quand le service worker a répondu à une autre URL avec cet écran, on
      // rouvre la page demandée. Dans l'application, la coquille reprend la
      // main seule et ce minuteur est annulé au démontage.
      timer = window.setTimeout(() => {
        if (target) window.location.replace(target);
        else window.location.reload();
      }, 1400);
    };

    sync();
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  const status =
    connection === "restored"
      ? "Connection restored. Reloading the page…"
      : connection === "online"
        ? "You are connected. Reload the page to continue."
        : connection === "offline"
          ? "Waiting for your connection to come back. The page reloads automatically."
          : "Checking your connection…";

  return (
    <div className="editor-success offline-card">
      <span className="offline-icon">
        <Icon name="globe" size={26} />
      </span>
      <p className="offline-badge">Offline</p>
      <h1>You are not connected to the Internet</h1>
      <p className="offline-lead">
        FreelanceTN needs a connection to show your pages. Only the logo, the navigation and this message remain
        available.
      </p>
      <ul className="offline-list">
        <li>
          <Icon name="globe" size={15} />
          <span>No page of the application is displayed while the connection is down.</span>
        </li>
        <li>
          <Icon name="shield" size={15} />
          <span>Signing in, saving work, and loading fresh data need the Internet.</span>
        </li>
        <li>
          <Icon name="clock" size={15} />
          <span>The page reloads by itself as soon as the connection is back.</span>
        </li>
      </ul>
      <p className="offline-status" role="status" aria-live="polite">
        {status}
      </p>
      <div>
        <Button onClick={() => window.location.reload()}>Try again</Button>
        <Link className="btn btn-secondary" href="/">
          Back to home
        </Link>
      </div>
    </div>
  );
}

export { OfflineNotice };
