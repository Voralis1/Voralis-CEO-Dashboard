"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, KpiCard } from "@/components/ui";
import SpendChart from "@/components/charts/SpendChart";
import { useFilters } from "@/lib/filters";
import { fetchNetworkOverview, fmtCurrency, type NetworkOverview } from "@/lib/dashboardData";
import { fmtUSD } from "@/lib/data";
import {
  ArrowDownCircle, ArrowUpCircle, DollarSign,
  TrendingUp, Users, Truck, AlertTriangle, Loader2,
} from "lucide-react";

const COUNTRY_FLAGS: Record<string, string> = {
  Angola: "🇦🇴", Maroc: "🇲🇦", Sénégal: "🇸🇳", "Côte d'Ivoire": "🇨🇮", Mali: "🇲🇱",
  Gabon: "🇬🇦", Guinée: "🇬🇳", "Congo-Brazza": "🇨🇬", Congo: "🇨🇬", Senegal: "🇸🇳",
  "Cote d'Ivoire": "🇨🇮", Guinea: "🇬🇳",
};

const SPEND_COLORS = ["#378add", "#1d9e75", "#c9a227", "#ef9f27", "#888780", "#e24b4a"];

export default function TresoreriePage() {
  const { dateFrom, dateTo } = useFilters();
  const [overview, setOverview] = useState<NetworkOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const data = await fetchNetworkOverview(dateFrom, dateTo);
        if (!cancelled) setOverview(data);
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

  if (error) {
    return (
      <div>
        <Topbar title="Trésorerie" subtitle="Combien rentre, combien sort — par réseau et par pays" />
        <div className="px-6 py-5">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (loading || !overview) {
    return (
      <div>
        <Topbar title="Trésorerie" subtitle="Combien rentre, combien sort — par réseau et par pays" />
        <div className="px-6 flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Chargement des données…</span>
        </div>
      </div>
    );
  }

  const networkRows = overview.networks.flatMap((net) =>
    net.rows.map((row) => ({ network: net.network, currency: net.currency, ...row }))
  );

  const totalMetaSpend = overview.metaAds.reduce((s, r) => s + (r.spend ?? 0), 0);
  const totalMetaLeads = overview.metaAds.reduce((s, r) => s + (r.leads ?? 0), 0);
  const avgCpl = totalMetaLeads > 0 ? totalMetaSpend / totalMetaLeads : 0;

  const totalOrders =
    networkRows.reduce((s, r) => s + r.total_leads, 0) + (overview.shipsen.global?.total_orders_all ?? 0);
  const totalConfirmed =
    networkRows.reduce((s, r) => s + r.confirmes, 0) + (overview.shipsen.global?.total_confirmed_orders ?? 0);
  const globalConfirmationRate = totalOrders > 0 ? Math.round((totalConfirmed / totalOrders) * 1000) / 10 : 0;

  const rowsWithDeliveryRate = networkRows.filter((r) => r.taux_livraison != null);
  const avgDeliveryRate =
    rowsWithDeliveryRate.length > 0
      ? Math.round(rowsWithDeliveryRate.reduce((s, r) => s + (r.taux_livraison ?? 0), 0) / rowsWithDeliveryRate.length)
      : 0;

  const spendByCountryMap = new Map<string, number>();
  for (const row of overview.metaAds) {
    spendByCountryMap.set(row.country, (spendByCountryMap.get(row.country) ?? 0) + row.spend);
  }
  const spendByCountry = [...spendByCountryMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => ({ name, value, color: SPEND_COLORS[i % SPEND_COLORS.length] }));

  // Revenus confirmés par réseau, groupés par pays — jamais additionnés entre devises différentes.
  const revenueRows = [
    ...networkRows.map((r) => ({ network: r.network, country: r.country_name, currency: r.currency, revenue: r.ca_livre })),
    ...overview.shipsen.byCountry.map((r) => ({ network: "Shipsen", country: r.country, currency: r.currency, revenue: r.revenue_confirmed })),
  ].sort((a, b) => b.revenue - a.revenue);

  return (
    <div>
      <Topbar
        title="Trésorerie"
        subtitle="Combien rentre, combien sort — par réseau et par pays (devises non additionnées)"
      />

      <div className="px-6 py-5 space-y-5">
        {/* Cash hero */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl p-5 border" style={{ background: "#ecfdf5", borderColor: "#1d9e75" }}>
            <div className="flex items-center gap-2 mb-3">
              <ArrowDownCircle size={16} className="text-emerald-600" />
              <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">Cash IN</span>
            </div>
            <p className="text-2xl font-semibold text-emerald-700">{totalConfirmed.toLocaleString("fr-FR")} commandes confirmées</p>
            <p className="text-xs text-emerald-600 mt-1.5">
              Revenus par réseau/pays ci-dessous — chaque devise reste séparée, jamais additionnée.
            </p>
          </div>

          <div className="rounded-xl p-5 border" style={{ background: "#fef2f2", borderColor: "#e24b4a" }}>
            <div className="flex items-center gap-2 mb-3">
              <ArrowUpCircle size={16} className="text-red-600" />
              <span className="text-xs font-semibold text-red-600 uppercase tracking-wide">Cash OUT</span>
            </div>
            <p className="text-3xl font-semibold text-red-700">{fmtUSD(totalMetaSpend)}</p>
            <p className="text-xs text-red-600 mt-1.5">Dépense publicitaire Meta Ads (seul coût réel suivi actuellement)</p>
          </div>
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-2 gap-4">
          <Section title="Revenus confirmés par réseau et par pays">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    {["Réseau", "Pays", "Revenus confirmés"].map((h) => (
                      <th key={h} className="text-left px-3 py-2 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {revenueRows.map((r) => (
                    <tr key={`${r.network}-${r.country}`} className="border-b border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{r.network}</td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2 font-medium text-slate-900">
                          <span className="text-base">{COUNTRY_FLAGS[r.country] ?? "🌍"}</span>
                          {r.country}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-700">{fmtCurrency(r.revenue, r.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Dépense Meta Ads par pays">
            {spendByCountry.length > 0 ? (
              <>
                <SpendChart data={spendByCountry} />
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  {spendByCountry.map(({ name, color }) => (
                    <div key={name} className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
                      <span className="text-[10px] text-slate-500">{name}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">Aucune donnée Meta Ads pour cette période.</p>
            )}
          </Section>
        </div>

        {/* KPIs strip */}
        <Section title="KPIs clés">
          <div className="grid grid-cols-4 gap-3">
            <KpiCard
              label="Commandes confirmées"
              value={totalConfirmed.toLocaleString("fr-FR")}
              icon={<Users size={14} />}
            />
            <KpiCard
              label="CPL moyen (Meta Ads)"
              value={`$${avgCpl.toFixed(2)}`}
              icon={<DollarSign size={14} />}
            />
            <KpiCard
              label="Taux confirmation global"
              value={`${globalConfirmationRate}%`}
              icon={<TrendingUp size={14} />}
            />
            <KpiCard
              label="Taux livraison moyen"
              value={`${avgDeliveryRate}%`}
              icon={<Truck size={14} />}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}
