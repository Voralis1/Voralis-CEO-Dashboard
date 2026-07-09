"use client";
import { useEffect, useMemo, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import { fetchAffiliatesData, type AffiliateRow, type CountryAffiliateRow, type AffiliatesData } from "@/lib/affiliates";
import { AlertTriangle, Loader2, Info, ArrowUpDown } from "lucide-react";

type AffiliateSortKey = "payoutPerConfirmedUsd" | "drPct" | "deliveredOrders" | "totalPayoutUsd";

// Seuil d'alerte payout/confirmée — fixé par le CEO, pas une saisie manuelle par écran.
const PAYOUT_ALERT_THRESHOLD_USD = 10;

function fmtUsd(value: number): string {
  return `$${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}`;
}

function GapCell({ text }: { text: string }) {
  return (
    <span
      title={text}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 cursor-help"
    >
      <Info size={10} />
      incomplète
    </span>
  );
}

function SortableHeader({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <th
      onClick={onClick}
      className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap cursor-pointer select-none hover:text-slate-700"
    >
      <span className="flex items-center gap-1">
        {label}
        <ArrowUpDown size={10} className={active ? "text-slate-700" : "text-slate-300"} />
      </span>
    </th>
  );
}

export default function CrmVoralisPage() {
  const { dateFrom, dateTo } = useFilters();
  const [data, setData] = useState<AffiliatesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [affSortKey, setAffSortKey] = useState<AffiliateSortKey>("payoutPerConfirmedUsd");
  const [affSortAsc, setAffSortAsc] = useState(true);
  const [countrySortKey, setCountrySortKey] = useState<AffiliateSortKey>("payoutPerConfirmedUsd");
  const [countrySortAsc, setCountrySortAsc] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchAffiliatesData(dateFrom, dateTo);
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

  // null (non calculable — pas de commande livrée/confirmée) toujours en fin de tri, jamais
  // confondu avec 0 (qui serait un vrai coût nul).
  function sortByNullable<T>(rows: T[], key: (r: T) => number | null, asc: boolean): T[] {
    return [...rows].sort((a, b) => {
      const va = key(a);
      const vb = key(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return asc ? va - vb : vb - va;
    });
  }

  function affiliateSortValue(r: AffiliateRow, k: AffiliateSortKey): number | null {
    return r[k];
  }
  function countrySortValue(r: CountryAffiliateRow, k: AffiliateSortKey): number | null {
    return r[k];
  }

  const sortedAffiliates = useMemo(
    () => (data ? sortByNullable(data.affiliates, (r) => affiliateSortValue(r, affSortKey), affSortAsc) : []),
    [data, affSortKey, affSortAsc]
  );
  const sortedCountries = useMemo(
    () => (data ? sortByNullable(data.byCountry, (r) => countrySortValue(r, countrySortKey), countrySortAsc) : []),
    [data, countrySortKey, countrySortAsc]
  );

  function toggleAffSort(key: AffiliateSortKey) {
    if (affSortKey === key) setAffSortAsc((v) => !v);
    else {
      setAffSortKey(key);
      setAffSortAsc(true);
    }
  }
  function toggleCountrySort(key: AffiliateSortKey) {
    if (countrySortKey === key) setCountrySortAsc((v) => !v);
    else {
      setCountrySortKey(key);
      setCountrySortAsc(true);
    }
  }

  if (error) {
    return (
      <div>
        <Topbar title="CRM Voralis" subtitle="Affiliés — décision scale/stop sur livré + rentabilité" />
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
        <Topbar title="CRM Voralis" subtitle="Affiliés — décision scale/stop sur livré + rentabilité" />
        <div className="px-6 flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Chargement des données CRM Voralis…</span>
        </div>
      </div>
    );
  }

  const outOfScopeCountries = data.byCountry.filter((c) => c.countryName == null);

  return (
    <div>
      <Topbar
        title="CRM Voralis"
        subtitle="Affiliés — décision scale/stop sur livré + rentabilité (le taux de confirmation reste un diagnostic funnel, jamais décisionnel)"
      />

      <div className="px-6 py-5 space-y-5">
        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-xs">
          <Info size={14} className="shrink-0 mt-0.5" />
          <p>
            On juge sur <strong>livré + rentabilité</strong>, jamais sur le taux de confirmation seul. Le coût payout, lui,
            est calculé par commande <strong>confirmée</strong> (pas livrée) : c&apos;est à la confirmation que le payout est dû
            dans ce business — exception valable uniquement pour ce coût. La rentabilité nette (revenu net livraison − payout −
            COGS − retours ; le call center est déjà inclus dans les frais de livraison, pas une ligne séparée) reste{" "}
            <strong>incomplète</strong> : le CRM ne fournit pas encore le CA livré encaissé
            par affilié/pays, seulement les comptages et le payout (en USD, sans conversion). Dès que ce CA sera branché, la
            marge se calculera automatiquement en USD (comme le payout), via FX pour convertir le CA local — cohérent avec
            /profitability.
          </p>
        </div>

        {/* ═══ Par affilié ═══ */}
        <Section title={`Leaderboard par affilié (${data.totals.affiliates})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Affilié</th>
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Réseau</th>
                  <SortableHeader label="Commandes" active={affSortKey === "deliveredOrders"} onClick={() => toggleAffSort("deliveredOrders")} />
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Confirmées (diagnostic)</th>
                  <SortableHeader label="Livrées" active={affSortKey === "deliveredOrders"} onClick={() => toggleAffSort("deliveredOrders")} />
                  <SortableHeader label="DR%" active={affSortKey === "drPct"} onClick={() => toggleAffSort("drPct")} />
                  <SortableHeader label="Payout total (USD)" active={affSortKey === "totalPayoutUsd"} onClick={() => toggleAffSort("totalPayoutUsd")} />
                  <SortableHeader label="Coût payout / confirmée" active={affSortKey === "payoutPerConfirmedUsd"} onClick={() => toggleAffSort("payoutPerConfirmedUsd")} />
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Rentabilité nette (USD)</th>
                </tr>
              </thead>
              <tbody>
                {sortedAffiliates.map((r) => {
                  const overThreshold = r.payoutPerConfirmedUsd != null && r.payoutPerConfirmedUsd > PAYOUT_ALERT_THRESHOLD_USD;
                  return (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3 font-medium text-slate-900">{r.name}</td>
                      <td className="px-3 py-3 text-slate-500">{r.networkName}</td>
                      <td className="px-3 py-3 text-slate-500">{r.totalOrders.toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-3">
                        <span className="text-slate-500">{r.confirmedOrders.toLocaleString("fr-FR")}</span>
                      </td>
                      <td className="px-3 py-3 font-semibold text-emerald-600">{r.deliveredOrders.toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-3 text-slate-700">{r.drPct != null ? `${r.drPct}%` : "—"}</td>
                      <td className="px-3 py-3 text-slate-700">{fmtUsd(r.totalPayoutUsd)}</td>
                      <td className="px-3 py-3">
                        {r.payoutPerConfirmedUsd != null ? (
                          <span className="flex items-center gap-1.5">
                            <span className={overThreshold ? "text-red-600 font-semibold" : "text-slate-700"}>
                              {fmtUsd(r.payoutPerConfirmedUsd)}
                            </span>
                            {overThreshold && <Badge variant="red">coût élevé</Badge>}
                          </span>
                        ) : (
                          <span className="text-slate-400" title="Aucune commande confirmée sur cette période">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <GapCell text="CA livré encaissé non exposé par le CRM pour cet affilié — rentabilité non calculable." />
                      </td>
                    </tr>
                  );
                })}
                {sortedAffiliates.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-4 text-center text-slate-500">Aucun affilié pour cette période.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ═══ Par pays ═══ */}
        <Section title="Leaderboard par pays (tous affiliés confondus)">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Pays</th>
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Commandes</th>
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Confirmées (diagnostic)</th>
                  <SortableHeader label="Livrées" active={countrySortKey === "deliveredOrders"} onClick={() => toggleCountrySort("deliveredOrders")} />
                  <SortableHeader label="DR%" active={countrySortKey === "drPct"} onClick={() => toggleCountrySort("drPct")} />
                  <SortableHeader label="Payout total (USD)" active={countrySortKey === "totalPayoutUsd"} onClick={() => toggleCountrySort("totalPayoutUsd")} />
                  <SortableHeader label="Coût payout / confirmée" active={countrySortKey === "payoutPerConfirmedUsd"} onClick={() => toggleCountrySort("payoutPerConfirmedUsd")} />
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Rentabilité nette (USD)</th>
                </tr>
              </thead>
              <tbody>
                {sortedCountries.filter((c) => c.countryName != null).map((r) => {
                  const overThreshold = r.payoutPerConfirmedUsd != null && r.payoutPerConfirmedUsd > PAYOUT_ALERT_THRESHOLD_USD;
                  return (
                    <tr key={r.countryCode} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2 font-medium text-slate-900">
                          <span className="text-base">{r.flag}</span>
                          {r.countryName}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-500">{r.totalOrders.toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-3 text-slate-500">{r.confirmedOrders.toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-3 font-semibold text-emerald-600">{r.deliveredOrders.toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-3 text-slate-700">{r.drPct != null ? `${r.drPct}%` : "—"}</td>
                      <td className="px-3 py-3 text-slate-700">{fmtUsd(r.totalPayoutUsd)}</td>
                      <td className="px-3 py-3">
                        {r.payoutPerConfirmedUsd != null ? (
                          <span className="flex items-center gap-1.5">
                            <span className={overThreshold ? "text-red-600 font-semibold" : "text-slate-700"}>
                              {fmtUsd(r.payoutPerConfirmedUsd)}
                            </span>
                            {overThreshold && <Badge variant="red">coût élevé</Badge>}
                          </span>
                        ) : (
                          <span className="text-slate-400" title="Aucune commande confirmée sur cette période">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <GapCell text="CA livré encaissé non exposé par le CRM pour ce pays — rentabilité non calculable." />
                      </td>
                    </tr>
                  );
                })}
                {sortedCountries.filter((c) => c.countryName != null).length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-center text-slate-500">Aucun pays COD pour cette période.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {outOfScopeCountries.length > 0 && (
            <p className="text-xs text-amber-600 mt-3">
              Codes pays hors périmètre COD (aucun market_settings associé, exclus du tableau) :{" "}
              {outOfScopeCountries.map((c) => `${c.countryCode} (${c.totalOrders} commande${c.totalOrders > 1 ? "s" : ""})`).join(", ")}
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
