"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Topbar from "@/components/layout/Topbar";
import ProviderKpiTable from "@/components/kpi/ProviderKpiTable";
import FieldCashAngolaSection from "@/components/fieldcash/FieldCashAngolaSection";
import { COUNTRY_FLAGS } from "@/lib/countries";
import { fetchPublicMarketSettings } from "@/lib/marketSettings";
import { PROVIDERS, type ProviderId } from "@/lib/providerKpi";

type NetworkTab = ProviderId | "field-cash-angola";

// Un onglet par réseau (2026-07-31, demande CEO) — auparavant tous les réseaux pouvaient
// s'afficher empilés en même temps ("Tous les réseaux"), ce qui a directement causé une
// confusion réelle : plusieurs tableaux avec des logiques de date différentes (le sélecteur De/À
// du dashboard CEO pour ProviderKpiTable, vs une période fixe "This Month" pour
// ShipsenAnalyticsSnapshotSection) juxtaposés à l'écran, facilement pris l'un pour l'autre. Un
// seul réseau affiché à la fois élimine ce risque de concordance de filtres par construction —
// plus d'option "Tous les réseaux".
const TAB_OPTIONS: { value: NetworkTab; label: string }[] = [
  ...(Object.values(PROVIDERS).map((p) => ({ value: p.id, label: p.label })) as { value: ProviderId; label: string }[]),
  { value: "field-cash-angola", label: "Field Cash Angola" },
];

function isProviderId(value: string): value is ProviderId {
  return value in PROVIDERS;
}

function isNetworkTab(value: string): value is NetworkTab {
  return value === "field-cash-angola" || isProviderId(value);
}

function LogisticsCodContent() {
  const searchParams = useSearchParams();
  const initialReseau = searchParams.get("reseau");

  const [countryOptions, setCountryOptions] = useState<string[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string | "all">("all");
  const [activeTab, setActiveTab] = useState<NetworkTab>(
    initialReseau && isNetworkTab(initialReseau) ? initialReseau : TAB_OPTIONS[0].value
  );

  useEffect(() => {
    let cancelled = false;
    // Liste des pays via market_settings — source unique de vérité (Prompt 1), jamais une
    // liste codée en dur par réseau.
    fetchPublicMarketSettings()
      .then((settings) => {
        if (!cancelled) setCountryOptions(settings.map((s) => s.pays));
      })
      .catch(() => {
        // Filtre pays optionnel — un échec de chargement n'empêche pas d'afficher les tableaux
        // (juste l'option "par pays" reste vide, "Tous les pays" fonctionne toujours).
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const countryFilter = selectedCountry === "all" ? undefined : selectedCountry;

  // Field Cash Angola est un delivery_model interne distinct des 4 réseaux externes (pas de
  // ProviderKpiRow, pas de sync n8n) — pertinent uniquement si le filtre Pays n'exclut pas
  // l'Angola.
  const fieldCashAngolaHidden = activeTab === "field-cash-angola" && selectedCountry !== "all" && selectedCountry !== "Angola";

  return (
    <div>
      <Topbar
        title="Réseaux Logistiques / COD"
        subtitle="ClickMarket, Coliscod Angola, Africod Congo, Shipsen, ShipLead, MLShipAfrica — un onglet par réseau"
      />

      <div className="px-6 py-5 space-y-5">
        {/* Filtre Pays (transversal à tous les onglets) */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
            <label className="text-xs text-slate-500 pl-1">Pays</label>
            <select
              value={selectedCountry}
              onChange={(e) => setSelectedCountry(e.target.value)}
              className="px-2 py-1.5 text-xs bg-white text-slate-900 border border-slate-300 rounded-md focus:outline-none focus:border-emerald-500 transition-colors"
            >
              <option value="all">Tous les pays</option>
              {countryOptions.map((pays) => (
                <option key={pays} value={pays}>
                  {COUNTRY_FLAGS[pays] ?? "🌍"} {pays}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Mini onglets — un réseau à la fois */}
        <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-0">
          {TAB_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setActiveTab(opt.value)}
              className={
                "px-3.5 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors " +
                (activeTab === opt.value
                  ? "border-emerald-500 text-emerald-700 bg-emerald-50"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Contenu du réseau actif uniquement */}
        <div className="space-y-5">
          {activeTab === "field-cash-angola" ? (
            fieldCashAngolaHidden ? (
              <p className="text-sm text-slate-500">Field Cash Angola ne concerne que l&apos;Angola — change le filtre Pays pour l&apos;afficher.</p>
            ) : (
              <FieldCashAngolaSection />
            )
          ) : (
            <ProviderKpiTable provider={activeTab} countryFilter={countryFilter} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function LogisticsCodPage() {
  return (
    <Suspense fallback={null}>
      <LogisticsCodContent />
    </Suspense>
  );
}
