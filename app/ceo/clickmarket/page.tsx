"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import { fetchClickMarketKpis, ClickMarketKpiRow } from "@/lib/supabase/queries";
import { Loader2, AlertTriangle } from "lucide-react";

function fmtXAF(v: number): string {
  return Math.round(v).toLocaleString("fr-FR").replace(/\s/g, " ") + " XAF";
}

const COUNTRY_FLAGS: Record<string, string> = {
  Gabon: "🇬🇦",
  Angola: "🇦🇴",
  Congo: "🇨🇬",
  Guinée: "🇬🇳",
  Mali: "🇲🇱",
  Sénégal: "🇸🇳",
  "Côte d'Ivoire": "🇨🇮",
};

export default function ClickMarketPage() {
  const { dateFrom, dateTo } = useFilters();
  const [rows, setRows] = useState<ClickMarketKpiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchClickMarketKpis(dateFrom, dateTo)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erreur inconnue");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo]);

  const sorted = [...rows].sort((a, b) => b.confirmes - a.confirmes);
  const totalConfirmes = rows.reduce((sum, r) => sum + r.confirmes, 0);
  const totalCaLivre = rows.reduce((sum, r) => sum + r.ca_livre, 0);

  return (
    <div>
      <Topbar title="ClickMarket" subtitle="Commandes confirmées et revenus par pays" />

      <div className="px-6 py-5 space-y-5">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {loading && rows.length === 0 && !error && (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Chargement des données ClickMarket…</span>
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <p className="text-sm text-slate-500">Aucune commande ClickMarket pour cette période.</p>
        )}

        {rows.length > 0 && (
          <>
            <Section title="Performance ClickMarket par pays">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200">
                      {["Pays", "Leads", "Confirmées", "Taux confirmation", "Livrées", "Taux livraison", "CA livré"].map((h) => (
                        <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr key={r.country_id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2 font-medium text-slate-900">
                            <span className="text-base">{COUNTRY_FLAGS[r.country_name] ?? "🌍"}</span>
                            {r.country_name}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-slate-500">{r.total_leads.toLocaleString("fr-FR")}</td>
                        <td className="px-3 py-3 font-semibold text-emerald-600">{r.confirmes.toLocaleString("fr-FR")}</td>
                        <td className="px-3 py-3">
                          <Badge variant={(r.taux_confirmation ?? 0) >= 50 ? "green" : (r.taux_confirmation ?? 0) >= 30 ? "yellow" : "red"}>
                            {r.taux_confirmation ?? 0}%
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-slate-700">{r.livres.toLocaleString("fr-FR")}</td>
                        <td className="px-3 py-3">
                          <Badge variant={(r.taux_livraison ?? 0) >= 70 ? "green" : (r.taux_livraison ?? 0) >= 50 ? "yellow" : "red"}>
                            {r.taux_livraison ?? 0}%
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-slate-700">{fmtXAF(r.ca_livre)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <div className="grid grid-cols-2 gap-4">
              <Section title="Total commandes confirmées">
                <p className="text-3xl font-bold text-emerald-600 mt-2">
                  {totalConfirmes.toLocaleString("fr-FR")}
                </p>
              </Section>
              <Section title="Total CA livré">
                <p className="text-3xl font-bold text-slate-900 mt-2">
                  {fmtXAF(totalCaLivre)}
                </p>
              </Section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
