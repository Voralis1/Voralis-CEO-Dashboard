"use client";
import { createContext, useContext, useState, ReactNode } from "react";

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
