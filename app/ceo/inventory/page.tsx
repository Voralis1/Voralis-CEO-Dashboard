"use client";
import { useEffect, useMemo, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { COUNTRY_FLAGS } from "@/lib/countries";
import { fetchCrmStock, type StockCrmRow } from "@/lib/inventory";
import { fetchPublicMarketSettings } from "@/lib/marketSettings";
import {
  fetchClickMarketShipments,
  fetchColiscodShipments,
  fetchAfricodCongoShipments,
  fetchShipsenExpeditions,
} from "@/lib/supabase/queries";
import ShipmentsTable from "@/components/inventory/ShipmentsTable";
import { AlertTriangle, Loader2 } from "lucide-react";

const MISSING = <span className="text-slate-400 italic">valeur manquante</span>;

const ALL_MARKETS = "all";

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
  const [marketOptions, setMarketOptions] = useState<string[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<string>(ALL_MARKETS);

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

  useEffect(() => {
    let cancelled = false;
    // Liste des marchés via market_settings — source unique de vérité, jamais une liste codée
    // en dur : un nouveau pays (ex. Centrafrique) apparaît ici automatiquement dès sa première
    // commande, sans intervention (voir lib/countries.ts).
    fetchPublicMarketSettings()
      .then((settings) => {
        if (!cancelled) setMarketOptions(settings.map((s) => s.pays));
      })
      .catch(() => {
        // Onglets par marché optionnels — un échec de chargement laisse juste "Tous les marchés".
      });
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

  const showCrmAngola = selectedMarket === ALL_MARKETS || selectedMarket === "Angola";
  const shipmentsCountryFilter = selectedMarket === ALL_MARKETS ? undefined : selectedMarket;

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
            <label className="text-xs text-slate-500">Produit</label>
            <input
              value={filterProduit}
              onChange={(e) => setFilterProduit(e.target.value)}
              placeholder="rechercher…"
              className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
            />
          </div>
        </div>

        {/* Petits onglets — un marché à la fois, même pattern que "Réseaux Logistiques" */}
        <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-0">
          <button
            onClick={() => setSelectedMarket(ALL_MARKETS)}
            className={
              "px-3.5 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors " +
              (selectedMarket === ALL_MARKETS
                ? "border-emerald-500 text-emerald-700 bg-emerald-50"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50")
            }
          >
            Tous les marchés
          </button>
          {marketOptions.map((pays) => (
            <button
              key={pays}
              onClick={() => setSelectedMarket(pays)}
              className={
                "px-3.5 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors " +
                (selectedMarket === pays
                  ? "border-emerald-500 text-emerald-700 bg-emerald-50"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50")
              }
            >
              {COUNTRY_FLAGS[pays] ?? "🌍"} {pays}
            </button>
          ))}
        </div>

        {showCrmAngola && (
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
            du tableau CRM ci-dessus (produits en stock côté vente, pas expéditions). Les 4
            réseaux restent affichés côte à côte (un marché ne correspond qu'à un sous-ensemble
            de réseaux — ex. Mali n'existe que côté Shipsen) ; le tableau filtré sur un marché
            sans données pour ce réseau affiche simplement "Aucune expédition". */}
        <ShipmentsTable title="Stock entrant — ClickMarket" fetchRows={fetchClickMarketShipments} countryFilter={shipmentsCountryFilter} />
        <ShipmentsTable title="Stock entrant — Coliscod Angola" fetchRows={fetchColiscodShipments} countryFilter={shipmentsCountryFilter} />
        <ShipmentsTable title="Stock entrant — Africod Congo" fetchRows={fetchAfricodCongoShipments} countryFilter={shipmentsCountryFilter} />
        <ShipmentsTable title="Stock entrant — Shipsen" fetchRows={fetchShipsenExpeditions} countryFilter={shipmentsCountryFilter} />
      </div>
    </div>
  );
}