// Frais de livraison : constante globale, un seul endroit dans le code.
// 11 USD par commande, IDENTIQUES pour tous les pays — remplace tout ancien champ
// de frais de livraison variable/moyen. Converti en devise locale via fx_to_usd
// (market_settings), jamais recodé ailleurs.
export const DELIVERY_FEE_USD = 11;

// cogs_produit, taux_retour, conf_pct, dr_pct sont NULLABLE :
// NULL = pas encore saisi par le CEO (→ tout calcul de marge qui en dépend doit s'afficher
// "incomplet", jamais silencieusement traité comme 0). 0 = coût confirmé réellement nul.
// Ne jamais faire `valeur ?? 0` sur ces champs dans un calcul de marge — utiliser les helpers
// de lib/margin.ts qui propagent explicitement l'incomplétude.
//
// cout_call_center_par_commande n'est plus lu par le moteur de marge (2026-07-06) : confirmé
// par le CEO comme déjà inclus dans les 11 USD/commande de frais de livraison fixe. La colonne
// DB existe toujours (non supprimée) mais ce champ n'est plus dans l'interface TypeScript —
// aucun code applicatif ne doit le lire ni l'écrire.
// external_11usd = forfait fixe DELIVERY_FEE_USD (tout inclus, call center compris) — 6 marchés
// à prestataire logistique externe. internal_real_cost = frais réels de la mini-app "Field Cash
// Angola" (commissions agent/manager + carburant), remplace le forfait pour l'Angola uniquement
// (2026-07-08). Verrouillé par migration SQL, jamais éditable depuis /ceo/market-settings — au
// même titre que pays/devise_locale, pour ne jamais désynchroniser un pays de son vrai modèle
// de coût. Voir lib/fieldCash.ts (resolveFraisLivraison) pour le branchement.
export type DeliveryModel = "external_11usd" | "internal_real_cost";

export interface MarketSettings {
  id: string;
  pays: string;
  devise_locale: string;
  fx_to_usd: number;
  fx_updated_at: string;
  fx_updated_by: string | null;
  delivery_model: DeliveryModel;
  cogs_produit: number | null;
  cogs_devise: "USD" | "local";
  taux_retour: number | null;
  conf_pct: number | null;
  dr_pct: number | null;
  // Frais de retour par réseau, en devise locale — dépendance différée assumée : traité comme
  // 0 tant que non renseigné (contrairement aux champs ci-dessus qui doivent rester "incomplets").
  frais_retour_local: number | null;
  marge_plancher_t: number;
  // Surcharge CEO pour SIMULER un AOV différent dans le module Seuils ("et si l'AOV était de
  // X ?"). NULL (cas normal) = on utilise l'AOV réellement observé (CA livré encaissé ÷
  // livrées, même base que /profitability) — jamais une saisie manuelle par défaut, pour ne
  // pas créer deux sources divergentes pour la même donnée.
  aov_override: number | null;
  created_at: string;
  updated_at: string;
}

// Sous-ensemble non confidentiel — exposé à tout utilisateur authentifié (Trésorerie,
// Logistics COD, ProviderKpiTable n'ont besoin que du FX/devise, jamais de COGS/marge plancher T).
export interface PublicMarketSettings {
  pays: string;
  devise_locale: string;
  fx_to_usd: number;
  delivery_model: DeliveryModel;
}

// Champs éditables par le CEO via /ceo/market-settings — devise_locale et pays sont
// verrouillés (mapping validé, non éditable) pour ne jamais reproduire un bug de
// devise incorrecte assignée à un pays. Les champs nullable acceptent explicitement `null`
// (vider un input = repasser en "non renseigné", pas en 0).
export type MarketSettingsUpdate = Partial<
  Pick<
    MarketSettings,
    | "fx_to_usd"
    | "cogs_produit"
    | "cogs_devise"
    | "taux_retour"
    | "conf_pct"
    | "dr_pct"
    | "frais_retour_local"
    | "marge_plancher_t"
    | "aov_override"
  >
>;

// Formule unique des frais de livraison locaux — tous les modules (Prompt 1, /profitability,
// /ceo) DOIVENT appeler cette même fonction avec le fx_to_usd du pays concerné, jamais recoder
// le calcul ni en écrire une seconde implémentation.
export function deliveryFeeLocal(fxToUsd: number): number {
  return DELIVERY_FEE_USD * fxToUsd;
}

// Sucre pratique pour un lookup ponctuel par pays (une seule commande, un seul écran).
// Pour calculer sur une liste de commandes/lignes déjà chargée, préférer fetchMarketSettings()
// une fois puis deliveryFeeLocal(row.fx_to_usd) par ligne, pour éviter le N+1.
export async function getDeliveryFeeLocalForCountry(pays: string): Promise<number> {
  const settings = await fetchMarketSettingsByCountry(pays);
  if (!settings) throw new Error(`Aucun market_settings trouvé pour le pays "${pays}"`);
  return deliveryFeeLocal(settings.fx_to_usd);
}

export async function fetchMarketSettings(): Promise<MarketSettings[]> {
  const res = await fetch("/api/market-settings");
  if (!res.ok) throw new Error(`Échec du chargement de market_settings (${res.status})`);
  const json = await res.json();
  return json.settings as MarketSettings[];
}

// Champs non confidentiels uniquement (pays/devise/FX) — accessible à tout rôle authentifié.
// À utiliser partout où seul l'affichage devise/FX est nécessaire (Trésorerie, Logistics COD,
// ProviderKpiTable), pour ne jamais exposer COGS/T à un rôle non-CEO.
export async function fetchPublicMarketSettings(): Promise<PublicMarketSettings[]> {
  const res = await fetch("/api/market-settings?scope=public");
  if (!res.ok) throw new Error(`Échec du chargement de market_settings (${res.status})`);
  const json = await res.json();
  return json.settings as PublicMarketSettings[];
}

export async function fetchMarketSettingsByCountry(pays: string): Promise<MarketSettings | null> {
  const all = await fetchMarketSettings();
  return all.find((s) => s.pays === pays) ?? null;
}

export async function updateMarketSettings(pays: string, patch: MarketSettingsUpdate): Promise<MarketSettings> {
  const res = await fetch(`/api/market-settings/${encodeURIComponent(pays)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Échec de la mise à jour de market_settings (${res.status})`);
  const json = await res.json();
  return json.setting as MarketSettings;
}
