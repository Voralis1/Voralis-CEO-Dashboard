"use client";
import { createContext, useContext, useState, ReactNode } from "react";

// SOURCE DE VÉRITÉ — quelle date chaque KPI utilise réellement quand une page consomme
// dateFrom/dateTo d'ici. Si docs/documentation-technique-dashboard.md diverge de ce tableau,
// c'est CE fichier qui fait foi (le tableau doc n'est qu'une vue de lecture, pas une seconde
// source). Risque si on se trompe : filtrer un KPI de revenu sur order_date au lieu de
// delivered_at/processed_at fausserait silencieusement tous les montants (règle COD : l'argent
// n'existe que sur commande livrée ET encaissée, jamais sur "créée" ou "confirmée").
//
//   Écran / KPI                                          Date de référence          Colonne source
//   ---------------------------------------------------  --------------------------  -------------------------------
//   Funnel (leads, confirmées, en attente, annulées,      Date de CRÉATION            order_date
//     rupture stock, doublons) — 4 réseaux logistiques
//   CA livré / revenu livré — mêmes 4 réseaux             Date de LIVRAISON            delivered_at (processed_at Shipsen)
//   Rentabilité / marge nette (/profitability)            Date de LIVRAISON            delivered_at / processed_at
//   Trésorerie — cash encaissé (/ceo)                     Date de LIVRAISON (proxy —    delivered_at / processed_at
//                                                          pas encore de date
//                                                          d'encaissement distincte)
//   Seuils de rentabilité (/thresholds)                   Date de LIVRAISON            delivered_at / processed_at
//   Copilot IA / Centre d'alertes                         Mixte : funnel=création,      order_date / delivered_at
//                                                          revenu=livraison
//   Payout affilié (CRM Voralis, /crm-voralis)            Date de CRÉATION (agrégat     externe, non stockée
//                                                          CRM, pas de date d'engagement
//                                                          individuelle)
//   Ad spend (Meta Ads, /meta-ads)                        Date de DÉPENSE              date (meta_ads_by_country)
//   Stock — quantités (/inventory)                        NON FILTRÉ — état courant     —
//   Stock — vélocité de vente (ventes moy./jour)          Date de LIVRAISON             delivered_at
//   Cash détenu "chez qui" (/ceo)                         NON FILTRÉ — snapshot         —
//   Cash rapatrié (statut)                                NON FILTRÉ — pas de date      —
//                                                          d'événement disponible

export type DateRangePreset = "today" | "7d" | "30d" | "thisMonth" | "lastMonth" | "custom";

function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}

// Bornes calculées côté client, au moment du clic — pas de recalcul impur pendant le rendu
// (voir react-hooks/purity : Date.now() ne doit pas être appelé dans le corps du composant).
export function computePresetRange(preset: Exclude<DateRangePreset, "custom">): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const today = toISODate(now);

  switch (preset) {
    case "today":
      return { dateFrom: today, dateTo: today };
    case "7d":
      return { dateFrom: toISODate(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)), dateTo: today };
    case "30d":
      return { dateFrom: toISODate(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)), dateTo: today };
    case "thisMonth":
      return { dateFrom: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: today };
    case "lastMonth": {
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      return { dateFrom: toISODate(lastMonthStart), dateTo: toISODate(lastMonthEnd) };
    }
  }
}

interface FilterState {
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;   // YYYY-MM-DD
  preset: DateRangePreset;
  setPreset: (preset: Exclude<DateRangePreset, "custom">) => void;
  setDateFrom: (date: string) => void;
  setDateTo: (date: string) => void;
}

const FilterContext = createContext<FilterState | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  // Valeur par défaut : 30 derniers jours. Lazy init (fonction passée à useState) pour ne
  // calculer la date qu'une seule fois, au montage, plutôt qu'à chaque rendu.
  const [{ dateFrom, dateTo }, setRange] = useState(() => computePresetRange("30d"));
  const [preset, setPresetState] = useState<DateRangePreset>("30d");

  function setPreset(next: Exclude<DateRangePreset, "custom">) {
    setRange(computePresetRange(next));
    setPresetState(next);
  }

  // Éditer une borne manuellement bascule sur "Personnalisé" — le preset actif ne doit
  // jamais mentir sur la plage réellement affichée.
  function setDateFrom(date: string) {
    setRange((prev) => ({ ...prev, dateFrom: date }));
    setPresetState("custom");
  }

  function setDateTo(date: string) {
    setRange((prev) => ({ ...prev, dateTo: date }));
    setPresetState("custom");
  }

  return (
    <FilterContext.Provider value={{ dateFrom, dateTo, preset, setPreset, setDateFrom, setDateTo }}>
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilters must be inside FilterProvider");
  return ctx;
}
