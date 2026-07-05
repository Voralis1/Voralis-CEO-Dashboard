"use client";
import { useEffect, useMemo, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import { COUNTRY_FLAGS, CANONICAL_COUNTRIES } from "@/lib/countries";
import {
  fetchInventory,
  createInventoryRow,
  updateInventoryRow,
  deleteInventoryRow,
  computeInventoryThreshold,
  daysBetweenInclusive,
  type InventoryRow,
  type InventoryStatus,
} from "@/lib/inventory";
import { fetchProductStatsByCountry, productStatsKey } from "@/lib/inventoryByProduct";
import { AlertTriangle, Loader2, Info, Plus, Trash2 } from "lucide-react";

const STATUS_BADGE: Record<InventoryStatus, { variant: "green" | "yellow" | "red" | "gray"; label: string }> = {
  ok: { variant: "green", label: "🟢 OK" },
  a_commander: { variant: "yellow", label: "🟠 À commander" },
  rupture: { variant: "red", label: "🔴 Rupture" },
  non_configure: { variant: "gray", label: "⚪ Non configuré" },
};

export default function InventoryPage() {
  const { dateFrom, dateTo } = useFilters();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [productStats, setProductStats] = useState<Map<string, { totalLeads: number; ruptureStock: number; tauxRuptureStock: number | null; livres: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [filterPays, setFilterPays] = useState<string>("all");
  const [filterProduit, setFilterProduit] = useState("");

  const [newRow, setNewRow] = useState({ pays: CANONICAL_COUNTRIES[0].name, produit: "", quantite_stock: "", delai_appro_jours: "", stock_securite: "" });
  const [creating, setCreating] = useState(false);

  const [drafts, setDrafts] = useState<Record<string, Partial<Record<"delai_appro_jours" | "stock_securite" | "ventes_moyennes_jour_override" | "quantite_stock", string>>>>({});

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [inv, stats] = await Promise.all([fetchInventory(), fetchProductStatsByCountry(dateFrom, dateTo)]);
      setRows(inv);
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

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (filterPays === "all" || r.pays === filterPays) &&
          (filterProduit.trim() === "" || r.produit.toLowerCase().includes(filterProduit.trim().toLowerCase()))
      ),
    [rows, filterPays, filterProduit]
  );

  function draftValue(row: InventoryRow, field: "delai_appro_jours" | "stock_securite" | "ventes_moyennes_jour_override" | "quantite_stock"): string {
    const draft = drafts[row.id]?.[field];
    if (draft !== undefined) return draft;
    const value = row[field];
    return value == null ? "" : String(value);
  }

  function setDraft(id: string, field: "delai_appro_jours" | "stock_securite" | "ventes_moyennes_jour_override" | "quantite_stock", value: string) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  async function handleSaveRow(row: InventoryRow) {
    const draft = drafts[row.id];
    if (!draft) return;

    setSavingId(row.id);
    setError(null);
    try {
      const patch: Record<string, number | null> = {};
      if (draft.quantite_stock !== undefined) patch.quantite_stock = Number(draft.quantite_stock) || 0;
      if (draft.delai_appro_jours !== undefined) patch.delai_appro_jours = draft.delai_appro_jours === "" ? null : Number(draft.delai_appro_jours);
      if (draft.stock_securite !== undefined) patch.stock_securite = draft.stock_securite === "" ? null : Number(draft.stock_securite);
      if (draft.ventes_moyennes_jour_override !== undefined)
        patch.ventes_moyennes_jour_override = draft.ventes_moyennes_jour_override === "" ? null : Number(draft.ventes_moyennes_jour_override);

      const updated = await updateInventoryRow(row.id, patch);
      setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteInventoryRow(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    }
  }

  async function handleCreate() {
    if (!newRow.produit.trim() || !newRow.quantite_stock) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createInventoryRow({
        pays: newRow.pays,
        produit: newRow.produit.trim(),
        quantite_stock: Number(newRow.quantite_stock) || 0,
        delai_appro_jours: newRow.delai_appro_jours === "" ? null : Number(newRow.delai_appro_jours),
        stock_securite: newRow.stock_securite === "" ? null : Number(newRow.stock_securite),
        ventes_moyennes_jour_override: null,
      });
      setRows((prev) => [...prev, created]);
      setNewRow((f) => ({ ...f, produit: "", quantite_stock: "", delai_appro_jours: "", stock_securite: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div>
        <Topbar title="Stock & Inventaire" subtitle="Quantités par pays/produit, seuil de réapprovisionnement calculé" />
        <div className="px-6 flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Chargement de l&apos;inventaire…</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Topbar title="Stock & Inventaire" subtitle="Quantités par pays/produit, seuil de réapprovisionnement calculé" />

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
            Le filtre date global (<strong>{dateFrom} → {dateTo}</strong>, {nbJours} jour{nbJours > 1 ? "s" : ""}) s&apos;applique
            au calcul des ventes moyennes/jour et au taux out_of_stock — <strong>pas</strong> à la quantité en stock, qui est un
            état courant instantané. Seuil = ventes moyennes/jour × délai d&apos;appro + stock de sécurité, calculé à la volée
            (jamais stocké). Taux out_of_stock disponible uniquement pour ClickMarket (Gabon) — les 3 autres réseaux
            n&apos;exposent pas ce statut, affiché &ldquo;non disponible&rdquo; plutôt que 0%.
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
                  {["Pays", "Produit", "Quantité stock", "Délai appro (j)", "Stock sécurité", "Ventes moy/jour", "Seuil alerte", "Statut", "Taux out_of_stock", ""].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const stats = productStats.get(productStatsKey(row.pays, row.produit));
                  const livres = stats?.livres ?? 0;
                  const ventesObservees = livres / nbJours;
                  const quantite = Number(draftValue(row, "quantite_stock")) || 0;
                  const delai = draftValue(row, "delai_appro_jours") === "" ? null : Number(draftValue(row, "delai_appro_jours"));
                  const stockSec = draftValue(row, "stock_securite") === "" ? null : Number(draftValue(row, "stock_securite"));
                  const override = draftValue(row, "ventes_moyennes_jour_override") === "" ? null : Number(draftValue(row, "ventes_moyennes_jour_override"));
                  const threshold = computeInventoryThreshold(quantite, delai, stockSec, ventesObservees, override);
                  const badge = STATUS_BADGE[threshold.statut];
                  const hasDraft = !!drafts[row.id] && Object.keys(drafts[row.id]).length > 0;

                  return (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-1.5 font-medium text-slate-900">
                          <span className="text-base">{COUNTRY_FLAGS[row.pays] ?? "🌍"}</span>
                          {row.pays}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{row.produit}</td>
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          value={draftValue(row, "quantite_stock")}
                          onChange={(e) => setDraft(row.id, "quantite_stock", e.target.value)}
                          className="w-20 px-2 py-1 text-xs bg-white border border-slate-300 rounded-md"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          placeholder="non renseigné"
                          value={draftValue(row, "delai_appro_jours")}
                          onChange={(e) => setDraft(row.id, "delai_appro_jours", e.target.value)}
                          className="w-24 px-2 py-1 text-xs bg-white border border-slate-300 rounded-md placeholder:italic placeholder:text-slate-400"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          placeholder="non renseigné"
                          value={draftValue(row, "stock_securite")}
                          onChange={(e) => setDraft(row.id, "stock_securite", e.target.value)}
                          className="w-24 px-2 py-1 text-xs bg-white border border-slate-300 rounded-md placeholder:italic placeholder:text-slate-400"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-slate-700">{threshold.ventesMoyennesJour.toFixed(2)}{threshold.ventesSource === "override" && <span className="ml-1 text-[9px] text-amber-600">(surcharge)</span>}</span>
                          <input
                            type="number"
                            placeholder="surcharge (opt.)"
                            value={draftValue(row, "ventes_moyennes_jour_override")}
                            onChange={(e) => setDraft(row.id, "ventes_moyennes_jour_override", e.target.value)}
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
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleSaveRow(row)}
                            disabled={!hasDraft || savingId === row.id}
                            className="text-xs px-2 py-1 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                          >
                            {savingId === row.id ? <Loader2 size={11} className="animate-spin" /> : "Enregistrer"}
                          </button>
                          <button onClick={() => handleDelete(row.id)} className="text-slate-400 hover:text-red-600 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-4 text-center text-slate-500">Aucune ligne d&apos;inventaire — ajoute-en une ci-dessous.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-end gap-2 p-3 mt-4 rounded-lg bg-slate-50 border border-slate-200">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Pays</label>
              <select
                value={newRow.pays}
                onChange={(e) => setNewRow((f) => ({ ...f, pays: e.target.value }))}
                className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              >
                {CANONICAL_COUNTRIES.map((c) => (
                  <option key={c.name} value={c.name}>{c.flag} {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Produit</label>
              <input
                value={newRow.produit}
                onChange={(e) => setNewRow((f) => ({ ...f, produit: e.target.value }))}
                placeholder="ex. Marukaya cream"
                className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md w-48"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Quantité stock</label>
              <input
                type="number"
                value={newRow.quantite_stock}
                onChange={(e) => setNewRow((f) => ({ ...f, quantite_stock: e.target.value }))}
                className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md w-24"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Délai appro (j)</label>
              <input
                type="number"
                value={newRow.delai_appro_jours}
                onChange={(e) => setNewRow((f) => ({ ...f, delai_appro_jours: e.target.value }))}
                placeholder="optionnel"
                className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md w-24 placeholder:italic"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Stock sécurité</label>
              <input
                type="number"
                value={newRow.stock_securite}
                onChange={(e) => setNewRow((f) => ({ ...f, stock_securite: e.target.value }))}
                placeholder="optionnel"
                className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md w-24 placeholder:italic"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-40"
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Ajouter
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
