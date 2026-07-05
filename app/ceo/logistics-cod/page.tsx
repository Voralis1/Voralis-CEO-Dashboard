"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Topbar from "@/components/layout/Topbar";
import ProviderKpiTable from "@/components/kpi/ProviderKpiTable";
import { COUNTRY_FLAGS } from "@/lib/countries";
import { fetchPublicMarketSettings } from "@/lib/marketSettings";
import { PROVIDERS, type ProviderId } from "@/lib/providerKpi";

const NETWORK_OPTIONS: { value: ProviderId | "all"; label: string }[] = [
  { value: "all", label: "Tous les réseaux" },
  ...(Object.values(PROVIDERS).map((p) => ({ value: p.id, label: p.label })) as { value: ProviderId; label: string }[]),
];

function isProviderId(value: string): value is ProviderId {
  return value in PROVIDERS;
}

function LogisticsCodContent() {
  const searchParams = useSearchParams();
  const initialReseau = searchParams.get("reseau");

  const [countryOptions, setCountryOptions] = useState<string[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string | "all">("all");
  const [selectedNetwork, setSelectedNetwork] = useState<ProviderId | "all">(
    initialReseau && isProviderId(initialReseau) ? initialReseau : "all"
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

  const networksToShow: ProviderId[] = selectedNetwork === "all" ? (Object.keys(PROVIDERS) as ProviderId[]) : [selectedNetwork];
  const countryFilter = selectedCountry === "all" ? undefined : selectedCountry;

  return (
    <div>
      <Topbar
        title="Réseaux Logistiques / COD"
        subtitle="ClickMarket, Coliscod Angola, Africod Congo, Shipsen — un tableau standard par réseau"
      />

      <div className="px-6 py-5 space-y-5">
        {/* Filtres Pays / Réseau */}
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

          <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
            <label className="text-xs text-slate-500 pl-1">Réseau</label>
            <select
              value={selectedNetwork}
              onChange={(e) => setSelectedNetwork(e.target.value as ProviderId | "all")}
              className="px-2 py-1.5 text-xs bg-white text-slate-900 border border-slate-300 rounded-md focus:outline-none focus:border-emerald-500 transition-colors"
            >
              {NETWORK_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Un tableau standard par réseau (composant du Prompt 2, réutilisé tel quel) */}
        <div className="space-y-8">
          {networksToShow.map((id) => (
            <ProviderKpiTable key={id} provider={id} countryFilter={countryFilter} />
          ))}
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
