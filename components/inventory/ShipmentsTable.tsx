"use client";
import { useEffect, useState } from "react";
import { Section, Badge } from "@/components/ui";
import { COUNTRY_FLAGS } from "@/lib/countries";
import { useFilters } from "@/lib/filters";
import { type ShipmentRow } from "@/lib/supabase/queries";
import { Loader2, AlertTriangle } from "lucide-react";

interface ShipmentsTableProps {
  title: string;
  fetchRows: (dateFrom?: string, dateTo?: string) => Promise<ShipmentRow[]>;
}

const MISSING = <span className="text-slate-400 italic">—</span>;

function fmtDate(value: string | null): React.ReactNode {
  if (!value) return MISSING;
  return new Date(value).toLocaleDateString("fr-FR");
}

// Tableau standard réutilisé pour les 4 réseaux logistiques (ClickMarket, Coliscod, Africod
// Congo, Shipsen) — stock entrant (expéditions fournisseur → warehouse), pas les commandes
// clients. Une ligne par (expédition, produit) — voir lib/supabase/queries.ts.
export default function ShipmentsTable({ title, fetchRows }: ShipmentsTableProps) {
  const { dateFrom, dateTo } = useFilters();
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchRows(dateFrom, dateTo);
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
  }, [dateFrom, dateTo]);

  return (
    <Section title={title}>
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm mb-3">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-slate-400 gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Chargement…</span>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                {[
                  "Pays",
                  "Produit",
                  "Date d'expédition",
                  "Date de réception",
                  "Origine",
                  "Qté envoyée",
                  "Qté arrivée",
                  "Qté défectueuse",
                  "Statut",
                ].map((h) => (
                  <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-1.5 font-medium text-slate-900">
                      <span className="text-base">{COUNTRY_FLAGS[r.country] ?? "🌍"}</span>
                      {r.country}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-700">{r.product_name}</td>
                  <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{fmtDate(r.shipment_date)}</td>
                  <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{fmtDate(r.arrival_date)}</td>
                  <td className="px-3 py-3 text-slate-700">{r.source_country ?? MISSING}</td>
                  <td className="px-3 py-3 text-slate-700">
                    {r.quantity_sent != null ? r.quantity_sent.toLocaleString("fr-FR") : MISSING}
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    {r.quantity_arrived != null ? r.quantity_arrived.toLocaleString("fr-FR") : MISSING}
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    {r.quantity_defected != null && r.quantity_defected > 0 ? (
                      <span className="text-amber-600 font-medium">{r.quantity_defected.toLocaleString("fr-FR")}</span>
                    ) : (
                      r.quantity_defected?.toLocaleString("fr-FR") ?? MISSING
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {r.status ? <Badge variant="gray">{r.status}</Badge> : MISSING}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-4 text-center text-slate-500">
                    Aucune expédition pour cette période.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}