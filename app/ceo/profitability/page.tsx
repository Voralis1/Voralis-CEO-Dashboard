"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import { fmtCurrency } from "@/lib/dashboardData";
import { COUNTRY_FLAGS } from "@/lib/countries";
import { fetchProfitabilityData, type ProfitabilityData } from "@/lib/profitability";
import { AlertTriangle, Loader2, Info } from "lucide-react";

// null = pas de taux USD fiable pour ce pays (hors market_settings et devise source non
// alignée sur un pays déjà configuré, ex. Argentine — voir lib/profitability.ts). Dans ce cas
// on retombe sur la devise locale brute plutôt que de masquer la donnée réelle.
function toUsd(value: number, fxToUsd: number | null): number | null {
  return fxToUsd != null ? value / fxToUsd : null;
}

function AmountCell({ valueLocal, currency, fxToUsd }: { valueLocal: number; currency: string; fxToUsd: number | null }) {
  const usd = toUsd(valueLocal, fxToUsd);
  if (usd != null) return <>{fmtCurrency(usd, "USD")}</>;
  return (
    <span title="Devise source non alignée sur un pays déjà configuré dans market_settings — pas de taux USD fiable, montant affiché dans la devise brute rapportée par le réseau.">
      {fmtCurrency(valueLocal, currency)}
    </span>
  );
}

function GapCell({ missingFields }: { missingFields: string[] }) {
  return (
    <span
      title={`Donnée manquante : ${missingFields.join(", ")}`}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 cursor-help"
    >
      <Info size={10} />
      donnée manquante
    </span>
  );
}

export default function ProfitabilityPage() {
  const { dateFrom, dateTo } = useFilters();
  const [data, setData] = useState<ProfitabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchProfitabilityData(dateFrom, dateTo);
        if (!cancelled) setData(result);
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
        <Topbar title="Rentabilité" subtitle="Marge nette par pays — base livré + encaissé" />
        <div className="px-6 py-5">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div>
        <Topbar title="Rentabilité" subtitle="Marge nette par pays — base livré + encaissé" />
        <div className="px-6 flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Chargement des données…</span>
        </div>
      </div>
    );
  }

  const totalLivresMediaBuying = data.mediaBuying.reduce((s, r) => s + r.livres, 0);
  const totalLivresAffiliates = data.affiliates.reduce((s, r) => s + r.deliveredOrders, 0);
  const totalLivres = totalLivresMediaBuying + totalLivresAffiliates;

  return (
    <div>
      <Topbar
        title="Rentabilité"
        subtitle="Marge nette par pays — base livré + encaissé, devises jamais additionnées entre pays"
      />

      <div className="px-6 py-5 space-y-5">
        {/* Métrique de tête */}
        <div className="grid grid-cols-2 gap-4">
          <Section title="Total livrées (tous canaux)">
            <p className="text-3xl font-bold text-emerald-600 mt-2">{totalLivres.toLocaleString("fr-FR")}</p>
          </Section>
          <Section title="Marge nette par pays">
            <div className="space-y-1 mt-2">
              {data.mediaBuying.map((r) => (
                <p key={r.countryName} className="text-sm text-slate-700">
                  <span className="mr-1">{COUNTRY_FLAGS[r.countryName] ?? "🌍"}</span>
                  {r.countryName} :{" "}
                  {r.margin.margeNette != null ? (
                    <span className={"font-semibold " + (r.margin.margeNette >= 0 ? "text-emerald-600" : "text-red-600")}>
                      <AmountCell valueLocal={r.margin.margeNette} currency={r.currency} fxToUsd={r.fxToUsd} />
                    </span>
                  ) : (
                    <GapCell missingFields={r.margin.missingFields} />
                  )}
                </p>
              ))}
            </div>
          </Section>
        </div>

        {/* ═══ MEDIA BUYING INTERNE ═══ */}
        <Section
          title="marge par pays"
          titleRight={<Badge variant="blue">marge = revenu net livraison − ad spend − COGS (call center inclus dans les frais de livraison)</Badge>}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Pays", "Livrées", "CA livré encaissé", "Frais livraison", "Ad spend", "Marge nette", "Profit par commande livrée"].map(
                    (h) => (
                      <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {data.mediaBuying.map((r) => (
                  <tr key={r.countryName} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-medium text-slate-900">
                        <span className="text-base">{COUNTRY_FLAGS[r.countryName] ?? "🌍"}</span>
                        {r.countryName}
                        {!r.hasMarketSettings && (
                          <span title="Pays servi par un réseau logistique mais pas encore configuré dans market_settings (nouveau marché) — marge non calculable en attendant.">
                            <Badge variant="yellow">config manquante</Badge>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{r.livres.toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3 font-medium text-slate-900">
                      <AmountCell valueLocal={r.caLivre} currency={r.currency} fxToUsd={r.fxToUsd} />
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {r.margin.fraisLivraisonTotal != null ? (
                        <AmountCell valueLocal={r.margin.fraisLivraisonTotal} currency={r.currency} fxToUsd={r.fxToUsd} />
                      ) : (
                        "donnée manquante"
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      <AmountCell valueLocal={r.adSpendLocal} currency={r.currency} fxToUsd={r.fxToUsd} />
                      {!r.adSpendKnown && (
                        <span
                          title="Aucune dépense Meta Ads trouvée pour ce pays sur la période — 0 réel, pas un trou de source (Meta Ads ne cible pas forcément tous les pays COD)."
                          className="inline-flex ml-1.5 text-slate-400 cursor-help align-middle"
                        >
                          <Info size={10} />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-semibold">
                      {r.margin.margeNette != null ? (
                        <span className={r.margin.margeNette >= 0 ? "text-emerald-600" : "text-red-600"}>
                          <AmountCell valueLocal={r.margin.margeNette} currency={r.currency} fxToUsd={r.fxToUsd} />
                        </span>
                      ) : (
                        <GapCell missingFields={r.margin.missingFields} />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {r.margin.ppdo != null ? (
                        <span className="text-slate-900">
                          <AmountCell valueLocal={r.margin.ppdo} currency={r.currency} fxToUsd={r.fxToUsd} />
                        </span>
                      ) : r.margin.margeNette != null && r.livres === 0 ? (
                        // Marge connue mais 0 commande livrée sur la période : division par zéro,
                        // pas une donnée manquante — 0 est la vraie valeur ("aucun profit par
                        // commande livrée" puisqu'aucune commande n'a encore été livrée), pas un trou.
                        <span className="text-slate-500" title="0 commande livrée sur cette période — pas de donnée manquante.">
                          {fmtCurrency(0, "USD")}
                        </span>
                      ) : (
                        <GapCell missingFields={r.margin.missingFields} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.outOfScopeAdSpend.length > 0 && (
            <p className="text-xs text-amber-600 mt-2">
              Dépense Meta Ads hors périmètre COD (pas de market_settings, donc pas de FX/marge possible) :{" "}
              {data.outOfScopeAdSpend.map((o) => `${o.country} ($${o.spendUsd.toFixed(0)})`).join(", ")}
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
