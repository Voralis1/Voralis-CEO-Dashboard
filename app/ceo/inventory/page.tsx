"use client";
import { useEffect, useMemo, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { COUNTRY_FLAGS } from "@/lib/countries";
import { fetchInventory, fetchCrmStock, type InventoryRow, type StockCrmRow } from "@/lib/inventory";
import { productStatsKey } from "@/lib/inventoryByProduct";
import { AlertTriangle, Loader2 } from "lucide-react";

const MISSING = <span className="text-slate-400 italic">valeur manquante</span>;

// Stock & Inventaire (2026-07-08) : lecture seule intégrale, tous les produits CRM Voralis
// affichés (y compris hors périmètre COD) — plus de saisie manuelle, plus de seuil calculé
// localement. Le statut vient directement du champ `status` de l'API CRM, pas d'un calcul
// dérivé d'un taux de rupture ou de ventes moyennes (retirés de ce tableau).
export default function InventoryPage() {
  const [stockRows, setStockRows] = useState<StockCrmRow[]>([]);
  const [policyRows, setPolicyRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterPays, setFilterPays] = useState<string>("all");
  const [filterProduit, setFilterProduit] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [stock, policies] = await Promise.all([fetchCrmStock(), fetchInventory()]);
        if (!cancelled) {
          setStockRows(stock);
          setPolicyRows(policies);
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
  }, []);

  const policyByKey = new Map(policyRows.map((r) => [productStatsKey(r.pays, r.produit), r]));

  const paysOptions = useMemo(() => [...new Set(stockRows.map((r) => r.pays))].sort(), [stockRows]);

  const filteredRows = useMemo(
    () =>
      stockRows.filter(
        (r) =>
          (filterPays === "all" || r.pays === filterPays) &&
          (filterProduit.trim() === "" || r.produit.toLowerCase().includes(filterProduit.trim().toLowerCase()))
      ),
    [stockRows, filterPays, filterProduit]
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
            <label className="text-xs text-slate-500">Pays</label>
            <select value={filterPays} onChange={(e) => setFilterPays(e.target.value)} className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md">
              <option value="all">Tous les pays</option>
              {paysOptions.map((p) => (
                <option key={p} value={p}>{COUNTRY_FLAGS[p] ?? "🌍"} {p}</option>
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

        <Section title="Inventaire par pays / produit">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Pays", "Produit", "Quantité stock", "Délai appro (j)", "Stock sécurité", "Statut"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((stock) => {
                  const policy = policyByKey.get(productStatsKey(stock.pays, stock.produit));
                  return (
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
                      <td className="px-3 py-3 text-slate-700">
                        {policy?.delai_appro_jours != null ? policy.delai_appro_jours : MISSING}
                      </td>
                      <td className="px-3 py-3 text-slate-700">
                        {policy?.stock_securite != null ? policy.stock_securite : MISSING}
                      </td>
                      <td className="px-3 py-3">
                        {stock.status ? (
                          <Badge variant={stock.status === "active" ? "green" : "gray"}>{stock.status}</Badge>
                        ) : (
                          MISSING
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-slate-500">Aucun produit CRM pour ce filtre.</td>
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