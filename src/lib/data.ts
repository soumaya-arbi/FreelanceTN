import type {
  Freelancer,
  Invoice,
  Project,
  Quote,
  Task,
} from "@/lib/types";

export const CURRENCY = "TND";

// Aucune donnée métier n'est stockée dans ce fichier : freelances,
// projets, clients, tâches, devis, factures, avis et portfolios proviennent
// exclusivement de l'API (MongoDB) ou restent vides tant qu'aucune source
// réelle n'existe. Les tableaux ci-dessous doivent le rester.
export const avatars: string[] = [];

export const freelancers: Freelancer[] = [];

export const projects: Project[] = [];

// Taxonomie de navigation (filtres uniquement). Aucun décompte n'est inventé :
// le second champ décrit la catégorie, il ne compte aucun élément.
export const categories: string[][] = [
  ["Design & Creative", "Brand identity, UX and visual design", "🎨"],
  ["Programming & Technology", "Web, mobile and AI development", "💻"],
  ["Marketing", "Acquisition, content and growth", "📣"],
  ["Writing & Translation", "Copywriting, editing and localisation", "✍️"],
  ["Video & Animation", "Motion, editing and 3D production", "🎬"],
  ["Business & Consulting", "Strategy, finance and operations", "📊"],
];

export const clients: string[] = [];

export const initialTasks: Task[] = [];
export const initialQuotes: Quote[] = [];
export const initialInvoices: Invoice[] = [];