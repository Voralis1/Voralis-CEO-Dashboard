import { cn } from "@/lib/utils";
import { ReactNode } from "react";

// ─── KPI CARD ─────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaUp?: boolean;
  icon?: ReactNode;
  accent?: string;
}

export function KpiCard({ label, value, delta, deltaUp, icon, accent }: KpiCardProps) {
  return (
    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
      {icon && <div className="mb-2 text-slate-400">{icon}</div>}
      <p className="text-xs text-slate-500 font-medium mb-1">{label}</p>
      <p
        className="text-2xl font-semibold tracking-tight"
        style={accent ? { color: accent } : { color: "#0f172a" }}
      >
        {value}
      </p>
      {delta && (
        <p className={cn("text-xs mt-1", deltaUp ? "text-emerald-600" : "text-red-600")}>
          {delta}
        </p>
      )}
    </div>
  );
}

// ─── BADGE ────────────────────────────────────────────────────────────────

type BadgeVariant = "green" | "yellow" | "red" | "blue" | "gray";

interface BadgeProps {
  children: ReactNode;
  variant: BadgeVariant;
  className?: string;
}

const badgeStyles: Record<BadgeVariant, string> = {
  green: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  yellow: "bg-amber-50 text-amber-700 border border-amber-200",
  red: "bg-red-50 text-red-700 border border-red-200",
  blue: "bg-blue-50 text-blue-700 border border-blue-200",
  gray: "bg-slate-100 text-slate-600 border border-slate-200",
};

export function Badge({ children, variant, className }: BadgeProps) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", badgeStyles[variant], className)}>
      {children}
    </span>
  );
}

// ─── DECISION PILL ────────────────────────────────────────────────────────

const decisionStyles = {
  scale: "bg-emerald-50 text-emerald-700 border border-emerald-300",
  hold: "bg-amber-50 text-amber-700 border border-amber-300",
  stop: "bg-red-50 text-red-700 border border-red-300",
};

const decisionLabels = {
  scale: "⬆ Scaler",
  hold: "→ Maintenir",
  stop: "⬇ Arrêter",
};

export function DecisionPill({ decision }: { decision: "scale" | "hold" | "stop" }) {
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium", decisionStyles[decision])}>
      {decisionLabels[decision]}
    </span>
  );
}

// ─── SECTION ──────────────────────────────────────────────────────────────

interface SectionProps {
  title?: string;
  titleRight?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Section({ title, titleRight, children, className }: SectionProps) {
  return (
    <div className={cn("bg-white border border-slate-200 rounded-xl p-5 shadow-sm", className)}>
      {title && (
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {titleRight && <div>{titleRight}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── PROGRESS BAR ─────────────────────────────────────────────────────────

interface ProgressBarProps {
  value: number;
  max?: number;
  color?: string;
  className?: string;
}

export function ProgressBar({ value, max = 100, color = "#1d9e75", className }: ProgressBarProps) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className={cn("h-1.5 bg-slate-200 rounded-full overflow-hidden", className)}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

// ─── STATUS DOT ───────────────────────────────────────────────────────────

const statusDotColors = {
  ok: "bg-emerald-400",
  warning: "bg-amber-400",
  error: "bg-red-400",
};

export function StatusDot({ status }: { status: "ok" | "warning" | "error" }) {
  return (
    <span className={cn("inline-block w-2 h-2 rounded-full", statusDotColors[status])} />
  );
}
