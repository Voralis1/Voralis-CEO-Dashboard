"use client";
import { useEffect, useMemo, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import { COUNTRY_FLAGS, CANONICAL_COUNTRIES } from "@/lib/countries";
import {
  fetchInventory,
  fetchCrmStock,
  createInventoryRow,
  updateInventoryRow,
  computeInventoryThreshold,
  daysBetweenInclusive,
  type InventoryRow,
  type StockCrmRow,
  type InventoryStatus,
} from "@/lib/inventory";
import { fetchProductStatsByCountry, productStatsKey } from "@/lib/inventoryByProduct";
import { AlertTriangle, Loader2, Info } from "lucide-react";

const STATUS_BADGE: Record<InventoryStatus, { variant: "green" | "yellow" | "red" | "gray"; label: string }> = {
  ok: { variant: "green", label: "🟢 OK" },
  a_commander: { variant: "yellow", label: "🟠 À commander" },
  rupture: { variant: "red", label: "🔴 Rupture" },
  non_configure: { variant: "gray", label: "⚪ Non configuré" },
};

// Stock & Inventaire (2026-07-08) : la LISTE des produits et leur QUANTITÉ viennent désormais du
// CRM Voralis (GET /api/v1/products/stock) — zéro saisie manuelle sur la quantité. `inventory`
// ne stocke plus que la politique par (pays, produit) : délai d'appro, stock de sécurité,
// surcharge de simulation. Un produit CRM sans ligne de politique s'affiche "non configuré",
// pas un 0 implicite — l'enregistrer crée la ligne de politique correspondante.
export default function InventoryPage() {
  const { dateFrom, dateTo } = useFilters();
  const [stockRows, setStockRows] = useState<StockCrmRow[]>([]);
  const [policyRows, setPolicyRows] = useState<InventoryRow[]>([]);
  const [productStats, setProductStats] = useState<Map<string, { totalLeads: number; ruptureStock: number; tauxRuptureStock: number | null; livres: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [filterPays, setFilterPays] = useState<string>("all");
  const [filterProduit, setFilterProduit] = useState("");

  const [drafts, setDrafts] = useState<Record<string, Partial<Record<"delai_appro_jours" | "stock_securite" | "ventes_moyennes_jour_override", string>>>>({});

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [stock, policies, stats] = await Promise.all([fetchCrmStock(), fetchInventory(), fetchProductStatsByCountry(dateFrom, dateTo)]);
      setStockRows(stock);
      setPolicyRows(policies);
      setProductStats(stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await loadAll();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  const nbJours = daysBetweenInclusive(dateFrom, dateTo);

  const policyByKey = new Map(policyRows.map((r) => [productStatsKey(r.pays, r.produit), r]));

  const scopedStock = stockRows.filter((r) => r.pays != null);
  const outOfScopeStock = stockRows.filter((r) => r.pays == null);

  const filteredRows = useMemo(
    () =>
      scopedStock.filter(
        (r) =>
          (filterPays === "all" || r.pays === filterPays) &&
          (filterProduit.trim() === "" || r.produit.toLowerCase().includes(filterProduit.trim().toLowerCase()))
      ),
    [scopedStock, filterPays, filterProduit]
  );

  function draftValue(key: string, policy: InventoryRow | undefined, field: "delai_appro_jours" | "stock_securite" | "ventes_moyennes_jour_override"): string {
    const draft = drafts[key]?.[field];
    if (draft !== undefined) return draft;
    const value = policy?.[field];
    return value == null ? "" : String(value);
  }

  function setDraft(key: string, field: "delai_appro_jours" | "stock_securite" | "ventes_moyennes_jour_override", value: string) {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  async function handleSaveRow(pays: string, produit: string, key: string, policy: InventoryRow | undefined) {
    const draft = drafts[key];
    if (!draft) return;

    setSavingKey(key);
    setError(null);
    try {
      const patch = {
        delai_appro_jours: draft.delai_appro_jours === undefined ? (policy?.delai_appro_jours ?? null) : draft.delai_appro_jours === "" ? null : Number(draft.delai_appro_jours),
        stock_securite: draft.stock_securite === undefined ? (policy?.stock_securite ?? null) : draft.stock_securite === "" ? null : Number(draft.stock_securite),
        ventes_moyennes_jour_override:
          draft.ventes_moyennes_jour_override === undefined
            ? (policy?.ventes_moyennes_jour_override ?? null)
            : draft.ventes_moyennes_jour_override === ""
              ? null
              : Number(draft.ventes_moyennes_jour_override),
      };

      const saved = policy ? await updateInventoryRow(policy.id, patch) : await createInventoryRow({ pays, produit, ...patch });

      setPolicyRows((prev) => (policy ? prev.map((r) => (r.id === policy.id ? saved : r)) : [...prev, saved]));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return (
      <div>
        <Topbar title="Stock & Inventaire" subtitle="Quantités CRM Voralis, seuil de réapprovisionnement calculé" />
        <div className="px-6 flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Chargement de l&apos;inventaire…</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Topbar title="Stock & Inventaire" subtitle="Quantités CRM Voralis (lecture seule), seuil de réapprovisionnement calculé" />

      <div className="px-6 py-5 space-y-5">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-xs">
          <Info size={14} className="shrink-0 mt-0.5" />
          <p>
            Quantité en stock lue en direct depuis le CRM Voralis (<code>/api/v1/products/stock</code>) — plus aucune
            saisie manuelle. Le filtre date global (<strong>{dateFrom} → {dateTo}</strong>, {nbJours} jour
            {nbJours > 1 ? "s" : ""}) s&apos;applique au calcul des ventes moyennes/jour et au taux out_of_stock.
            Seuil = ventes moyennes/jour × délai d&apos;appro + stock de sécurité, calculé à la volée (jamais stocké).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
            <label className="text-xs text-slate-500">Pays</label>
            <select value={filterPays} onChange={(e) => setFilterPays(e.target.value)} className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md">
              <option value="all">Tous les pays</option>
              {CANONICAL_COUNTRIES.map((c) => (
                <option key={c.name} value={c.name}>{c.flag} {c.name}</option>
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
                  {["Pays", "Produit", "Quantité stock (CRM)", "Délai appro (j)", "Stock sécurité", "Ventes moy/jour", "Seuil alerte", "Statut", "Taux out_of_stock", ""].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((stock) => {
                  const pays = stock.pays!;
                  const key = productStatsKey(pays, stock.produit);
                  const policy = policyByKey.get(key);
                  const stats = productStats.get(key);
                  const livres = stats?.livres ?? 0;
                  const ventesObservees = livres / nbJours;
                  const delai = draftValue(key, policy, "delai_appro_jours") === "" ? null : Number(draftValue(key, policy, "delai_appro_jours"));
                  const stockSec = draftValue(key, policy, "stock_securite") === "" ? null : Number(draftValue(key, policy, "stock_securite"));
                  const override = draftValue(key, policy, "ventes_moyennes_jour_override") === "" ? null : Number(draftValue(key, policy, "ventes_moyennes_jour_override"));
                  const threshold = computeInventoryThreshold(stock.quantiteStock, delai, stockSec, ventesObservees, override);
                  const badge = STATUS_BADGE[threshold.statut];
                  const hasDraft = !!drafts[key] && Object.keys(drafts[key]).length > 0;

                  return (
                    <tr key={stock.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-1.5 font-medium text-slate-900">
                          <span className="text-base">{COUNTRY_FLAGS[pays] ?? "🌍"}</span>
                          {pays}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{stock.produit}</td>
                      <td className="px-3 py-3 text-slate-900 font-medium">{stock.quantiteStock.toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          placeholder="non renseigné"
                          value={draftValue(key, policy, "delai_appro_jours")}
                          onChange={(e) => setDraft(key, "delai_appro_jours", e.target.value)}
                          className="w-24 px-2 py-1 text-xs bg-white border border-slate-300 rounded-md placeholder:italic placeholder:text-slate-400"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          placeholder="non renseigné"
                          value={draftValue(key, policy, "stock_securite")}
                          onChange={(e) => setDraft(key, "stock_securite", e.target.value)}
                          className="w-24 px-2 py-1 text-xs bg-white border border-slate-300 rounded-md placeholder:italic placeholder:text-slate-400"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-slate-700">{threshold.ventesMoyennesJour.toFixed(2)}{threshold.ventesSource === "override" && <span className="ml-1 text-[9px] text-amber-600">(surcharge)</span>}</span>
                          <input
                            type="number"
                            placeholder="surcharge (opt.)"
                            value={draftValue(key, policy, "ventes_moyennes_jour_override")}
                            onChange={(e) => setDraft(key, "ventes_moyennes_jour_override", e.target.value)}
                            className="w-24 px-2 py-1 text-[10px] bg-white border border-slate-300 rounded-md placeholder:italic placeholder:text-slate-400"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{threshold.seuilAlerte != null ? threshold.seuilAlerte.toFixed(1) : "—"}</td>
                      <td className="px-3 py-3">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        {stats?.tauxRuptureStock != null ? (
                          <span className={stats.tauxRuptureStock >= 10 ? "text-red-600 font-semibold" : "text-slate-700"}>
                            {stats.tauxRuptureStock}%
                          </span>
                        ) : (
                          <span className="text-slate-400" title="Ce réseau n'expose pas de statut rupture de stock">non disponible</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <button
                          onClick={() => handleSaveRow(pays, stock.produit, key, policy)}
                          disabled={!hasDraft || savingKey === key}
                          className="text-xs px-2 py-1 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                        >
                          {savingKey === key ? <Loader2 size={11} className="animate-spin" /> : "Enregistrer"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-4 text-center text-slate-500">Aucun produit CRM pour ce filtre.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        {outOfScopeStock.length > 0 && (
          <p className="text-xs text-amber-600">
            Produits CRM hors périmètre COD (code pays non reconnu, exclus du tableau) :{" "}
            {outOfScopeStock.map((p) => `${p.produit} (${p.id})`).join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}