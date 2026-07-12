"use client";
import DateRangeFilter from "@/components/layout/DateRangeFilter";
import { RefreshCw } from "lucide-react";

interface TopbarProps {
  title: string;
  subtitle?: string;
  hideDateFilter?: boolean;
}

export default function Topbar({ title, subtitle, hideDateFilter }: TopbarProps) {
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

      {!hideDateFilter && (
        <div className="flex flex-wrap items-center gap-3">
          <DateRangeFilter />
        </div>
      )}
    </header>
  );
}
