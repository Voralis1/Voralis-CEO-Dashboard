"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import { fmtCurrency } from "@/lib/dashboardData";
import { COUNTRY_FLAGS } from "@/lib/countries";
import { fetchPublicMarketSettings, type PublicMarketSettings } from "@/lib/marketSettings";
import { fetchTreasuryCashData, type TreasuryCashData } from "@/lib/treasury";
import {
  fetchCashHoldings,
  createCashHolding,
  deleteCashHolding,
  createCashOutManual,
  deleteCashOutManual,
  type CashHolding,
} from "@/lib/cashOps";
import { AlertTriangle, Loader2, Plus, Trash2, Info } from "lucide-react";

const STATUT_LABELS: Record<CashHolding["statut_rapatriement"], { label: string; variant: "yellow" | "blue" | "green" }> = {
  en_attente: { label: "En attente", variant: "yellow" },
  en_cours: { label: "En cours", variant: "blue" },
  rapatrie: { label: "Rapatrié", variant: "green" },
};

export default function TresoreriePage() {
  const { dateFrom, dateTo } = useFilters();
  const [marketSettings, setMarketSettings] = useState<PublicMarketSettings[]>([]);
  const [cashData, setCashData] = useState<TreasuryCashData | null>(null);
  const [holdings, setHoldings] = useState<CashHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [holdingForm, setHoldingForm] = useState({ entite: "", pays: "", montant_detenu: "", date_derniere_remise: "", statut_rapatriement: "en_attente" as CashHolding["statut_rapatriement"] });
  const [holdingSaving, setHoldingSaving] = useState(false);

  const [cashOutForm, setCashOutForm] = useState({ type: "salaire_local" as "salaire_local" | "autre", pays: "", montant: "", description: "", date: new Date().toISOString().split("T")[0] });
  const [cashOutSaving, setCashOutSaving] = useState(false);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [settings, cash, holdingsList] = await Promise.all([
        fetchPublicMarketSettings(),
        fetchTreasuryCashData(dateFrom, dateTo),
        fetchCashHoldings(),
      ]);
      setMarketSettings(settings);
      setCashData(cash);
      setHoldings(holdingsList);
      setHoldingForm((f) => ({ ...f, pays: f.pays || settings[0]?.pays || "" }));
      setCashOutForm((f) => ({ ...f, pays: f.pays || settings[0]?.pays || "" }));
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

  const currencyByPays = new Map(marketSettings.map((s) => [s.pays, s.devise_locale]));

  async function handleAddHolding() {
    if (!holdingForm.entite || !holdingForm.pays || !holdingForm.montant_detenu) return;
    setHoldingSaving(true);
    setError(null);
    try {
      const created = await createCashHolding({
        entite: holdingForm.entite,
        pays: holdingForm.pays,
        montant_detenu: Number(holdingForm.montant_detenu),
        date_derniere_remise: holdingForm.date_derniere_remise || null,
        statut_rapatriement: holdingForm.statut_rapatriement,
      });
      setHoldings((prev) => [...prev, created]);
      setHoldingForm((f) => ({ ...f, entite: "", montant_detenu: "", date_derniere_remise: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setHoldingSaving(false);
    }
  }

  async function handleDeleteHolding(id: string) {
    try {
      await deleteCashHolding(id);
      setHoldings((prev) => prev.filter((h) => h.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    }
  }

  async function handleAddCashOut() {
    if (!cashOutForm.pays || !cashOutForm.montant || !cashOutForm.date) return;
    setCashOutSaving(true);
    setError(null);
    try {
      await createCashOutManual({
        type: cashOutForm.type,
        pays: cashOutForm.pays,
        montant: Number(cashOutForm.montant),
        description: cashOutForm.description || null,
        date: cashOutForm.date,
      });
      setCashOutForm((f) => ({ ...f, montant: "", description: "" }));
      await loadAll(); // recharge l'agrégat cash out par pays
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setCashOutSaving(false);
    }
  }

  if (loading || !cashData) {
    return (
      <div>
        <Topbar title="Trésorerie" subtitle="Cash encaissé, cash détenu, cash sorti — par pays, base livré + encaissé" />
        <div className="px-6 flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Chargement des données…</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Topbar
        title="Trésorerie"
        subtitle="Cash encaissé, cash détenu, cash sorti — par pays, base livré + encaissé, devises jamais additionnées"
      />

      <div className="px-6 py-5 space-y-5">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {/* ═══ Cash encaissé par pays ═══ */}
        <Section title="Cash encaissé par pays">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Pays", "Livrées", "CA livré encaissé", "Frais livraison (local)", "Cash encaissé"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cashData.cashByCountry.map((r) => (
                  <tr key={r.countryName} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-medium text-slate-900">
                        <span className="text-base">{COUNTRY_FLAGS[r.countryName] ?? "🌍"}</span>
                        {r.countryName}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{r.livres.toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3 text-slate-700">{fmtCurrency(r.caLivre, r.currency)}</td>
                    <td className="px-3 py-3 text-slate-500">−{fmtCurrency(r.fraisLivraisonTotal, r.currency)}</td>
                    <td className="px-3 py-3 font-semibold text-emerald-600">{fmtCurrency(r.cashEncaisse, r.currency)}</td>
                  </tr>
                ))}
                {cashData.cashByCountry.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-slate-500">Aucune commande livrée sur cette période.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ═══ Cash chez qui ═══ */}
        <Section title="Cash chez qui · cash détenu, pas encore rapatrié">
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Entité", "Pays", "Devise", "Montant détenu", "Dernière remise", "Statut", ""].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const statut = STATUT_LABELS[h.statut_rapatriement];
                  return (
                    <tr key={h.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3 font-medium text-slate-900">{h.entite}</td>
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-1.5">
                          <span className="text-base">{COUNTRY_FLAGS[h.pays] ?? "🌍"}</span>
                          {h.pays}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-500">{currencyByPays.get(h.pays) ?? "—"}</td>
                      <td className="px-3 py-3 font-semibold text-slate-900">
                        {fmtCurrency(h.montant_detenu, currencyByPays.get(h.pays) ?? "")}
                      </td>
                      <td className="px-3 py-3 text-slate-500">{h.date_derniere_remise ?? "—"}</td>
                      <td className="px-3 py-3">
                        <Badge variant={statut.variant}>{statut.label}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        <button onClick={() => handleDeleteHolding(h.id)} className="text-slate-400 hover:text-red-600 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {holdings.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-slate-500">
                      Aucune donnée saisie — ajoute une entrée ci-dessous.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-end gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Entité</label>
              <input
                value={holdingForm.entite}
                onChange={(e) => setHoldingForm((f) => ({ ...f, entite: e.target.value }))}
                placeholder="ex. Motoboy Angola - João"
                className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md w-48"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Pays</label>
              <select
                value={holdingForm.pays}
                onChange={(e) => setHoldingForm((f) => ({ ...f, pays: e.target.value }))}
                className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              >
                {marketSettings.map((s) => (
                  <option key={s.pays} value={s.pays}>{s.pays}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Montant détenu</label>
              <input
                type="number"
                value={holdingForm.montant_detenu}
                onChange={(e) => setHoldingForm((f) => ({ ...f, montant_detenu: e.target.value }))}
                className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md w-28"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Dernière remise</label>
              <input
                type="date"
                value={holdingForm.date_derniere_remise}
                onChange={(e) => setHoldingForm((f) => ({ ...f, date_derniere_remise: e.target.value }))}
                className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Statut</label>
              <select
                value={holdingForm.statut_rapatriement}
                onChange={(e) => setHoldingForm((f) => ({ ...f, statut_rapatriement: e.target.value as CashHolding["statut_rapatriement"] }))}
                className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              >
                <option value="en_attente">En attente</option>
                <option value="en_cours">En cours</option>
                <option value="rapatrie">Rapatrié</option>
              </select>
            </div>
            <button
              onClick={handleAddHolding}
              disabled={holdingSaving}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-40"
            >
              {holdingSaving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Ajouter
            </button>
          </div>
        </Section>

        {/* ═══ Cash Out ═══ */}
        <Section title="Cash Out par pays">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-xs mb-3">
            <Info size={14} className="shrink-0 mt-0.5" />
            <p>
              Payout affilié (colonne dédiée) inclus dans le total depuis le CRM Voralis — c&apos;est un montant <strong>accru</strong> sur
              les commandes confirmées/livrées de la période, pas une date de décaissement réelle (le CRM n&apos;expose aucune
              date de paiement affilié).
            </p>
          </div>
          {cashData.affiliatePayoutError && (
            <div className="flex items-center gap-2 p-3 mb-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs">
              <AlertTriangle size={12} />
              CRM Voralis injoignable pour le payout affilié : {cashData.affiliatePayoutError}
            </div>
          )}
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Pays", "Ad spend réel (converti)", "Salaires locaux", "Autre", "Payout affilié (CRM)", "Total"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cashData.cashOutByCountry.map((r) => (
                  <tr key={r.countryName} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-medium text-slate-900">
                        <span className="text-base">{COUNTRY_FLAGS[r.countryName] ?? "🌍"}</span>
                        {r.countryName}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{fmtCurrency(r.adSpendLocal, r.currency)}</td>
                    <td className="px-3 py-3 text-slate-700">{fmtCurrency(r.salaireLocal, r.currency)}</td>
                    <td className="px-3 py-3 text-slate-700">{fmtCurrency(r.autre, r.currency)}</td>
                    <td className="px-3 py-3 text-slate-700">{fmtCurrency(r.payoutAffilieLocal, r.currency)}</td>
                    <td className="px-3 py-3 font-semibold text-red-600">{fmtCurrency(r.total, r.currency)}</td>
                  </tr>
                ))}
                {cashData.cashOutByCountry.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-slate-500">Aucune sortie de cash pour cette période.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-end gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Type</label>
              <select
                value={cashOutForm.type}
                onChange={(e) => setCashOutForm((f) => ({ ...f, type: e.target.value as "salaire_local" | "autre" }))}
                className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              >
                <option value="salaire_local">Salaire local</option>
                <option value="autre">Autre</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Pays</label>
              <select
                value={cashOutForm.pays}
                onChange={(e) => setCashOutForm((f) => ({ ...f, pays: e.target.value }))}
                className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              >
                {marketSettings.map((s) => (
                  <option key={s.pays} value={s.pays}>{s.pays}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Montant</label>
              <input
                type="number"
                value={cashOutForm.montant}
                onChange={(e) => setCashOutForm((f) => ({ ...f, montant: e.target.value }))}
                className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md w-28"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Description</label>
              <input
                value={cashOutForm.description}
                onChange={(e) => setCashOutForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="optionnel"
                className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md w-40"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Date</label>
              <input
                type="date"
                value={cashOutForm.date}
                onChange={(e) => setCashOutForm((f) => ({ ...f, date: e.target.value }))}
                className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              />
            </div>
            <button
              onClick={handleAddCashOut}
              disabled={cashOutSaving}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-40"
            >
              {cashOutSaving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Ajouter
            </button>
          </div>

          {cashData.cashOutManualEntries.length > 0 && (
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    {["Type", "Pays", "Montant", "Description", "Date", ""].map((h) => (
                      <th key={h} className="text-left px-3 py-2 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cashData.cashOutManualEntries.map((e) => (
                    <tr key={e.id} className="border-b border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{e.type === "salaire_local" ? "Salaire local" : "Autre"}</td>
                      <td className="px-3 py-2 text-slate-700">{e.pays}</td>
                      <td className="px-3 py-2 text-slate-700">{fmtCurrency(e.montant, currencyByPays.get(e.pays) ?? "")}</td>
                      <td className="px-3 py-2 text-slate-500">{e.description ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{e.date}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={async () => {
                            await deleteCashOutManual(e.id);
                            await loadAll();
                          }}
                          className="text-slate-400 hover:text-red-600 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {cashData.outOfScopeAdSpend.length > 0 && (
            <p className="text-xs text-amber-600 mt-3">
              Dépense Meta Ads hors périmètre COD (pas de market_settings, non incluse ci-dessus) :{" "}
              {cashData.outOfScopeAdSpend.map((o) => `${o.country} ($${o.spendUsd.toFixed(0)})`).join(", ")}
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
