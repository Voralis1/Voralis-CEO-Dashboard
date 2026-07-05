// Seuils d'alerte proactive PARAMÉTRABLES par le CEO (module Alertes + Chatbot). Rangée unique
// (id fixe "default") plutôt qu'un réglage par pays : ces seuils sont des politiques globales,
// pas des données de marché. Le délai avant 1er contact n'a volontairement PAS de seuil ici —
// aucune source ne fournit cette donnée (cf. STRUCTURAL_BLIND_SPOTS), un seuil dessus serait
// une politique sans donnée réelle à comparer.

export interface CopilotAlertThresholds {
  id: string;
  taux_rupture_stock_max_pct: number;
  dr_pct_drop_max_points: number;
  cash_non_rapatrie_max_usd: number;
  updated_at: string;
}

export type CopilotAlertThresholdsUpdate = Partial<
  Pick<CopilotAlertThresholds, "taux_rupture_stock_max_pct" | "dr_pct_drop_max_points" | "cash_non_rapatrie_max_usd">
>;

export async function fetchCopilotAlertThresholds(): Promise<CopilotAlertThresholds> {
  const res = await fetch("/api/copilot/alert-thresholds");
  if (!res.ok) throw new Error(`Échec du chargement des seuils d'alerte (${res.status})`);
  const json = await res.json();
  return json.thresholds as CopilotAlertThresholds;
}

export async function updateCopilotAlertThresholds(patch: CopilotAlertThresholdsUpdate): Promise<CopilotAlertThresholds> {
  const res = await fetch("/api/copilot/alert-thresholds", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Échec de la mise à jour des seuils d'alerte (${res.status})`);
  const json = await res.json();
  return json.thresholds as CopilotAlertThresholds;
}
