// Source unique de vérité pour le mapping pays -> devise -> drapeau.
// Les 7 marchés COD pilotés par ce dashboard, mapping devise validé avec le CEO
// (voir supabase/market_settings_schema.sql, où ce mapping est aussi verrouillé en DB).
// Toute nouvelle occurrence d'orthographe pays doit être ajoutée en alias ici,
// jamais recodée dans une page ou un module.

export interface CanonicalCountry {
  name: string;
  currency: string;
  flag: string;
  aliases: string[];
}

// Alias ISO (alpha-2 ET alpha-3) inclus : le CRM Voralis (/api/v1/reports/networks, bloc
// by_country) renvoie des codes pays dont la normalisation n'est pas uniforme — vérifié en
// direct : "AGO" (alpha-3) pour l'Angola, mais "CI"/"MA"/"GN"/"SN" (alpha-2) pour les autres.
// On accepte donc les deux formats plutôt que de supposer une convention unique.
export const CANONICAL_COUNTRIES: CanonicalCountry[] = [
  { name: "Angola", currency: "AOA", flag: "🇦🇴", aliases: ["Angola", "AO", "AGO"] },
  { name: "Gabon", currency: "XAF", flag: "🇬🇦", aliases: ["Gabon", "GA", "GAB"] },
  { name: "Congo", currency: "XAF", flag: "🇨🇬", aliases: ["Congo", "Congo-Brazza", "Congo-Brazzaville", "CG", "COG"] },
  { name: "Mali", currency: "XOF", flag: "🇲🇱", aliases: ["Mali", "ML", "MLI"] },
  { name: "Guinée", currency: "GNF", flag: "🇬🇳", aliases: ["Guinée", "Guinea", "GN", "GIN"] },
  { name: "Sénégal", currency: "XOF", flag: "🇸🇳", aliases: ["Sénégal", "Senegal", "SN", "SEN"] },
  { name: "Côte d'Ivoire", currency: "XOF", flag: "🇨🇮", aliases: ["Côte d'Ivoire", "Cote d'Ivoire", "CI", "CIV"] },
];

// Pays visibles uniquement côté Meta Ads (hors périmètre COD / market_settings) —
// drapeau d'affichage seulement, jamais de devise/FX associée.
const DISPLAY_ONLY_FLAGS: Record<string, string> = {
  Maroc: "🇲🇦",
};

const aliasToCanonical = new Map<string, CanonicalCountry>();
for (const country of CANONICAL_COUNTRIES) {
  for (const alias of country.aliases) aliasToCanonical.set(alias, country);
}

export function getCanonicalCountry(nameOrAlias: string): CanonicalCountry | undefined {
  return aliasToCanonical.get(nameOrAlias);
}

// Ne jamais retourner une devise par défaut arbitraire (ex. "USD") pour un pays inconnu —
// c'est exactement le type de bug qu'on corrige (ClickMarket/Gabon affiché en AOA par défaut).
// Une chaîne vide fait échouer proprement Intl.NumberFormat dans fmtCurrency, qui retombe
// sur un affichage "valeur + devise" brut plutôt que d'afficher un montant dans une devise fausse.
export function getCountryCurrency(nameOrAlias: string): string {
  return aliasToCanonical.get(nameOrAlias)?.currency ?? "";
}

export const COUNTRY_FLAGS: Record<string, string> = {
  ...DISPLAY_ONLY_FLAGS,
  ...Object.fromEntries(CANONICAL_COUNTRIES.flatMap((c) => c.aliases.map((alias) => [alias, c.flag]))),
};
