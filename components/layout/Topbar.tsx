"use client";
import { useFilters } from "@/lib/filters";
import { RefreshCw } from "lucide-react";

interface TopbarProps {
  title: string;
  subtitle?: string;
}

export default function Topbar({ title, subtitle }: TopbarProps) {
  const { dateFrom, dateTo, setDateFrom, setDateTo } = useFilters();

  return (
    <header className="flex flex-col gap-3 px-6 pt-6 pb-4 border-b border-slate-200">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <button className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300">
          <RefreshCw size={12} />
          Actualiser
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Date Range */}
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
    </header>
  );
}
