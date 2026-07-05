// Suivi manuel de trésorerie — "Cash chez qui" (cash_holdings) et "Cash Out" hors payouts
// affiliés (cash_out_manual). Aucune API externe ne fournit ces données : saisie CEO uniquement,
// depuis l'écran Trésorerie (/ceo). Les payouts affiliés sont volontairement absents de
// cash_out_manual — ils viendront de l'API CRM Voralis (évolution prévue séparément).

export interface CashHolding {
  id: string;
  entite: string;
  pays: string;
  montant_detenu: number;
  date_derniere_remise: string | null;
  statut_rapatriement: "en_attente" | "en_cours" | "rapatrie";
  created_at: string;
  updated_at: string;
}

export type CashHoldingInput = Pick<
  CashHolding,
  "entite" | "pays" | "montant_detenu" | "date_derniere_remise" | "statut_rapatriement"
>;

export interface CashOutManual {
  id: string;
  type: "salaire_local" | "autre";
  pays: string;
  montant: number;
  description: string | null;
  date: string;
  created_at: string;
  updated_at: string;
}

export type CashOutManualInput = Pick<CashOutManual, "type" | "pays" | "montant" | "description" | "date">;

export async function fetchCashHoldings(): Promise<CashHolding[]> {
  const res = await fetch("/api/cash-holdings");
  if (!res.ok) throw new Error(`Échec du chargement de cash_holdings (${res.status})`);
  const json = await res.json();
  return json.holdings as CashHolding[];
}

export async function createCashHolding(input: CashHoldingInput): Promise<CashHolding> {
  const res = await fetch("/api/cash-holdings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Échec de la création (${res.status})`);
  const json = await res.json();
  return json.holding as CashHolding;
}

export async function deleteCashHolding(id: string): Promise<void> {
  const res = await fetch(`/api/cash-holdings/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Échec de la suppression (${res.status})`);
}

export async function fetchCashOutManual(): Promise<CashOutManual[]> {
  const res = await fetch("/api/cash-out-manual");
  if (!res.ok) throw new Error(`Échec du chargement de cash_out_manual (${res.status})`);
  const json = await res.json();
  return json.entries as CashOutManual[];
}

export async function createCashOutManual(input: CashOutManualInput): Promise<CashOutManual> {
  const res = await fetch("/api/cash-out-manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Échec de la création (${res.status})`);
  const json = await res.json();
  return json.entry as CashOutManual;
}

export async function deleteCashOutManual(id: string): Promise<void> {
  const res = await fetch(`/api/cash-out-manual/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Échec de la suppression (${res.status})`);
}
