"use client";
import { cn } from "@/lib/utils";
import { useFilters, type DateRangePreset } from "@/lib/filters";

const PRESETS: { value: Exclude<DateRangePreset, "custom">; label: string }[] = [
  { value: "today", label: "Aujourd'hui" },
  { value: "7d", label: "7 derniers jours" },
  { value: "thisMonth", label: "Mois en cours" },
  { value: "lastMonth", label: "Mois dernier" },
];

// Filtre de date global — partagé par tous les écrans via FilterProvider (lib/filters.tsx).
// Changer la plage ici met à jour toutes les vues qui appellent useFilters(), sans avoir
// à remonter ce composant ailleurs : il vit dans Topbar, déjà présent sur chaque page /ceo/*.
export default function DateRangeFilter() {
  const { dateFrom, dateTo, preset, setPreset, setDateFrom, setDateTo } = useFilters();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-1 bg-slate-50 rounded-lg p-1">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPreset(p.value)}
            className={cn(
              "px-2.5 py-1.5 text-xs rounded-md transition-colors",
              preset === p.value
                ? "bg-white text-slate-900 font-medium shadow-sm border border-slate-200"
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            {p.label}
          </button>
        ))}
        <span
          className={cn(
            "px-2.5 py-1.5 text-xs rounded-md",
            preset === "custom" ? "bg-white text-slate-900 font-medium shadow-sm border border-slate-200" : "text-slate-400"
          )}
        >
          Personnalisé
        </span>
      </div>

      <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
        <label className="text-xs text-slate-500">De</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          max={dateTo}
          className="px-2 py-1.5 text-xs bg-white text-slate-900 border border-slate-300 rounded-md hover:border-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
        />
        <label className="text-xs text-slate-500">À</label>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          min={dateFrom}
          className="px-2 py-1.5 text-xs bg-white text-slate-900 border border-slate-300 rounded-md hover:border-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
        />
      </div>
    </div>
  );
}
