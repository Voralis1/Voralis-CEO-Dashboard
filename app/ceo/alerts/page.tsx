"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import { fetchNetworkOverview, computeAlerts, type Alert, type AlertLevel } from "@/lib/dashboardData";
import { AlertTriangle, Info, Bell, CheckCircle, Clock, Loader2 } from "lucide-react";

const levelConfig: Record<AlertLevel, { icon: React.ElementType; color: string; border: string; bg: string; label: string }> = {
  critical: { icon: AlertTriangle, color: "text-red-600", border: "border-l-red-500", bg: "bg-red-50", label: "Critique" },
  warning: { icon: AlertTriangle, color: "text-amber-600", border: "border-l-amber-500", bg: "bg-amber-50", label: "Avertissement" },
  info: { icon: Info, color: "text-blue-600", border: "border-l-blue-500", bg: "bg-blue-50", label: "Info" },
};

function AlertCard({ alert, onSnooze }: { alert: Alert; onSnooze: (id: string) => void }) {
  const cfg = levelConfig[alert.level];
  const Icon = cfg.icon;

  return (
    <div className={`flex gap-4 p-4 rounded-xl border border-slate-200 border-l-2 ${cfg.border} ${cfg.bg} transition-all`}>
      <div className={`mt-0.5 ${cfg.color} shrink-0`}>
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-4 mb-1">
          <p className="text-sm font-semibold text-slate-900">{alert.title}</p>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={alert.level === "critical" ? "red" : alert.level === "warning" ? "yellow" : "blue"}>
              {cfg.label}
            </Badge>
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Clock size={10} />{alert.timestamp}
            </span>
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-3">{alert.desc}</p>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700">
            {alert.action}
          </span>
          <button
            onClick={() => onSnooze(alert.id)}
            className="text-xs px-3 py-1.5 text-slate-500 hover:text-slate-700 transition-colors"
          >
            Masquer cette session
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const { dateFrom, dateTo } = useFilters();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [snoozedIds, setSnoozedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const overview = await fetchNetworkOverview(dateFrom, dateTo);
        if (!cancelled) setAlerts(computeAlerts(overview));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erreur inconnue");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo]);

  const active = alerts.filter((a) => !snoozedIds.has(a.id));
  const snoozed = alerts.filter((a) => snoozedIds.has(a.id));

  const snooze = (id: string) => setSnoozedIds((prev) => new Set(prev).add(id));
  const unsnooze = (id: string) =>
    setSnoozedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const critical = active.filter((a) => a.level === "critical");
  const warnings = active.filter((a) => a.level === "warning");
  const info = active.filter((a) => a.level === "info");

  return (
    <div>
      <Topbar title="Centre d'alertes" subtitle="Calculées en direct à partir des seuils sur les vraies métriques réseau" />

      <div className="px-6 py-5 space-y-5">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {loading && alerts.length === 0 && !error ? (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Calcul des alertes…</span>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Critiques", count: critical.length, color: "text-red-600", bg: "bg-red-50 border-red-200" },
                { label: "Avertissements", count: warnings.length, color: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
                { label: "Informations", count: info.length, color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
              ].map(({ label, count, color, bg }) => (
                <div key={label} className={`rounded-xl p-4 border ${bg}`}>
                  <p className={`text-2xl font-semibold ${color}`}>{count}</p>
                  <p className="text-xs text-slate-500 mt-1">{label} actives</p>
                </div>
              ))}
            </div>

            {/* Active alerts */}
            {active.length > 0 ? (
              <Section title={`Alertes actives (${active.length})`}>
                <div className="space-y-3">
                  {[...critical, ...warnings, ...info].map((alert) => (
                    <AlertCard key={alert.id} alert={alert} onSnooze={snooze} />
                  ))}
                </div>
              </Section>
            ) : (
              <Section>
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <CheckCircle size={32} className="text-emerald-500 mb-3" />
                  <p className="text-sm font-medium text-slate-900 mb-1">Aucune alerte active</p>
                  <p className="text-xs text-slate-500">Toutes les métriques sont dans les seuils définis.</p>
                </div>
              </Section>
            )}

            {/* Snoozed */}
            {snoozed.length > 0 && (
              <Section title={`Masquées cette session (${snoozed.length})`}>
                <div className="space-y-2">
                  {snoozed.map((alert) => (
                    <div key={alert.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-100 opacity-70">
                      <Bell size={14} className="text-slate-500" />
                      <span className="text-xs text-slate-500 flex-1">{alert.title}</span>
                      <button
                        onClick={() => unsnooze(alert.id)}
                        className="text-xs text-slate-500 hover:text-slate-700"
                      >
                        Réactiver
                      </button>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}

        {/* Alert rules reference */}
        <Section title="Référentiel des seuils d'alerte">
          <div className="grid grid-cols-2 gap-5">
            {[
              {
                level: "Acquisition · Meta Ads",
                color: "#378add",
                rules: [
                  "Dépense > $20 sans un seul lead → alerte critique",
                  "CPL > $3 → avertissement",
                ],
              },
              {
                level: "Qualification · Confirmation",
                color: "#1d9e75",
                rules: [
                  "Taux de confirmation < 30% → critique",
                  "Taux de confirmation < 45% → avertissement",
                  "Appliqué à Shipsen, Coliscod Angola, Africod Congo, ClickMarket",
                ],
              },
              {
                level: "Livraison",
                color: "#c9a227",
                rules: [
                  "Taux de livraison < 40% → critique",
                  "Taux de livraison < 55% → avertissement",
                  "Appliqué à Shipsen, Coliscod Angola, Africod Congo, ClickMarket",
                ],
              },
              {
                level: "Synchronisation",
                color: "#e24b4a",
                rules: [
                  "Erreur de lecture d'une source de données → info",
                  "Voir la page Sources pour le détail du statut par intégration",
                ],
              },
            ].map(({ level, color, rules }) => (
              <div key={level}>
                <p className="text-xs font-semibold mb-2" style={{ color }}>{level}</p>
                <ul className="space-y-1.5">
                  {rules.map((rule) => (
                    <li key={rule} className="flex items-start gap-2 text-xs text-slate-500">
                      <span className="w-1 h-1 rounded-full mt-1.5 shrink-0" style={{ background: color }} />
                      {rule}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
