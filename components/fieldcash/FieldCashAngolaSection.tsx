"use client";
import { useEffect, useState } from "react";
import { Section, Badge, KpiCard } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import { fetchFieldCashRecap, type FieldCashRecap } from "@/lib/fieldCash";
import { fmtCurrency } from "@/lib/dashboardData";
import { AlertTriangle, Loader2, Wallet, Truck, Fuel, Send, User } from "lucide-react";

// Lecture directe des tables Supabase de la mini-app terrain "Field Cash Angola"
// (field_deliveries, field_charges, field_remittances, field_delivery_params) — aucune saisie
// manuelle ici, aucun sync n8n : les données sont déjà dans Supabase, ce sont les mêmes chiffres
// que la capture de la mini-app (voir lib/fieldCash.ts / lib/fieldCashServer.ts).
export default function FieldCashAngolaSection() {
  const { dateFrom, dateTo } = useFilters();
  const [recap, setRecap] = useState<FieldCashRecap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const r = await fetchFieldCashRecap("Angola", dateFrom, dateTo);
        if (!cancelled) setRecap(r);
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

  const currency = recap?.currency ?? "AOA";
  const fmt = (v: number | null) => (v == null ? "donnée manquante" : fmtCurrency(v, currency));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Field Cash Angola</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Livraisons encaissées, frais internes et rapatriement — lecture directe de la mini-app terrain, zéro saisie
          manuelle ici
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Chargement de Field Cash Angola…</span>
        </div>
      ) : recap ? (
        <>
          <div className="grid grid-cols-5 gap-4">
            <KpiCard
              label="Total encaissé"
              value={fmtCurrency(recap.totalEncaisse, currency)}
              icon={<Wallet size={14} />}
            />
            <KpiCard label="Livraisons collectées" value={recap.nbDeliveries.toLocaleString("fr-FR")} icon={<Truck size={14} />} />
            <KpiCard label="Frais de livraison internes" value={fmt(recap.fraisLivraisonInterneTotal)} icon={<Fuel size={14} />} />
            <KpiCard label="Charges externes" value={fmtCurrency(recap.chargesExternesTotal, currency)} />
            <KpiCard
              label="Commission agent"
              value={fmtCurrency(recap.commissionAgentTotal, currency)}
              icon={<User size={14} />}
            />
          </div>

          <Section title="Rapatriement">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <Send size={16} className="text-emerald-600" />
                <div>
                  <p className="text-[10px] text-slate-500">Remis (reçu en trésorerie)</p>
                  <p className="text-sm font-semibold text-slate-900">{fmtCurrency(recap.remisTotal, currency)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <Send size={16} className="text-amber-500" />
                <div>
                  <p className="text-[10px] text-slate-500">En transit (envoyé, pas encore reçu)</p>
                  <p className="text-sm font-semibold text-slate-900">{fmtCurrency(recap.remisEnTransit, currency)}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-emerald-50 border border-emerald-200">
              <div>
                <p className="text-xs text-emerald-700 font-medium">Montant restant (cash détenu)</p>
                <p className="text-[10px] text-emerald-600 mt-0.5">
                  Total encaissé − frais de livraison internes − charges externes − commission agent − remis (reçu)
                </p>
              </div>
              <p className="text-xl font-semibold text-emerald-700">{fmt(recap.cashDetenuRestant)}</p>
            </div>
          </Section>
        </>
      ) : (
        <Badge variant="gray">Aucune donnée</Badge>
      )}
    </div>
  );
}
