"use client";

import { useEffect, useState } from "react";

// État de connexion du navigateur, partagé par la coquille applicative : dès
// que le réseau tombe, l'interface bascule sur l'écran hors ligne.
export function useOnline() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return online;
}
