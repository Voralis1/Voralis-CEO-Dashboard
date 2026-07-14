// Frais de livraison : constante globale, un seul endroit dans le code.
// 11 USD par commande, IDENTIQUES pour tous les pays — remplace tout ancien champ
// de frais de livraison variable/moyen. Converti en devise locale via fx_to_usd
// (market_settings), jamais recodé ailleurs.
export const DELIVERY_FEE_USD = 11;

// conf_pct/dr_pct sont NULLABLE : NULL = pas encore saisi par le CEO ET aucune donnée observée
// disponible (→ tout calcul de marge qui en dépend doit s'afficher "incomplet", jamais
// silencieusement traité comme 0). Depuis 2026-07-14, ces deux champs ne servent plus que de
// repli : lib/thresholds.ts calcule d'abord le taux de confirmation/livraison RÉEL observé sur
// les réseaux logistiques de la période, et ne retombe sur ces valeurs saisies que si aucune
// commande n'a été enregistrée sur la période (marché tout juste lancé, par ex.).
//
// cogs_produit/cogs_devise/taux_retour/frais_retour_local (2026-07-14, demande CEO) : colonnes
// SUPPRIMÉES de market_settings (voir market_settings_drop_manual_costs_migration.sql). Le COGS
// vient désormais de lib/margin.ts (quantité expédiée × 15$/unité, même formule que "Cash Out"
// en Trésorerie) ; les retours ont été retirés de la formule de marge.
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
  conf_pct: number | null;
  dr_pct: number | null;
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
    | "conf_pct"
    | "dr_pct"
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
