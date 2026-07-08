"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import { fmtCurrency } from "@/lib/dashboardData";
import { COUNTRY_FLAGS } from "@/lib/countries";
import { fetchTreasuryCashData, type TreasuryCashData } from "@/lib/treasury";
import { AlertTriangle, Loader2, Info } from "lucide-react";

// Trésorerie (2026-07-08) : plus aucune saisie manuelle sur cet écran. "Cash chez qui" et
// "Cash Out" (salaires locaux/autre) ont été retirés — l'Angola a désormais Field Cash
// (/ceo/field-cash-angola, source vivante) et les 6 marchés à prestataire externe n'ont aucune
// charge séparée à saisir (tout inclus dans les 11$ de frais de livraison). Les tables SQL
// cash_holdings/cash_out_manual sont conservées (historique) mais plus lues ici.
export default function TresoreriePage() {
  const { dateFrom, dateTo } = useFilters();
  const [cashData, setCashData] = useState<TreasuryCashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const cash = await fetchTreasuryCashData(dateFrom, dateTo);
      setCashData(cash);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await loadAll();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  if (loading || !cashData) {
    return (
      <div>
        <Topbar title="Trésorerie" subtitle="Cash encaissé, cash détenu, cash sorti — par pays, base livré + encaissé" />
        <div className="px-6 flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Chargement des données…</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Topbar
        title="Trésorerie"
        subtitle="Cash encaissé, cash sorti — par pays, base livré + encaissé, devises jamais additionnées"
      />

      <div className="px-6 py-5 space-y-5">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {/* ═══ Cash encaissé par pays ═══ */}
        <Section title="Cash encaissé par pays">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Pays", "Livrées", "CA livré encaissé", "Frais livraison (local)", "Cash encaissé"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cashData.cashByCountry.map((r) => (
                  <tr key={r.countryName} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-medium text-slate-900">
                        <span className="text-base">{COUNTRY_FLAGS[r.countryName] ?? "🌍"}</span>
                        {r.countryName}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{r.livres.toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3 text-slate-700">{fmtCurrency(r.caLivre, r.currency)}</td>
                    <td className="px-3 py-3 text-slate-500">−{fmtCurrency(r.fraisLivraisonTotal, r.currency)}</td>
                    <td className="px-3 py-3 font-semibold text-emerald-600">{fmtCurrency(r.cashEncaisse, r.currency)}</td>
                  </tr>
                ))}
                {cashData.cashByCountry.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-slate-500">Aucune commande livrée sur cette période.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ═══ Cash Out ═══ */}
        <Section title="Cash Out par pays">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-xs mb-3">
            <Info size={14} className="shrink-0 mt-0.5" />
            <p>
              Payout affilié (colonne dédiée) inclus dans le total depuis le CRM Voralis — c&apos;est un montant <strong>accru</strong> sur
              les commandes confirmées/livrées de la période, pas une date de décaissement réelle (le CRM n&apos;expose aucune
              date de paiement affilié). Aucune charge de livraison/call center séparée : incluse dans les 11$ (externe) ou dans
              Field Cash (Angola, voir /ceo/field-cash-angola).
            </p>
          </div>
          {cashData.affiliatePayoutError && (
            <div className="flex items-center gap-2 p-3 mb-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs">
              <AlertTriangle size={12} />
              CRM Voralis injoignable pour le payout affilié : {cashData.affiliatePayoutError}
            </div>
          )}
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Pays", "Ad spend réel (converti)", "Payout affilié (CRM)", "Total"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cashData.cashOutByCountry.map((r) => (
                  <tr key={r.countryName} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-medium text-slate-900">
                        <span className="text-base">{COUNTRY_FLAGS[r.countryName] ?? "🌍"}</span>
                        {r.countryName}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{fmtCurrency(r.adSpendLocal, r.currency)}</td>
                    <td className="px-3 py-3 text-slate-700">{fmtCurrency(r.payoutAffilieLocal, r.currency)}</td>
                    <td className="px-3 py-3 font-semibold text-red-600">{fmtCurrency(r.total, r.currency)}</td>
                  </tr>
                ))}
                {cashData.cashOutByCountry.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-slate-500">Aucune sortie de cash pour cette période.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {cashData.outOfScopeAdSpend.length > 0 && (
            <p className="text-xs text-amber-600 mt-3">
              Dépense Meta Ads hors périmètre COD (pas de market_settings, non incluse ci-dessus) :{" "}
              {cashData.outOfScopeAdSpend.map((o) => `${o.country} ($${o.spendUsd.toFixed(0)})`).join(", ")}
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}