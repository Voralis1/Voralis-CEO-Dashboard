"use client";
import { useEffect, useState } from "react";
import { Section, Badge } from "@/components/ui";
import { fmtCurrency } from "@/lib/dashboardData";
import { useFilters } from "@/lib/filters";
import { PROVIDERS, type ProviderId, type ProviderKpiRow } from "@/lib/providerKpi";
import { Loader2, AlertTriangle, Info } from "lucide-react";

interface ProviderKpiTableProps {
  provider: ProviderId;
  // Filtre optionnel par pays (nom canonique, ex. "Côte d'Ivoire") — utilisé par la vue
  // groupée /ceo/logistics-cod. Absent = comportement inchangé (toutes les lignes du réseau).
  countryFilter?: string;
}

// Tableau standard unique, réutilisé par les 4 prestataires (ClickMarket, Coliscod Angola,
// Africod Congo, Shipsen) — colonnes strictement identiques, seule la source de données change
// (voir lib/providerKpi.ts). La devise vient de market_settings, jamais d'une constante par
// réseau, et n'est jamais additionnée entre pays.
export default function ProviderKpiTable({ provider, countryFilter }: ProviderKpiTableProps) {
  const config = PROVIDERS[provider];
  const { dateFrom, dateTo } = useFilters();
  const [rows, setRows] = useState<ProviderKpiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await config.fetchRows(dateFrom, dateTo);
        if (!cancelled) setRows(data);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, dateFrom, dateTo]);

  if (error) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
        <AlertTriangle size={14} />
        {error}
      </div>
    );
  }

  if (loading && rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">Chargement des données {config.label}…</span>
      </div>
    );
  }

  if (!loading && rows.length === 0) {
    return <p className="text-sm text-slate-500">Aucune commande {config.label} pour cette période.</p>;
  }

  const filteredRows = countryFilter ? rows.filter((r) => r.countryName === countryFilter) : rows;

  if (!loading && filteredRows.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Aucune commande {config.label} pour {countryFilter} sur cette période.
      </p>
    );
  }

  const sorted = [...filteredRows].sort((a, b) => b.totalCommandes - a.totalCommandes);
  const totalConfirmees = filteredRows.reduce((s, r) => s + r.confirmes, 0);

  return (
    <>
      <Section title={`Performance ${config.label} par pays`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                {[
                  "Pays",
                  "Total commande",
                  "Commandes confirmées",
                  "Livrées",
                  "Taux livraison",
                  "AOV encaissé",
                  "CA livré encaissé",
                  "Annulées",
                  "Délai 1er contact",
                ].map((h) => (
                  <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const aov = r.livres > 0 ? r.caLivre / r.livres : null;
                return (
                  <tr key={r.countryName} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-medium text-slate-900">
                        <span className="text-base">{r.flag}</span>
                        <span>
                          {r.countryName}
                          <span className="block text-[10px] font-normal text-slate-400">{r.currency || "devise inconnue"}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-500">
                      {r.totalCommandes.toLocaleString("fr-FR")}
                      {r.doublons > 0 && (
                        <span className="block text-[10px] text-amber-600">dont {r.doublons} doublon(s)</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{r.confirmes.toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3 text-slate-700">{r.livres.toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3">
                      <Badge variant={(r.tauxLivraison ?? 0) >= 70 ? "green" : (r.tauxLivraison ?? 0) >= 50 ? "yellow" : "red"}>
                        {r.tauxLivraison ?? 0}%
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {aov != null ? fmtCurrency(aov, r.currency) : "—"}
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-900">{fmtCurrency(r.caLivre, r.currency)}</td>
                    <td className="px-3 py-3 text-slate-700">
                      {r.annulees.toLocaleString("fr-FR")}
                      <GapNote text="Motifs d'annulation non disponibles — aucune colonne reason code exposée par ce réseau." />
                    </td>
                    <td className="px-3 py-3">
                      <GapBadge text="Timestamp du 1er appel call center absent sur les 4 réseaux — aucune colonne ne distingue la date de réception de la date du 1er contact (confirmed_at marque la fin de la confirmation, pas la première tentative)." />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-3">
          Revenus affichés dans la devise locale de chaque pays (via market_settings) — jamais additionnés entre pays.
          Livrées = statut &ldquo;processed&rdquo; (livré + encaissé) ; CA livré encaissé est net du frais de livraison fixe (11$/commande).
        </p>
      </Section>

      <div className="grid grid-cols-2 gap-4 mt-4">
        <Section title="Total commandes confirmées">
          <p className="text-3xl font-bold text-emerald-600 mt-2">{totalConfirmees.toLocaleString("fr-FR")}</p>
        </Section>
        <Section title="CA livré encaissé par pays">
          <div className="space-y-1 mt-2">
            {sorted.map((r) => (
              <p key={r.countryName} className="text-sm text-slate-700">
                <span className="mr-1">{r.flag}</span>
                {r.countryName} : <span className="font-semibold text-slate-900">{fmtCurrency(r.caLivre, r.currency)}</span>
              </p>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}

function GapBadge({ text }: { text: string }) {
  return (
    <span
      title={text}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200 cursor-help"
    >
      <Info size={10} />
      N/A — source manquante
    </span>
  );
}

function GapNote({ text }: { text: string }) {
  return (
    <span title={text} className="inline-flex ml-1.5 text-slate-400 cursor-help align-middle">
      <Info size={10} />
    </span>
  );
}
