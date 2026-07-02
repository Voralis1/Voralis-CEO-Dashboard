"use client";
import { useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { ALERTS, type Alert, type AlertLevel } from "@/lib/data";
import { AlertTriangle, Info, Bell, CheckCircle, Clock } from "lucide-react";

const levelConfig: Record<AlertLevel, { icon: React.ElementType; color: string; border: string; bg: string; label: string }> = {
  critical: { icon: AlertTriangle, color: "text-red-600", border: "border-l-red-500", bg: "bg-red-50", label: "Critique" },
  warning: { icon: AlertTriangle, color: "text-amber-600", border: "border-l-amber-500", bg: "bg-amber-50", label: "Avertissement" },
  info: { icon: Info, color: "text-blue-600", border: "border-l-blue-500", bg: "bg-blue-50", label: "Info" },
};

function AlertCard({ alert, onSnooze, onAck }: { alert: Alert; onSnooze: (id: string) => void; onAck: (id: string) => void }) {
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
          <button
            onClick={() => onAck(alert.id)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:border-slate-400 hover:text-slate-900 transition-all"
          >
            <CheckCircle size={11} />
            {alert.action}
          </button>
          <button
            onClick={() => onSnooze(alert.id)}
            className="text-xs px-3 py-1.5 text-slate-500 hover:text-slate-700 transition-colors"
          >
            Snoozer 24h
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>(ALERTS);

  const active = alerts.filter((a) => !a.snoozed);
  const snoozed = alerts.filter((a) => a.snoozed);

  const snooze = (id: string) => setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, snoozed: true } : a));
  const ack = (id: string) => setAlerts((prev) => prev.filter((a) => a.id !== id));

  const critical = active.filter((a) => a.level === "critical");
  const warnings = active.filter((a) => a.level === "warning");
  const info = active.filter((a) => a.level === "info");

  return (
    <div>
      <Topbar title="Centre d'alertes" subtitle="Détection automatique des blocages dans le funnel" />

      <div className="px-6 py-5 space-y-5">

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
                <AlertCard key={alert.id} alert={alert} onSnooze={snooze} onAck={ack} />
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
          <Section title={`Alertes snoozées (${snoozed.length})`}>
            <div className="space-y-2">
              {snoozed.map((alert) => (
                <div key={alert.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-100 opacity-70">
                  <Bell size={14} className="text-slate-500" />
                  <span className="text-xs text-slate-500 flex-1">{alert.title}</span>
                  <button
                    onClick={() => setAlerts((prev) => prev.map((a) => a.id === alert.id ? { ...a, snoozed: false } : a))}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    Réactiver
                  </button>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Alert rules reference */}
        <Section title="Référentiel des seuils d'alerte · par niveau funnel">
          <div className="grid grid-cols-2 gap-5">
            {[
              {
                level: "Niveau 1 · Acquisition",
                color: "#378add",
                rules: [
                  "CPL Angola > $1.00 → tester nouvelle créa",
                  "CPL Maroc > $2.50 MAD → audit ciblage",
                  "ROAS net < 1.5 sur 3 jours consécutifs → pause",
                  "CTR < 1% sur 1000 impressions → créa morte",
                  "Frequency Meta > 4 → saturation audience",
                ],
              },
              {
                level: "Niveau 2 · Qualification",
                color: "#1d9e75",
                rules: [
                  "Confirmation Angola < 55% → audit script agents",
                  "Confirmation Maroc < 60% → audit qualité leads",
                  "Délai lead → confirmation > 2h → vérifier file LV",
                  "Non-joignables > 30% → mauvais ciblage/numéros",
                  "Agent X confirmation 20% sous la moyenne → coaching",
                ],
              },
              {
                level: "Niveau 3 · Livraison",
                color: "#c9a227",
                rules: [
                  "Livraison Angola < 65% → audit motoboys",
                  "Livraison Maroc < 70% → audit partenaire logistique",
                  "Délai confirmation → livraison > 4 jours → stockout ?",
                  "RTO > 15% sur 7j → audit produit + promesse marketing",
                  "Stock < 7j couverture → réappro urgent",
                ],
              },
              {
                level: "Niveau 4 · Encaissement",
                color: "#e24b4a",
                rules: [
                  "Écart livraisons / cash reçu > 5% sur 7j → audit motoboys",
                  "Motoboy ratio cash < 85% sur 30+ courses → entretien",
                  "Délai livraison → encaissement > 2j → audit cycle remise",
                  "Cash IN = $0 + livraisons > 0 → ALERTE ROUGE",
                  "Cash remis < cash attendu de 10% sur 24h → investigation",
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
