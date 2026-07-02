import Topbar from "@/components/layout/Topbar";
import { Section, Badge, StatusDot } from "@/components/ui";
import { DATA_SOURCES } from "@/lib/data";
import { Database, Zap, Clock, CheckCircle, AlertTriangle, XCircle } from "lucide-react";

const statusConfig = {
  ok: { icon: CheckCircle, color: "text-emerald-600", label: "Connecté" },
  warning: { icon: AlertTriangle, color: "text-amber-600", label: "Avertissement" },
  error: { icon: XCircle, color: "text-red-600", label: "Non configuré" },
};

export default function ConnectionsPage() {
  const okCount = DATA_SOURCES.filter((d) => d.status === "ok").length;
  const warnCount = DATA_SOURCES.filter((d) => d.status === "warning").length;
  const errCount = DATA_SOURCES.filter((d) => d.status === "error").length;

  return (
    <div>
      <Topbar title="Sources de données" subtitle="Statut du pipeline · n8n → Supabase → Next.js" />

      <div className="px-6 py-5 space-y-5">

        {/* Status summary */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl p-4 bg-emerald-50 border border-emerald-200">
            <div className="flex items-center gap-2 mb-2"><CheckCircle size={14} className="text-emerald-600" /><span className="text-xs text-emerald-600 font-medium">Connectés</span></div>
            <p className="text-2xl font-semibold text-emerald-700">{okCount}</p>
          </div>
          <div className="rounded-xl p-4 bg-amber-50 border border-amber-200">
            <div className="flex items-center gap-2 mb-2"><AlertTriangle size={14} className="text-amber-600" /><span className="text-xs text-amber-600 font-medium">Avertissements</span></div>
            <p className="text-2xl font-semibold text-amber-700">{warnCount}</p>
          </div>
          <div className="rounded-xl p-4 bg-red-50 border border-red-200">
            <div className="flex items-center gap-2 mb-2"><XCircle size={14} className="text-red-600" /><span className="text-xs text-red-600 font-medium">Non configurés</span></div>
            <p className="text-2xl font-semibold text-red-700">{errCount}</p>
          </div>
        </div>

        {/* Sources grid */}
        <Section title="Sources de données · statut temps réel">
          <div className="grid grid-cols-2 gap-3">
            {DATA_SOURCES.map((src) => {
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
                      {src.latency && <span className="flex items-center gap-1"><Zap size={9} /> {src.latency}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* Architecture */}
        <Section title="Architecture technique · pipeline de données">
          <div className="font-mono text-xs text-slate-500 bg-white rounded-xl p-5 border border-slate-200 leading-6 overflow-x-auto">
            <pre>{`
SOURCES                          ORCHESTRATEUR           BASE DE DONNÉES
─────────────────────────────    ──────────────────      ──────────────────────
Meta Ads API         ──────┐     n8n (self-hosted)       Supabase PostgreSQL
LeadVertex Excel     ──────┤ ──► Workflows par source ──► tables: ads_spend
Angola Google Sheet  ──────┤     Auth + refresh tokens        leads / orders
TikTok Ads API       ──────┤     Cron / Webhooks             deliveries
Instagram / FB API   ──────┤     Normalisation devise         cash_movements
App Motoboys         ──────┤     Calcul ROAS net              fx_rates
Comptabilité (saisie)──────┘     Détection alertes            alerts
Exchange Rates API                                        Vues matérialisées:
                                                           v_pnl_country_daily
                                                           v_roas_net_creative
                                 ▼
                         Supabase PostgREST (API REST auto)
                         + RLS (accès CEO + analyst seulement)
                         + Edge Functions (calculs complexes)
                                 ▼
                         Next.js App Router (Vercel)
                         /ceo              → Trésorerie
                         /ceo/profitability → Rentabilité
                         /ceo/alerts       → Alertes
                         /ceo/team         → Équipe
                         /ceo/connections  → Sources
                                 ▼
                         Gemini via OpenRouter
                         Recommandations IA quotidiennes
                         Prédiction cashflow 14j
            `}</pre>
          </div>
        </Section>

        {/* Integration roadmap */}
        <Section title="Plan d'intégration · 4 mois">
          <div className="space-y-3">
            {[
              {
                month: "Mois 1", label: "Audit, architecture, MVP Trésorerie",
                items: ["Schéma Supabase + RLS", "Next.js scaffolding Vercel", "Meta Ads → Supabase (workflow n8n)", "MVP Cash IN manuel + Cash OUT Meta"],
                done: true,
              },
              {
                month: "Mois 2", label: "Intégrations canaux",
                items: ["TikTok Ads API (app review)", "Facebook / Instagram organique", "LeadVertex webhooks + polling", "App motoboys v1 (Appsheet, 3 pilotes)"],
                done: false,
                inProgress: true,
              },
              {
                month: "Mois 3", label: "Modules financiers avancés",
                items: ["Module Rentabilité complet (pays/produit/créa)", "Module Alertes automatiques (4 niveaux)", "P&L hebdo + mensuel PDF", "FGMED Maroc intégré"],
                done: false,
              },
              {
                month: "Mois 4", label: "IA, tests, production",
                items: ["Recommandations IA quotidiennes (Gemini)", "Prédiction cashflow 14j", "Suite de tests n8n", "Formation Ossama + superviseurs"],
                done: false,
              },
            ].map(({ month, label, items, done, inProgress }) => (
              <div key={month} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${done ? "bg-emerald-50 text-emerald-700" : inProgress ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                    {done ? "✓" : month.replace("Mois ", "M")}
                  </div>
                  <div className="w-px flex-1 bg-slate-200 mt-2" />
                </div>
                <div className="pb-4 flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-sm font-semibold text-slate-900">{month} · {label}</p>
                    {done && <Badge variant="green">Terminé</Badge>}
                    {inProgress && <Badge variant="yellow">En cours</Badge>}
                  </div>
                  <ul className="space-y-1">
                    {items.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-xs text-slate-500">
                        <span className={`w-1 h-1 rounded-full ${done ? "bg-emerald-500" : inProgress ? "bg-amber-500" : "bg-slate-400"}`} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </Section>

      </div>
    </div>
  );
}
