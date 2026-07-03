"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section } from "@/components/ui";
import { Database, Clock, CheckCircle, AlertTriangle, XCircle, Loader2 } from "lucide-react";

type SourceStatus = "ok" | "warning" | "error";

interface DataSourceStatus {
  id: string;
  name: string;
  status: SourceStatus;
  detail: string;
  lastSync: string;
}

const statusConfig: Record<SourceStatus, { icon: typeof CheckCircle; color: string; label: string }> = {
  ok: { icon: CheckCircle, color: "text-emerald-600", label: "Connecté" },
  warning: { icon: AlertTriangle, color: "text-amber-600", label: "Aucune donnée" },
  error: { icon: XCircle, color: "text-red-600", label: "Erreur" },
};

export default function ConnectionsPage() {
  const [sources, setSources] = useState<DataSourceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/data-sources");
        const json = await res.json();
        if (!cancelled) setSources(json.sources ?? []);
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
  }, []);

  const okCount = sources.filter((d) => d.status === "ok").length;
  const warnCount = sources.filter((d) => d.status === "warning").length;
  const errCount = sources.filter((d) => d.status === "error").length;

  return (
    <div>
      <Topbar title="Sources de données" subtitle="Statut du pipeline · n8n → Supabase → Next.js" />

      <div className="px-6 py-5 space-y-5">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {loading && sources.length === 0 && !error ? (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Vérification des sources…</span>
          </div>
        ) : (
          <>
            {/* Status summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-xl p-4 bg-emerald-50 border border-emerald-200">
                <div className="flex items-center gap-2 mb-2"><CheckCircle size={14} className="text-emerald-600" /><span className="text-xs text-emerald-600 font-medium">Connectés</span></div>
                <p className="text-2xl font-semibold text-emerald-700">{okCount}</p>
              </div>
              <div className="rounded-xl p-4 bg-amber-50 border border-amber-200">
                <div className="flex items-center gap-2 mb-2"><AlertTriangle size={14} className="text-amber-600" /><span className="text-xs text-amber-600 font-medium">Sans donnée</span></div>
                <p className="text-2xl font-semibold text-amber-700">{warnCount}</p>
              </div>
              <div className="rounded-xl p-4 bg-red-50 border border-red-200">
                <div className="flex items-center gap-2 mb-2"><XCircle size={14} className="text-red-600" /><span className="text-xs text-red-600 font-medium">En erreur</span></div>
                <p className="text-2xl font-semibold text-red-700">{errCount}</p>
              </div>
            </div>

            {/* Sources grid */}
            <Section title="Sources de données · statut temps réel">
              <div className="grid grid-cols-2 gap-3">
                {sources.map((src) => {
                  const cfg = statusConfig[src.status];
                  const Icon = cfg.icon;
                  return (
                    <div key={src.id} className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="w-9 h-9 rounded-lg bg-slate-200 flex items-center justify-center shrink-0">
                        <Database size={16} className="text-slate-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className="text-sm font-semibold text-slate-900 truncate">{src.name}</p>
                          <div className={`flex items-center gap-1 shrink-0 ${cfg.color}`}>
                            <Icon size={12} />
                            <span className="text-[10px]">{cfg.label}</span>
                          </div>
                        </div>
                        <p className="text-xs text-slate-500 mb-2">{src.detail}</p>
                        <div className="flex items-center gap-3 text-[10px] text-slate-400">
                          <span className="flex items-center gap-1"><Clock size={9} /> {src.lastSync}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          </>
        )}

        {/* Architecture */}
        <Section title="Architecture technique · pipeline de données">
          <div className="font-mono text-xs text-slate-500 bg-white rounded-xl p-5 border border-slate-200 leading-6 overflow-x-auto">
            <pre>{`
SOURCES                          ORCHESTRATEUR           BASE DE DONNÉES
─────────────────────────────    ──────────────────      ──────────────────────
Meta Ads API           ────┐     n8n (self-hosted)       Supabase PostgreSQL
Shipsen (4 warehouses) ────┤     Workflows par source ──► meta_ads_by_country
Coliscod Angola        ────┤ ──► login + pagination         shipsen_orders
Africod Congo          ────┤     upsert par lots               coliscod_leads
ClickMarket            ────┘     Cron (30 min)                 africod_congo_leads
CRM Voralis (proxy) ─────────────────────────────►              clickmarket_leads
                                                          Vues / RPC par réseau :
                                                          kpi_<réseau>_marche_periode
                                                          shipsen_kpi_by_country
                                 ▼
                         Supabase PostgREST (API REST auto) + RLS
                                 ▼
                         Next.js App Router
                         /ceo               → Trésorerie
                         /ceo/profitability → Rentabilité
                         /ceo/alerts        → Alertes (calculées en direct)
                         /ceo/connections   → Sources (statut en direct)
            `}</pre>
          </div>
        </Section>
      </div>
    </div>
  );
}
