"use client";

import { ClientPostPage } from "@/components/views/client/ClientPostPage";
import { useApp } from "@/context/AppContext";
import { useMarketplace } from "@/context/MarketplaceContext";
import { useUser } from "@/context/UserContext";

export default function ClientPostRoutePage() {
  const { go, notify } = useApp();
  const { addProject } = useMarketplace();
  const { user } = useUser();
  return (
    <ClientPostPage
      go={go}
      notify={notify}

      onPublish={async (project) => {
        try {
          // Le projet est publié dès sa création : il est visible par tous les
          // freelances dans le catalogue des opportunités.
          const created = await addProject({ ...project, status: "Open", client: user.name });
          notify(`"${created.title}" is now live`);
          return created;
        } catch (err) {
          // L'erreur est affichée dans le formulaire : elle n'est pas masquée
          // derrière une simple notification.
          throw err instanceof Error ? err : new Error("Impossible de publier le projet.");
        }
      }}
    />
  );
}
