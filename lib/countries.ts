// Source unique de vérité pour le mapping pays -> devise -> drapeau.
// Les marchés pilotés par ce dashboard (7 marchés COD à réseau logistique + Burkina Faso +
// Maroc, ce dernier sans réseau logistique — voir commentaire plus bas), mapping devise validé
// avec le CEO (voir supabase/market_settings_schema.sql + market_settings_add_bf_maroc_migration.sql,
// où ce mapping est aussi verrouillé en DB). Toute nouvelle occurrence d'orthographe pays doit
// être ajoutée en alias ici, jamais recodée dans une page ou un module.

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
  { name: "Côte d'Ivoire", currency: "XOF", flag: "🇨🇮", aliases: ["Côte d'Ivoire", "Cote d'Ivoire", "CoteIvoire", "CI", "CIV"] },
  // Ajoutés 2026-07 : Burkina Faso rejoint le périmètre COD (déjà présent côté Meta Ads sous
  // l'alias "BF") — voir supabase/market_settings_add_bf_maroc_migration.sql pour le FX/coûts.
  // Maroc reste sans réseau logistique (source d'expéditions produit + marché Meta Ads
  // prospection uniquement), mais a désormais sa vraie devise pour la Trésorerie plutôt que
  // d'être affiché en USD par défaut (cf. lib/treasury.ts, branche hors-périmètre).
  { name: "Burkina Faso", currency: "XOF", flag: "🇧🇫", aliases: ["Burkina Faso", "Burkina", "BF", "BFA"] },
  { name: "Maroc", currency: "MAD", flag: "🇲🇦", aliases: ["Maroc", "Morocco", "MA", "MAR"] },
];

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

export const COUNTRY_FLAGS: Record<string, string> = Object.fromEntries(
  CANONICAL_COUNTRIES.flatMap((c) => c.aliases.map((alias) => [alias, c.flag]))
);

// Drapeau générique pour un pays HORS périmètre COD (pas de CanonicalCountry, donc pas de
// devise/FX associée — cf. lib/affiliates.ts) : un code ISO alpha-2 (ex. "IN") se convertit
// directement en emoji drapeau via les symboles indicateurs régionaux Unicode (U+1F1E6 = 'A'),
// sans avoir besoin d'une table de mapping. Les codes alpha-3 non reconnus (aucune table
// alpha-3 -> alpha-2 fiable ici) retombent sur null, affiché en 🌍 par l'appelant.
export function flagFromIsoAlpha2(code: string): string | null {
  if (!/^[A-Za-z]{2}$/.test(code)) return null;
  const codePoints = code.toUpperCase().split("").map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}
