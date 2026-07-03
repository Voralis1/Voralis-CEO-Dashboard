"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import { fetchNetworkOverview, fmtCurrency, type NetworkOverview } from "@/lib/dashboardData";
import { fmtUSD } from "@/lib/data";
import { AlertTriangle, Loader2 } from "lucide-react";

const COUNTRY_FLAGS: Record<string, string> = {
  Angola: "🇦🇴", Maroc: "🇲🇦", Sénégal: "🇸🇳", "Côte d'Ivoire": "🇨🇮", Mali: "🇲🇱",
  Gabon: "🇬🇦", Guinée: "🇬🇳", "Congo-Brazza": "🇨🇬", Congo: "🇨🇬", Senegal: "🇸🇳",
  "Cote d'Ivoire": "🇨🇮", Guinea: "🇬🇳",
};

export default function ProfitabilityPage() {
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
        <Topbar title="Rentabilité" subtitle="Performance réelle par réseau et par pays" />
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
        <Topbar title="Rentabilité" subtitle="Performance réelle par réseau et par pays" />
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

  const totalLeads =
    networkRows.reduce((s, r) => s + r.total_leads, 0) + (overview.shipsen.global?.total_orders_all ?? 0);
  const totalConfirmed =
    networkRows.reduce((s, r) => s + r.confirmes, 0) + (overview.shipsen.global?.total_confirmed_orders ?? 0);
  const globalConfirmationRate = totalLeads > 0 ? Math.round((totalConfirmed / totalLeads) * 1000) / 10 : 0;

  const sortedNetworkRows = [...networkRows].sort((a, b) => b.confirmes - a.confirmes);

  return (
    <div>
      <Topbar title="Rentabilité" subtitle="Performance réelle par réseau et par pays — devises jamais additionnées entre elles" />

      <div className="px-6 py-5 space-y-5">
        {/* Summary */}
        <div className="grid grid-cols-4 gap-4">
          <Section title="Total commandes (tous réseaux)">
            <p className="text-2xl font-semibold text-slate-900 mt-1">{totalLeads.toLocaleString("fr-FR")}</p>
          </Section>
          <Section title="Total confirmées">
            <p className="text-2xl font-semibold text-emerald-600 mt-1">{totalConfirmed.toLocaleString("fr-FR")}</p>
          </Section>
          <Section title="Taux de confirmation global">
            <p className="text-2xl font-semibold text-slate-900 mt-1">{globalConfirmationRate}%</p>
          </Section>
          <Section title="Dépense Meta Ads">
            <p className="text-2xl font-semibold text-slate-900 mt-1">{fmtUSD(totalMetaSpend)}</p>
            <p className="text-xs text-slate-500 mt-1">CPL moyen ${avgCpl.toFixed(2)}</p>
          </Section>
        </div>

        {/* Meta Ads spend by country */}
        <Section title="Dépense publicitaire Meta Ads par pays">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Pays", "Spend", "Leads", "CPL", "CTR"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...overview.metaAds].sort((a, b) => b.spend - a.spend).map((row) => (
                  <tr key={row.country} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-medium text-slate-900">
                        <span className="text-base">{COUNTRY_FLAGS[row.country] ?? "🌍"}</span>
                        {row.country}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{fmtUSD(row.spend)}</td>
                    <td className="px-3 py-3 font-semibold text-emerald-600">{Math.round(row.leads).toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3 text-slate-700">${row.cpl?.toFixed(2) ?? "—"}</td>
                    <td className="px-3 py-3">
                      <Badge variant={row.ctr >= 6.5 ? "green" : row.ctr >= 5 ? "yellow" : "red"}>
                        {row.ctr?.toFixed(2) ?? "0.00"}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* COD networks performance */}
        <Section title="Performance par réseau COD · ClickMarket, Coliscod Angola, Africod Congo">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Réseau", "Pays", "Commandes", "Confirmées", "Taux confirmation", "Livrées", "Taux livraison", "CA livré"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedNetworkRows.map((row) => (
                  <tr key={`${row.network}-${row.country_id}`} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3 text-slate-700">{row.network}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-medium text-slate-900">
                        <span className="text-base">{COUNTRY_FLAGS[row.country_name] ?? "🌍"}</span>
                        {row.country_name}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-500">{row.total_leads.toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3 font-semibold text-emerald-600">{row.confirmes.toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3">
                      <Badge variant={(row.taux_confirmation ?? 0) >= 50 ? "green" : (row.taux_confirmation ?? 0) >= 30 ? "yellow" : "red"}>
                        {row.taux_confirmation ?? 0}%
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{row.livres.toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3">
                      <Badge variant={(row.taux_livraison ?? 0) >= 70 ? "green" : (row.taux_livraison ?? 0) >= 50 ? "yellow" : "red"}>
                        {row.taux_livraison ?? 0}%
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{fmtCurrency(row.ca_livre, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Shipsen */}
        {overview.shipsen.byCountry.length > 0 && (
          <Section title="Performance Shipsen par pays">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    {["Pays", "Commandes", "Confirmées", "Taux confirmation", "Revenus confirmés"].map((h) => (
                      <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {overview.shipsen.byCountry.map((row) => (
                    <tr key={row.country} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2 font-medium text-slate-900">
                          <span className="text-base">{COUNTRY_FLAGS[row.country] ?? "🌍"}</span>
                          {row.country}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-500">{row.total_orders.toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-3 font-semibold text-emerald-600">{row.confirmed_orders.toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-3">
                        <Badge variant={(row.confirmation_rate ?? 0) >= 50 ? "green" : (row.confirmation_rate ?? 0) >= 30 ? "yellow" : "red"}>
                          {row.confirmation_rate ?? 0}%
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{fmtCurrency(row.revenue_confirmed, row.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
