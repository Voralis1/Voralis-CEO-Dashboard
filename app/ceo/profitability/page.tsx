"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import { fmtCurrency } from "@/lib/dashboardData";
import { COUNTRY_FLAGS } from "@/lib/countries";
import { fetchProfitabilityData, type ProfitabilityData } from "@/lib/profitability";
import { AlertTriangle, Loader2, Info } from "lucide-react";

// Payout par unité (petits montants, ex. $2.50) — fmtCurrency arrondit à 0 décimale, trop
// grossier ici ; on garde 2 décimales comme /ceo/crm-voralis.
function fmtUsdPerUnit(value: number): string {
  return `$${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}`;
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
            <p className="text-xs text-slate-500 mt-1">
              {totalLivresMediaBuying.toLocaleString("fr-FR")} Media Buying Interne + {totalLivresAffiliates.toLocaleString("fr-FR")} Affiliés
            </p>
          </Section>
          <Section title="CA livré encaissé par pays (Media Buying Interne)">
            <div className="space-y-1 mt-2">
              {data.mediaBuying.map((r) => (
                <p key={r.countryName} className="text-sm text-slate-700">
                  <span className="mr-1">{COUNTRY_FLAGS[r.countryName] ?? "🌍"}</span>
                  {r.countryName} : <span className="font-semibold text-slate-900">{fmtCurrency(r.caLivre, r.currency)}</span>
                </p>
              ))}
            </div>
          </Section>
        </div>

        {/* ═══ MEDIA BUYING INTERNE ═══ */}
        <Section
          title="Media Buying Interne · marge par pays"
          titleRight={<Badge variant="blue">marge = revenu net livraison − ad spend − COGS − retours (call center inclus dans les frais de livraison)</Badge>}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Pays", "Livrées", "CA livré encaissé", "Frais livraison (local)", "Ad spend (converti)", "Marge nette", "PPDO"].map(
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
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{r.livres.toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3 font-medium text-slate-900">{fmtCurrency(r.caLivre, r.currency)}</td>
                    <td className="px-3 py-3 text-slate-700">
                      {r.margin.fraisLivraisonTotal != null ? fmtCurrency(r.margin.fraisLivraisonTotal, r.currency) : "donnée manquante"}
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {fmtCurrency(r.adSpendLocal, r.currency)}
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
                          {fmtCurrency(r.margin.margeNette, r.currency)}
                        </span>
                      ) : (
                        <GapCell missingFields={r.margin.missingFields} />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {r.margin.ppdo != null ? (
                        <span className="text-slate-900">{fmtCurrency(r.margin.ppdo, r.currency)}</span>
                      ) : (
                        <GapCell missingFields={r.margin.missingFields} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            Hypothèse : les 4 réseaux COD (ClickMarket, Coliscod Angola, Africod Congo, Shipsen) sont rattachés à Media Buying
            Interne car ce sont eux qui livrent les leads générés par Meta Ads — aucune colonne &ldquo;source d&apos;acquisition&rdquo; ne
            distingue aujourd&apos;hui les commandes par canal dans ces tables.
          </p>
          {data.outOfScopeAdSpend.length > 0 && (
            <p className="text-xs text-amber-600 mt-2">
              Dépense Meta Ads hors périmètre COD (pas de market_settings, donc pas de FX/marge possible) :{" "}
              {data.outOfScopeAdSpend.map((o) => `${o.country} ($${o.spendUsd.toFixed(0)})`).join(", ")}
            </p>
          )}
        </Section>

        {/* ═══ AFFILIÉS ═══ */}
        <Section
          title="Affiliés (CRM Voralis) · marge par réseau"
          titleRight={<Badge variant="yellow">marge = revenu net livraison − payout − COGS − retours (call center inclus dans les frais de livraison)</Badge>}
        >
          {data.affiliatesError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm mb-3">
              <AlertTriangle size={14} />
              {data.affiliatesError}
            </div>
          )}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs mb-3">
            <Info size={14} className="shrink-0 mt-0.5" />
            <p>
              Le payout est désormais exact et fiable (somme des commissions réelles en USD, confirmé le 2026-07-06) — payé à
              la commande <strong>confirmée</strong>, pas livrée. Seul le CA livré encaissé par réseau affilié reste absent de
              l&apos;API CRM Voralis (ni pays, ni devise associés) : impossible de calculer un revenu net de livraison ou une
              marge tant que cette dépendance n&apos;est pas branchée depuis le CRM (prévu séparément).
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Réseau", "Commandes", "Confirmées", "Livrées", "Payout total (USD)", "Coût payout / confirmée", "CA livré encaissé", "Marge nette"].map(
                    (h) => (
                      <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {data.affiliates.map((r) => (
                  <tr key={r.networkName} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3 font-medium text-slate-900">{r.networkName}</td>
                    <td className="px-3 py-3 text-slate-500">{r.totalOrders.toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3 font-semibold text-emerald-600">{r.confirmedOrders.toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3 text-slate-700">{r.deliveredOrders.toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3 text-slate-700">
                      {r.totalPayout != null ? fmtCurrency(r.totalPayout, "USD") : <GapCell missingFields={["payout"]} />}
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {r.payoutPerConfirmedUsd != null ? (
                        fmtUsdPerUnit(r.payoutPerConfirmedUsd)
                      ) : (
                        <span className="text-slate-400" title="Aucune commande confirmée sur cette période">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <GapCell missingFields={["CA livré encaissé (non exposé par le CRM)"]} />
                    </td>
                    <td className="px-3 py-3">
                      <GapCell missingFields={["CA livré", "pays/devise", "COGS", "retours"]} />
                    </td>
                  </tr>
                ))}
                {data.affiliates.length === 0 && !data.affiliatesError && (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-center text-slate-500">
                      Aucun réseau affilié pour cette période.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}
