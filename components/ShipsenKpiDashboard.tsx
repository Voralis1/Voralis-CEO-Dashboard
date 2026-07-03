"use client";
import { useEffect, useState } from "react";
import { Section, Badge } from "@/components/ui";
import { Loader2, AlertTriangle } from "lucide-react";
import { useFilters } from "@/lib/filters";

interface CountryKpi {
  country: string;
  currency: string;
  total_orders: number;
  confirmed_orders: number;
  confirmation_rate: number | null;
  revenue_confirmed: number;
  revenue_delivered: number;
  cancelled_orders: number;
  pending_orders: number;
}

interface GlobalKpi {
  total_confirmed_orders: number;
  total_orders_all: number;
  global_confirmation_rate: number | null;
}

const COUNTRY_FLAGS: Record<string, string> = {
  Mali: "🇲🇱",
  Guinea: "🇬🇳",
  Senegal: "🇸🇳",
  "Cote d'Ivoire": "🇨🇮",
};

function fmtCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${Math.round(value).toLocaleString("fr-FR")} ${currency}`;
  }
}

export default function ShipsenKpiDashboard() {
  const { dateFrom, dateTo } = useFilters();
  const [byCountry, setByCountry] = useState<CountryKpi[]>([]);
  const [global, setGlobal] = useState<GlobalKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/shipsen/kpi?dateFrom=${dateFrom}&dateTo=${dateTo}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        if (!cancelled) {
          setByCountry(json.byCountry ?? []);
          setGlobal(json.global ?? null);
        }
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

  const sorted = [...byCountry].sort((a, b) => b.confirmed_orders - a.confirmed_orders);
  const totalConfirmed = global?.total_confirmed_orders ?? 0;
  const globalRate = global?.global_confirmation_rate;

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {loading && byCountry.length === 0 && !error && (
        <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Chargement des données Shipsen…</span>
        </div>
      )}

      {!loading && !error && byCountry.length === 0 && (
        <p className="text-sm text-slate-500">Aucune commande Shipsen synchronisée pour le moment.</p>
      )}

      {byCountry.length > 0 && (
        <>
          <Section title="Performance Shipsen par pays">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    {["Pays", "Commandes", "Confirmées", "Taux confirmation", "En attente", "Annulées", "Revenus confirmés"].map((h) => (
                      <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((c) => (
                    <tr key={c.country} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2 font-medium text-slate-900">
                          <span className="text-base">{COUNTRY_FLAGS[c.country] ?? "🌍"}</span>
                          {c.country}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-500">{c.total_orders.toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-3 font-semibold text-emerald-600">
                        {c.confirmed_orders.toLocaleString("fr-FR")}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={(c.confirmation_rate ?? 0) >= 50 ? "green" : (c.confirmation_rate ?? 0) >= 30 ? "yellow" : "red"}>
                          {c.confirmation_rate ?? 0}%
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{c.pending_orders.toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-3 text-slate-700">{c.cancelled_orders.toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-3 text-slate-700">{fmtCurrency(c.revenue_confirmed, c.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 mt-3">
              Revenus affichés dans la devise locale de chaque pays (XOF ou GNF) — jamais additionnés
              entre pays car les devises diffèrent.
            </p>
          </Section>

          <div className="grid grid-cols-2 gap-4">
            <Section title="Total commandes confirmées">
              <p className="text-3xl font-bold text-emerald-600 mt-2">
                {totalConfirmed.toLocaleString("fr-FR")}
              </p>
            </Section>
            <Section title="Taux de confirmation global">
              <p className="text-3xl font-bold text-slate-900 mt-2">
                {globalRate != null ? `${globalRate}%` : "—"}
              </p>
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
