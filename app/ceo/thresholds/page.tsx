"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import { fmtCurrency } from "@/lib/dashboardData";
import { COUNTRY_FLAGS } from "@/lib/countries";
import type { ThresholdRow, TrafficColor } from "@/lib/thresholds";
import { AlertTriangle, Loader2, Lock } from "lucide-react";

type PublicRow = Omit<ThresholdRow, "ceoDetail">;

function fmtUsd(value: number): string {
  return `$${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}`;
}

const COLOR_BADGE: Record<TrafficColor, { variant: "green" | "yellow" | "red"; label: string }> = {
  green: { variant: "green", label: "🟢 scale" },
  orange: { variant: "yellow", label: "🟠 surveiller" },
  red: { variant: "red", label: "🔴 stop" },
};

function ColorBadge({ color }: { color: TrafficColor | null }) {
  if (color == null) return <span className="text-slate-400 text-xs" title="Pas de donnée réelle sur la période pour comparer">—</span>;
  const c = COLOR_BADGE[color];
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

// Même convention que ColorBadge ci-dessus (et que /ceo/crm-voralis) : un tiret + info-bulle,
// pas un badge orange "seuils indisponibles" — la plupart du temps ce n'est pas une panne, juste
// pas encore assez de données réelles sur la période pour calculer un seuil fiable.
function MissingBanner({ missingFields }: { missingFields: string[] }) {
  if (missingFields.length === 0) return null;
  return (
    <span className="text-slate-400 text-xs cursor-help" title={`Champs manquants : ${missingFields.join(", ")}`}>
      —
    </span>
  );
}

export default function ThresholdsPage() {
  const { dateFrom, dateTo } = useFilters();
  const [role, setRole] = useState<"ceo" | "team" | null>(null);
  const [rows, setRows] = useState<(ThresholdRow | PublicRow)[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/thresholds?dateFrom=${dateFrom}&dateTo=${dateTo}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Erreur inconnue");
        if (!cancelled) {
          setRole(json.role);
          setRows(json.rows);
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

  if (error) {
    return (
      <div>
        <Topbar title="Seuils de rentabilité & plafonds d'acquisition" subtitle="Décision scale/stop en un coup d'œil" />
        <div className="px-6 py-5">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <Topbar title="Seuils de rentabilité & plafonds d'acquisition" subtitle="Décision scale/stop en un coup d'œil" />
        <div className="px-6 flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Calcul des seuils…</span>
        </div>
      </div>
    );
  }

  const isCeo = role === "ceo";

  return (
    <div>
      <Topbar
        title="Seuils de rentabilité & plafonds d'acquisition"
        subtitle={`Décision scale/stop en un coup d'œil — réel comparé sur ${dateFrom} → ${dateTo}`}
      />

      <div className="px-6 py-5 space-y-5">
        {!isCeo && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 text-xs">
            <Lock size={14} className="shrink-0 mt-0.5" />
            <p>
              Vue équipe : seuls les plafonds actionnables et le signal couleur sont visibles. La marge, le seuil plancher et
              la décomposition des coûts restent réservés au CEO.
            </p>
          </div>
        )}

        <Section title="Réseaux logistiques · CPL max par marché">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Pays</th>
                  {isCeo && (
                    <>
                      <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">AOV utilisé</th>
                      <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">M (USD)</th>
                      <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">T (USD, confidentiel)</th>
                      <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">L</th>
                    </>
                  )}
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">CPL max</th>
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">CPL break-even</th>
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">CPL réel</th>
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Signal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.pays} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-medium text-slate-900">
                        <span className="text-base">{COUNTRY_FLAGS[r.pays] ?? "🌍"}</span>
                        {r.pays}
                      </div>
                    </td>
                    {isCeo && "ceoDetail" in r && r.ceoDetail && (
                      <>
                        <td className="px-3 py-3 text-slate-700">
                          {r.aovUsed != null ? (
                            <span>
                              {fmtCurrency(r.aovUsed, r.currency)}
                              {r.aovSource === "override" && (
                                <span className="block text-[9px] text-amber-600">AOV simulé (surcharge CEO)</span>
                              )}
                            </span>
                          ) : (
                            // Pas de commande livrée sur la période et pas de surcharge CEO — 0
                            // est honnête ici ("rien vendu encore"), à la différence de M/L/CPL
                            // ci-dessous qui restent "—" (non calculables, pas de vrai zéro).
                            <span title="Aucune commande livrée sur cette période et aucun AOV simulé saisi.">
                              {fmtCurrency(0, r.currency)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-700">{r.ceoDetail.M_usd != null ? fmtUsd(r.ceoDetail.M_usd) : "—"}</td>
                        <td className="px-3 py-3 text-slate-500">{fmtUsd(r.ceoDetail.T_usd)}</td>
                        <td className="px-3 py-3 text-slate-500">{r.ceoDetail.L != null ? r.ceoDetail.L.toFixed(2) : "—"}</td>
                      </>
                    )}
                    <td className="px-3 py-3">
                      {r.cplMaxUsd != null ? (
                        <span className="font-semibold text-slate-900">
                          {fmtUsd(r.cplMaxUsd)}
                          {isCeo && r.cplMaxLocal != null && (
                            <span className="block text-[9px] text-slate-400 font-normal">{fmtCurrency(r.cplMaxLocal, r.currency)}</span>
                          )}
                        </span>
                      ) : (
                        <MissingBanner missingFields={r.missingFields} />
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{r.cplBreakEvenUsd != null ? fmtUsd(r.cplBreakEvenUsd) : "—"}</td>
                    <td className="px-3 py-3 text-slate-700">
                      {r.cplReelUsd != null ? fmtUsd(r.cplReelUsd) : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <ColorBadge color={r.cplColor} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Affiliés · payout max par confirmée">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Pays</th>
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Payout max (USD)</th>
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Payout break-even (USD)</th>
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Payout réel (USD)</th>
                  <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Signal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.pays} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-medium text-slate-900">
                        <span className="text-base">{COUNTRY_FLAGS[r.pays] ?? "🌍"}</span>
                        {r.pays}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {r.payoutMaxUsd != null ? (
                        <span className="font-semibold text-slate-900">{fmtUsd(r.payoutMaxUsd)}</span>
                      ) : (
                        <MissingBanner missingFields={r.missingFields} />
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{r.payoutBreakEvenUsd != null ? fmtUsd(r.payoutBreakEvenUsd) : "—"}</td>
                    <td className="px-3 py-3 text-slate-700">
                      {r.payoutReelUsd != null ? fmtUsd(r.payoutReelUsd) : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <ColorBadge color={r.payoutColor} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            Payout réel = total_payout ÷ confirmed_orders (bloc by_country du CRM Voralis, en USD, jamais converti).
          </p>
        </Section>
      </div>
    </div>
  );
}
