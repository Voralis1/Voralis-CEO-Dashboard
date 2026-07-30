"use client";
import { useEffect, useState } from "react";
import { Section, Badge } from "@/components/ui";
import { fetchShipsenAnalyticsSnapshot, type ShipsenAnalyticsSnapshot } from "@/lib/shipsenAnalytics";
import { Loader2, AlertTriangle, Info } from "lucide-react";

interface ShipsenAnalyticsSnapshotProps {
  // Filtre optionnel par pays (nom canonique) — même logique que ProviderKpiTable.
  countryFilter?: string;
}

function GapNote({ text }: { text: string }) {
  return (
    <span title={text} className="inline-flex ml-1.5 text-slate-400 cursor-help align-middle">
      <Info size={10} />
    </span>
  );
}

function rateBadgeVariant(rate: number | null): "green" | "yellow" | "red" | "gray" {
  if (rate == null) return "gray";
  if (rate >= 70) return "green";
  if (rate >= 40) return "yellow";
  return "red";
}

// Complète ProviderKpiTable(provider="shipsen") avec les VRAIS chiffres du dashboard web Shipsen
// (endpoint /analytics/getTotalOrdersPaid, trouvé le 2026-07-29 — voir
// supabase/shipsen_dashboard_snapshot_schema.sql). Contrairement à ProviderKpiTable, PAS de
// sélecteur de dates libre ici : cette source ne supporte fiablement que 'this_month' (limite de
// l'endpoint Shipsen lui-même, pas un choix arbitraire de ce composant) — affiché à part plutôt
// que mélangé au tableau piloté par le filtre De/À du dashboard CEO.
export default function ShipsenAnalyticsSnapshotSection({ countryFilter }: ShipsenAnalyticsSnapshotProps) {
  const [rows, setRows] = useState<ShipsenAnalyticsSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchShipsenAnalyticsSnapshot("this_month");
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
  }, []);

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
      <div className="flex items-center justify-center py-10 text-slate-400 gap-2">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">Chargement de l&apos;instantané dashboard Shipsen…</span>
      </div>
    );
  }

  const filteredRows = countryFilter ? rows.filter((r) => r.countryName === countryFilter) : rows;

  if (!loading && filteredRows.length === 0) {
    return null; // pas de snapshot pour ce pays — pas d'erreur, juste rien à montrer ici
  }

  return (
    <Section
      title="Shipsen — dashboard officiel (This Month)"
      titleRight={
        <span
          title="Source : endpoint réel du dashboard web Shipsen (/analytics/getTotalOrdersPaid), pas les tables shipsen_leads/shipsen_orders synchronisées par scripts/sync/sync_shipsen.py. Ne supporte que la période 'This Month' — pas de plage de dates libre possible avec cette source."
          className="inline-flex items-center gap-1 text-[10px] text-slate-400 cursor-help"
        >
          <Info size={11} /> période fixe, non liée au filtre de dates
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              {["Pays", "Total commandes", "Commandes confirmées", "Taux de confirmation", "Total shippings", "Livrées", "Taux de livraison", "Dernière synchro"].map((h) => (
                <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => (
              <tr key={r.countryCode} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2 font-medium text-slate-900">
                    <span className="text-base">{r.flag}</span>
                    {r.countryName}
                  </div>
                </td>
                <td className="px-3 py-3 text-slate-500">{r.totalOrders.toLocaleString("fr-FR")}</td>
                <td className="px-3 py-3 font-semibold text-emerald-600">{r.confirmedOrders.toLocaleString("fr-FR")}</td>
                <td className="px-3 py-3">
                  <Badge variant={rateBadgeVariant(r.confirmationRate)}>
                    {r.confirmationRate != null ? `${r.confirmationRate}%` : "—"}
                  </Badge>
                </td>
                <td className="px-3 py-3 text-slate-500">{r.totalShippings.toLocaleString("fr-FR")}</td>
                <td className="px-3 py-3 font-semibold text-emerald-600">
                  {(r.received + r.paid + r.processed).toLocaleString("fr-FR")}
                  <GapNote text="Livrées = Received + Paid + Processed (formule vérifiée en direct contre le widget 'Delivery Rate' du dashboard Shipsen le 2026-07-29) — exclut Cancelled." />
                </td>
                <td className="px-3 py-3">
                  <Badge variant={rateBadgeVariant(r.deliveryRate)}>
                    {r.deliveryRate != null ? `${r.deliveryRate}%` : "—"}
                  </Badge>
                </td>
                <td className="px-3 py-3 text-slate-500">
                  {new Date(r.syncedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
