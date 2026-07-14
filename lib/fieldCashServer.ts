import { supabaseAdmin } from "@/lib/supabase/server";
import type { FieldCashRecap, FieldCashAgentRow } from "@/lib/fieldCash";

// SERVEUR UNIQUEMENT (importe supabaseAdmin, service_role) — jamais importé depuis un composant
// "use client". Utilisé par app/api/field-cash*/route.ts et par les agrégateurs 100% serveur
// (lib/thresholds.ts, lib/copilot/snapshot.ts), qui n'ont pas de session utilisateur pour passer
// par le RLS "authenticated" (même raison que lib/profitability.ts vs lib/thresholds.ts).
//
// Tables de la mini-app "Field Cash Angola" (schéma fourni par le CEO, 2026-07-08) :
//   field_delivery_params(country, currency)
//   field_deliveries(country, delivery_date, agent, amount_collected, delivery_fee)
//   field_charges(country, charge_date, description, category, amount)
//   field_remittances(country, remit_date, amount, method, status)
//
// fraisLivraisonInterneTotal = somme de field_deliveries.delivery_fee sur la période (2026-07-13,
// remplace entièrement l'ancien calcul commission_agent/commission_manager/fuel_per_agent ×
// nb livraisons/agents-jours — décision CEO : delivery_fee est directement la valeur réelle
// saisie par livraison, plus fiable qu'une reconstitution par taux). field_agent_days n'est donc
// plus lu ici (n'était utilisé que pour l'ancien calcul de carburant).
//
// Ce module ne dépend d'aucune table gérée par ce repo — country/field_delivery_params.currency
// peuvent être absents pour un pays sans configuration Field Cash, auquel cas la devise reste NULL
// (jamais un 0 implicite qui fausserait la marge).

export async function fetchFieldCashRecap(country: string, dateFrom: string, dateTo: string): Promise<FieldCashRecap> {
  const [deliveriesRes, chargesRes, remittancesRes, paramsRes] = await Promise.all([
    supabaseAdmin
      .from("field_deliveries")
      .select("amount_collected, delivery_fee")
      .eq("country", country)
      .gte("delivery_date", dateFrom)
      .lte("delivery_date", dateTo),
    supabaseAdmin
      .from("field_charges")
      .select("amount")
      .eq("country", country)
      .gte("charge_date", dateFrom)
      .lte("charge_date", dateTo),
    supabaseAdmin
      .from("field_remittances")
      .select("amount, status")
      .eq("country", country)
      .gte("remit_date", dateFrom)
      .lte("remit_date", dateTo),
    supabaseAdmin
      .from("field_delivery_params")
      .select("currency")
      .eq("country", country)
      .maybeSingle(),
  ]);

  const deliveries = (deliveriesRes.data ?? []) as { amount_collected: number; delivery_fee: number | null }[];
  const nbDeliveries = deliveries.length;
  const totalEncaisse = deliveries.reduce((s, d) => s + (d.amount_collected ?? 0), 0);
  const fraisLivraisonInterneTotal = deliveries.reduce((s, d) => s + (d.delivery_fee ?? 0), 0);

  const chargesExternesTotal = ((chargesRes.data ?? []) as { amount: number }[]).reduce((s, c) => s + (c.amount ?? 0), 0);

  const remittances = (remittancesRes.data ?? []) as { amount: number; status: string }[];
  // 'received' = équivalent de l'ancien statut 'rapatrie' de cash_holdings — seul un rapatriement
  // CONFIRMÉ réduit le cash détenu restant. 'pending'/'sent' restent "en transit", affichés à
  // part, jamais silencieusement soustraits (le cash pourrait encore être perdu/en attente).
  const remisTotal = remittances.filter((r) => r.status === "received").reduce((s, r) => s + (r.amount ?? 0), 0);
  const remisEnTransit = remittances
    .filter((r) => r.status === "pending" || r.status === "sent")
    .reduce((s, r) => s + (r.amount ?? 0), 0);

  const params = paramsRes.data as { currency: string } | null;

  const cashDetenuRestant = totalEncaisse - fraisLivraisonInterneTotal - chargesExternesTotal - remisTotal;

  return {
    country,
    currency: params?.currency ?? null,
    nbDeliveries,
    totalEncaisse,
    fraisLivraisonInterneTotal,
    chargesExternesTotal,
    remisTotal,
    remisEnTransit,
    cashDetenuRestant,
    missingParams: params == null,
  };
}

export async function fetchFieldCashByAgent(country: string, dateFrom: string, dateTo: string): Promise<FieldCashAgentRow[]> {
  const { data } = await supabaseAdmin
    .from("field_deliveries")
    .select("agent, amount_collected")
    .eq("country", country)
    .gte("delivery_date", dateFrom)
    .lte("delivery_date", dateTo);

  const byAgent = new Map<string, { nbDeliveries: number; totalEncaisse: number }>();
  for (const row of (data ?? []) as { agent: string | null; amount_collected: number }[]) {
    const key = row.agent?.trim() || "(non renseigné)";
    const entry = byAgent.get(key) ?? { nbDeliveries: 0, totalEncaisse: 0 };
    entry.nbDeliveries += 1;
    entry.totalEncaisse += row.amount_collected ?? 0;
    byAgent.set(key, entry);
  }

  return [...byAgent].map(([agent, v]) => ({ agent, ...v })).sort((a, b) => b.nbDeliveries - a.nbDeliveries);
}