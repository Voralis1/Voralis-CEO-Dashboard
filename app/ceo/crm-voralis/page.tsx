"use client";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge, ProgressBar } from "@/components/ui";
import { ChevronDown, ChevronUp, Loader2, AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

interface EntityStats {
  total_orders: number;
  confirmed_orders: number;
  delivered_orders: number;
  total_payout: number;
}

interface AffiliateEntry {
  id: string;
  name: string;
  created_at: string;
  stats: EntityStats;
}

interface NetworkEntry {
  id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
  stats: EntityStats;
  affiliates: AffiliateEntry[];
}

interface NetworksResponse {
  success: boolean;
  message?: string;
  totals: { networks: number; affiliates: number; confirmed_orders: number };
  networks: NetworkEntry[];
}

function rate(stats: EntityStats) {
  return stats.total_orders > 0 ? Math.round((stats.confirmed_orders / stats.total_orders) * 100) : 0;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return count > 1 ? pluralForm : singular;
}

export default function CrmVoralisPage() {
  const [data, setData] = useState<NetworksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedNetwork, setExpandedNetwork] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/networks")
      .then((res) => res.json())
      .then((json: NetworksResponse) => {
        if (cancelled) return;
        if (!json.success) {
          setError(json.message || "Erreur lors du chargement des données CRM Voralis.");
          return;
        }
        setData(json);
        setExpandedNetwork(json.networks[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("Impossible de contacter le CRM Voralis.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleNetwork = (id: string) => {
    setExpandedNetwork((current) => (current === id ? null : id));
  };

  return (
    <div>
      <Topbar
        title="CRM Voralis"
        subtitle="Réseaux d'affiliés, affiliés, commandes confirmées et taux de confirmation"
      />

      <div className="px-6 py-5 space-y-5">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {!data && !error && (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Chargement des données CRM Voralis…</span>
          </div>
        )}

        {data && (
          <>
            {/* Overall Stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Section title="Total Réseaux">
                <p className="text-3xl font-bold text-slate-900 mt-2">{data.totals.networks}</p>
              </Section>
              <Section title="Total Affiliés">
                <p className="text-3xl font-bold text-slate-900 mt-2">{data.totals.affiliates}</p>
              </Section>
              <Section title="Total commandes confirmées">
                <p className="text-3xl font-bold text-emerald-600 mt-2">{data.totals.confirmed_orders}</p>
              </Section>
            </div>

            {/* Affiliate Networks */}
            <Section title="Réseaux d'affiliés">
              {data.networks.length === 0 ? (
                <p className="text-sm text-slate-500">Aucun réseau d&apos;affiliés pour le moment.</p>
              ) : (
                <div className="space-y-3">
                  {data.networks.map((network) => {
                    const isExpanded = expandedNetwork === network.id;
                    const networkRate = rate(network.stats);
                    return (
                      <div key={network.id} className="border border-slate-200 rounded-lg overflow-hidden">
                        {/* Network Header */}
                        <button
                          onClick={() => toggleNetwork(network.id)}
                          className="w-full px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900 text-left">{network.name}</p>
                              <p className="text-xs text-slate-500 text-left mt-1">
                                {network.affiliates.length} {plural(network.affiliates.length, "affilié")} · {network.stats.confirmed_orders} {plural(network.stats.confirmed_orders, "commande confirmée", "commandes confirmées")} · {networkRate}% taux moyen
                              </p>
                            </div>
                          </div>
                          {isExpanded ? (
                            <ChevronUp size={18} className="text-slate-500" />
                          ) : (
                            <ChevronDown size={18} className="text-slate-500" />
                          )}
                        </button>

                        {/* Affiliates Table */}
                        {isExpanded && (
                          <div className="border-t border-slate-200 overflow-x-auto">
                            {network.affiliates.length === 0 ? (
                              <p className="text-xs text-slate-500 px-4 py-3">Aucun affilié dans ce réseau.</p>
                            ) : (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-white border-b border-slate-200">
                                    {["Affilié", "Commandes", "Commandes confirmées", "Taux Confirmation"].map((h) => (
                                      <th key={h} className="text-left px-4 py-3 text-slate-500 font-medium">{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {network.affiliates.map((affiliate) => {
                                    const affRate = rate(affiliate.stats);
                                    return (
                                      <tr key={affiliate.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                        <td className="px-4 py-3 text-slate-700 font-medium">{affiliate.name}</td>
                                        <td className="px-4 py-3 text-slate-500">{affiliate.stats.total_orders}</td>
                                        <td className="px-4 py-3 font-semibold text-emerald-600">
                                          {affiliate.stats.confirmed_orders}
                                        </td>
                                        <td className="px-4 py-3">
                                          <div className="flex items-center gap-3">
                                            <ProgressBar
                                              value={affRate}
                                              color={affRate >= 80 ? "#1d9e75" : affRate >= 70 ? "#ef9f27" : "#e24b4a"}
                                              className="w-20"
                                            />
                                            <span
                                              className={
                                                affRate >= 80
                                                  ? "text-emerald-600"
                                                  : affRate >= 70
                                                  ? "text-amber-600"
                                                  : "text-red-600"
                                              }
                                            >
                                              {affRate}%
                                            </span>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            {/* Network Comparison */}
            <Section title="Comparaison des réseaux">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200">
                      {["Réseau", "Affiliés", "Commandes confirmées", "Taux Moyen"].map((h) => (
                        <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.networks]
                      .sort((a, b) => b.stats.confirmed_orders - a.stats.confirmed_orders)
                      .map((network) => {
                        const networkRate = rate(network.stats);
                        return (
                          <tr key={network.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                            <td className="px-3 py-3 font-medium text-slate-900">{network.name}</td>
                            <td className="px-3 py-3 text-slate-700">{network.affiliates.length}</td>
                            <td className="px-3 py-3 font-semibold text-emerald-600">
                              {network.stats.confirmed_orders}
                            </td>
                            <td className="px-3 py-3">
                              <Badge variant={networkRate >= 80 ? "green" : networkRate >= 70 ? "yellow" : "red"}>
                                {networkRate}%
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
