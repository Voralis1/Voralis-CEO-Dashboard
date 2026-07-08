"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge, KpiCard } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import { CANONICAL_COUNTRIES } from "@/lib/countries";
import { fetchFieldCashByAgent, type FieldCashAgentRow } from "@/lib/fieldCash";
import { fmtCurrency } from "@/lib/dashboardData";
import { AlertTriangle, Loader2, Bike, Truck } from "lucide-react";

// Équipe — plus aucun chiffre codé en dur (2026-07-08). L'Angola a une source réelle (mini-app
// Field Cash : field_deliveries.agent) ; les 6 autres marchés (prestataires logistiques externes)
// n'exposent aucune donnée par agent/motoboy — affichée explicitement "donnée manquante", jamais
// un mock qui donnerait l'illusion d'un chiffre réel.
export default function TeamPage() {
  const { dateFrom, dateTo } = useFilters();
  const [agents, setAgents] = useState<FieldCashAgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const rows = await fetchFieldCashByAgent("Angola", dateFrom, dateTo);
        if (!cancelled) setAgents(rows);
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

  const totalLivraisons = agents.reduce((s, a) => s + a.nbDeliveries, 0);
  const totalEncaisse = agents.reduce((s, a) => s + a.totalEncaisse, 0);

  const autresPays = CANONICAL_COUNTRIES.filter((c) => c.name !== "Angola");

  return (
    <div>
      <Topbar title="Équipe" subtitle="Agents terrain Angola (Field Cash) — donnée manquante ailleurs, aucun chiffre inventé" />

      <div className="px-6 py-5 space-y-5">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Chargement des agents Angola…</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4">
              <KpiCard label="Livraisons collectées (Angola)" value={totalLivraisons.toLocaleString("fr-FR")} icon={<Truck size={14} />} />
              <KpiCard label="Cash encaissé (Angola)" value={fmtCurrency(totalEncaisse, "AOA")} />
              <KpiCard label="Agents distincts" value={agents.length.toString()} icon={<Bike size={14} />} />
            </div>

            <Section title="Performance par agent · Angola (Field Cash)">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200">
                      {["Agent", "Livraisons", "Cash encaissé"].map((h) => (
                        <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((a) => (
                      <tr key={a.agent} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-3 font-medium text-slate-900">{a.agent}</td>
                        <td className="px-3 py-3 text-slate-700">{a.nbDeliveries.toLocaleString("fr-FR")}</td>
                        <td className="px-3 py-3 text-slate-700">{fmtCurrency(a.totalEncaisse, "AOA")}</td>
                      </tr>
                    ))}
                    {agents.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-4 text-center text-slate-500">
                          Aucune livraison Field Cash sur cette période.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Autres marchés" titleRight={<Badge variant="gray">Donnée manquante</Badge>}>
              <p className="text-xs text-slate-500 mb-3">
                {autresPays.map((c) => `${c.flag} ${c.name}`).join(" · ")} — aucune source connectée n&apos;expose de
                donnée par agent/livreur pour ces marchés à prestataire logistique externe (leurs frais sont inclus
                dans le forfait de livraison, cf. market_settings.delivery_model). Rien n&apos;est affiché plutôt qu&apos;un
                chiffre inventé.
              </p>
            </Section>

            <Section title="Agents call center" titleRight={<Badge variant="gray">Donnée manquante</Badge>}>
              <p className="text-xs text-slate-500">
                Aucune source connectée n&apos;expose de performance par agent call center à ce jour — à brancher
                séparément si une source vivante est identifiée.
              </p>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}