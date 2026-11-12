/**
 * Verrou « un seul vol » (single-flight) pour les actions utilisateur.
 *
 * `busy` (état React) n'est visible qu'au rendu suivant : deux clics très
 * rapprochés peuvent donc déclencher deux fois la même action. `begin()` est
 * synchrone et renvoie `false` dès le second appel, ce qui bloque le doublon
 * avant toute requête réseau ou demande MetaMask.
 */
export type SingleFlight = {
  /** Réserve l'action. `true` si elle peut démarrer, `false` si elle tourne déjà. */
  begin: () => boolean;
  /** Libère l'action (à appeler dans `finally`). */
  end: () => void;
  /** Indique si une action est en cours. */
  isRunning: () => boolean;
};

export const createSingleFlight = (): SingleFlight => {
  let running = false;
  return {
    begin: () => {
      if (running) return false;
      running = true;
      return true;
    },
    end: () => {
      running = false;
    },
    isRunning: () => running,
  };
};
