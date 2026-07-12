"use client";
import { useEffect, useMemo, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { COUNTRY_FLAGS } from "@/lib/countries";
import { fetchCrmStock, type StockCrmRow } from "@/lib/inventory";
import {
  fetchClickMarketShipments,
  fetchColiscodShipments,
  fetchAfricodCongoShipments,
  fetchShipsenExpeditions,
} from "@/lib/supabase/queries";
import ShipmentsTable from "@/components/inventory/ShipmentsTable";
import { AlertTriangle, Loader2 } from "lucide-react";

const MISSING = <span className="text-slate-400 italic">valeur manquante</span>;

type SourceFilter = "all" | "crm-angola" | "clickmarket" | "coliscod" | "africod-congo" | "shipsen";

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "Toutes les sources" },
  { value: "crm-angola", label: "Inventaire Angola CRM" },
  { value: "clickmarket", label: "Stock entrant — ClickMarket" },
  { value: "coliscod", label: "Stock entrant — Coliscod Angola" },
  { value: "africod-congo", label: "Stock entrant — Africod Congo" },
  { value: "shipsen", label: "Stock entrant — Shipsen" },
];

// Stock & Inventaire (2026-07-08) : lecture seule intégrale des produits CRM Voralis pour
// l'Angola — plus de saisie manuelle, plus de seuil calculé localement (délai appro/stock
// sécurité retirés le 2026-07, ce tableau ne montre plus que la quantité et le statut CRM bruts).
// Depuis 2026-07 : tableaux de stock ENTRANT (expéditions fournisseur → warehouse) par réseau
// logistique en dessous, distincts de ce tableau CRM (produits en stock côté vente, pas
// expéditions) — voir lib/supabase/queries.ts / components/inventory/ShipmentsTable.tsx.
export default function InventoryPage() {
  const [stockRows, setStockRows] = useState<StockCrmRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterProduit, setFilterProduit] = useState("");
  const [selectedSource, setSelectedSource] = useState<SourceFilter>("all");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const stock = await fetchCrmStock();
        if (!cancelled) setStockRows(stock);
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

  // Ce tableau CRM ne couvre plus que l'Angola (demande CEO, 2026-07) — les autres pays sont
  // couverts par les tableaux de stock entrant par réseau logistique ci-dessous.
  const angolaRows = useMemo(() => stockRows.filter((r) => r.pays === "Angola"), [stockRows]);

  const filteredRows = useMemo(
    () =>
      angolaRows.filter(
        (r) => filterProduit.trim() === "" || r.produit.toLowerCase().includes(filterProduit.trim().toLowerCase())
      ),
    [angolaRows, filterProduit]
  );

  if (loading) {
    return (
      <div>
        <Topbar title="Stock & Inventaire" subtitle="Quantités et statut CRM Voralis" />
        <div className="px-6 flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Chargement de l&apos;inventaire…</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Topbar title="Stock & Inventaire" subtitle="Quantités et statut lus en direct depuis le CRM Voralis, lecture seule" />

      <div className="px-6 py-5 space-y-5">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
            <label className="text-xs text-slate-500">Source</label>
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value as SourceFilter)}
              className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
            >
              {SOURCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
            <label className="text-xs text-slate-500">Produit</label>
            <input
              value={filterProduit}
              onChange={(e) => setFilterProduit(e.target.value)}
              placeholder="rechercher…"
              className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
            />
          </div>
        </div>

        {(selectedSource === "all" || selectedSource === "crm-angola") && (
        <Section title="Inventaire Angola CRM">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Pays", "Produit", "Quantité stock", "Statut"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((stock) => (
                  <tr key={stock.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-1.5 font-medium text-slate-900">
                        <span className="text-base">{COUNTRY_FLAGS[stock.pays] ?? "🌍"}</span>
                        {stock.pays}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{stock.produit}</td>
                    <td className="px-3 py-3 text-slate-900 font-medium">
                      {stock.quantiteStock != null ? stock.quantiteStock.toLocaleString("fr-FR") : MISSING}
                    </td>
                    <td className="px-3 py-3">
                      {stock.status ? (
                        <Badge variant={stock.status === "active" ? "green" : "gray"}>{stock.status}</Badge>
                      ) : (
                        MISSING
                      )}
                    </td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-slate-500">Aucun produit CRM Angola pour ce filtre.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
        )}

        {/* Stock entrant (expéditions fournisseur → warehouse) par réseau logistique — distinct
            du tableau CRM ci-dessus (produits en stock côté vente, pas expéditions). */}
        {(selectedSource === "all" || selectedSource === "clickmarket") && (
          <ShipmentsTable title="Stock entrant — ClickMarket" fetchRows={fetchClickMarketShipments} />
        )}
        {(selectedSource === "all" || selectedSource === "coliscod") && (
          <ShipmentsTable title="Stock entrant — Coliscod Angola" fetchRows={fetchColiscodShipments} />
        )}
        {(selectedSource === "all" || selectedSource === "africod-congo") && (
          <ShipmentsTable title="Stock entrant — Africod Congo" fetchRows={fetchAfricodCongoShipments} />
        )}
        {(selectedSource === "all" || selectedSource === "shipsen") && (
          <ShipmentsTable title="Stock entrant — Shipsen" fetchRows={fetchShipsenExpeditions} />
        )}
      </div>
    </div>
  );
}