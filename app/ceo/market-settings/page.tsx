"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { COUNTRY_FLAGS } from "@/lib/countries";
import {
  DELIVERY_FEE_USD,
  deliveryFeeLocal,
  fetchMarketSettings,
  updateMarketSettings,
  type MarketSettings,
  type MarketSettingsUpdate,
} from "@/lib/marketSettings";
import { AlertTriangle, Loader2, Save, Lock } from "lucide-react";

// Champs pouvant être NULL ("pas encore saisi" — jamais confondu avec 0, cf. lib/margin.ts).
type NullableField = Exclude<keyof MarketSettingsUpdate, "cogs_devise" | "fx_to_usd" | "marge_plancher_t">;

const NULLABLE_COLUMNS: { field: NullableField; label: string; step?: string }[] = [
  { field: "cogs_produit", label: "COGS produit", step: "0.01" },
  { field: "cout_call_center_par_commande", label: "Coût call center / commande", step: "0.01" },
  { field: "taux_retour", label: "Taux de retour %", step: "0.01" },
  { field: "conf_pct", label: "Taux confirmation %", step: "0.01" },
  { field: "dr_pct", label: "Taux livraison %", step: "0.01" },
  { field: "frais_retour_local", label: "Frais de retour (local)", step: "0.01" },
  { field: "aov_override", label: "AOV simulé (Seuils, optionnel)", step: "0.01" },
];

function fmtLocalAmount(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value) + " " + currency;
  } catch {
    return `${Math.round(value).toLocaleString("fr-FR")} ${currency}`;
  }
}

export default function MarketSettingsPage() {
  const [settings, setSettings] = useState<MarketSettings[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MarketSettingsUpdate>>({});
  const [savingPays, setSavingPays] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchMarketSettings();
        if (!cancelled) setSettings(data);
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

  // NULL = pas encore saisi (input vide) — ne jamais afficher "0" à la place, sinon le CEO ne
  // peut plus distinguer "coût confirmé nul" de "je n'ai pas encore rempli ce champ".
  function nullableDraftValue(row: MarketSettings, field: NullableField): number | null {
    const draft = drafts[row.pays]?.[field];
    return draft !== undefined ? (draft as number | null) : row[field];
  }

  function fxDraftValue(row: MarketSettings): number {
    const draft = drafts[row.pays]?.fx_to_usd;
    return draft !== undefined ? Number(draft) : row.fx_to_usd;
  }

  function margePlancherDraftValue(row: MarketSettings): number {
    const draft = drafts[row.pays]?.marge_plancher_t;
    return draft !== undefined ? Number(draft) : row.marge_plancher_t;
  }

  function draftCogsDevise(row: MarketSettings): "USD" | "local" {
    return drafts[row.pays]?.cogs_devise ?? row.cogs_devise;
  }

  function setDraft(pays: string, field: keyof MarketSettingsUpdate, value: number | string | null) {
    setDrafts((prev) => ({ ...prev, [pays]: { ...prev[pays], [field]: value } }));
  }

  async function handleSave(row: MarketSettings) {
    const patch = drafts[row.pays];
    if (!patch || Object.keys(patch).length === 0) return;

    setSavingPays(row.pays);
    setError(null);
    try {
      const updated = await updateMarketSettings(row.pays, patch);
      setSettings((prev) => prev.map((s) => (s.pays === row.pays ? updated : s)));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.pays];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSavingPays(null);
    }
  }

  return (
    <div>
      <Topbar
        title="Paramètres marché"
        subtitle="Source unique de vérité pour le FX et les coûts — utilisée par tous les autres écrans"
      />

      <div className="px-6 py-5 space-y-5">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
          <Lock size={14} className="shrink-0 mt-0.5" />
          <p>
            Le pays et la devise locale sont verrouillés (mapping validé, non éditable) pour éviter tout bug de
            devise incorrecte assignée à un pays. Les frais de livraison sont une constante globale de{" "}
            {DELIVERY_FEE_USD} USD/commande, convertie automatiquement via le FX de chaque pays — non éditable
            individuellement. Un champ laissé <strong>vide</strong> = pas encore saisi (les écrans Rentabilité et
            Trésorerie afficheront &ldquo;donnée manquante&rdquo;) — ce n&apos;est pas la même chose qu&apos;un{" "}
            <strong>0</strong> explicite. Exception : <strong>AOV simulé</strong> — laissé vide (cas normal), le module
            Seuils utilise l&apos;AOV réellement observé (CA livré encaissé ÷ livrées) ; renseigné, il sert uniquement à
            simuler &ldquo;et si l&apos;AOV était de X ?&rdquo;, sans remplacer la donnée réelle affichée ailleurs.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Chargement des paramètres marché…</span>
          </div>
        ) : (
          <Section title="Marchés · FX, coûts et seuils par pays">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Pays</th>
                    <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Devise</th>
                    <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">FX → USD</th>
                    {NULLABLE_COLUMNS.map((col) => (
                      <th key={col.field} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">
                        {col.label}
                      </th>
                    ))}
                    <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">Devise COGS</th>
                    <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">
                      Marge plancher T (confidentiel)
                    </th>
                    <th className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">
                      Frais livraison local
                    </th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {settings.map((row) => {
                    const hasDraft = !!drafts[row.pays] && Object.keys(drafts[row.pays]).length > 0;
                    const fx = fxDraftValue(row);
                    return (
                      <tr key={row.pays} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2 font-medium text-slate-900">
                            <span className="text-base">{COUNTRY_FLAGS[row.pays] ?? "🌍"}</span>
                            {row.pays}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant="gray">{row.devise_locale}</Badge>
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            step="0.000001"
                            value={fx}
                            onChange={(e) => setDraft(row.pays, "fx_to_usd", e.target.valueAsNumber || 0)}
                            className="w-28 px-2 py-1.5 text-xs bg-white text-slate-900 border border-slate-300 rounded-md focus:outline-none focus:border-emerald-500 transition-colors"
                          />
                        </td>
                        {NULLABLE_COLUMNS.map((col) => {
                          const value = nullableDraftValue(row, col.field);
                          return (
                            <td key={col.field} className="px-3 py-3">
                              <input
                                type="number"
                                step={col.step}
                                placeholder="non renseigné"
                                value={value ?? ""}
                                onChange={(e) =>
                                  setDraft(row.pays, col.field, e.target.value === "" ? null : e.target.valueAsNumber)
                                }
                                className="w-28 px-2 py-1.5 text-xs bg-white text-slate-900 border border-slate-300 rounded-md placeholder:text-slate-400 placeholder:italic focus:outline-none focus:border-emerald-500 transition-colors"
                              />
                            </td>
                          );
                        })}
                        <td className="px-3 py-3">
                          <select
                            value={draftCogsDevise(row)}
                            onChange={(e) => setDraft(row.pays, "cogs_devise", e.target.value)}
                            className="px-2 py-1.5 text-xs bg-white text-slate-900 border border-slate-300 rounded-md focus:outline-none focus:border-emerald-500 transition-colors"
                          >
                            <option value="USD">USD</option>
                            <option value="local">local</option>
                          </select>
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            step="0.01"
                            value={margePlancherDraftValue(row)}
                            onChange={(e) => setDraft(row.pays, "marge_plancher_t", e.target.valueAsNumber || 0)}
                            className="w-28 px-2 py-1.5 text-xs bg-white text-slate-900 border border-slate-300 rounded-md focus:outline-none focus:border-emerald-500 transition-colors"
                          />
                        </td>
                        <td className="px-3 py-3 text-slate-700 whitespace-nowrap">
                          {fmtLocalAmount(deliveryFeeLocal(fx), row.devise_locale)}
                        </td>
                        <td className="px-3 py-3">
                          <button
                            onClick={() => handleSave(row)}
                            disabled={!hasDraft || savingPays === row.pays}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {savingPays === row.pays ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Save size={12} />
                            )}
                            Enregistrer
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
