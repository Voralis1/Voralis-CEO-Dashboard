// Stock & Inventaire — quantité physique saisie manuellement (aucune API réseau ne la fournit),
// seuil de réapprovisionnement CALCULÉ (jamais stocké) à partir des livrées réelles + des
// paramètres delai_appro_jours/stock_securite (NULL = non configuré, jamais confondu avec 0).

export interface InventoryRow {
  id: string;
  pays: string;
  produit: string;
  quantite_stock: number;
  delai_appro_jours: number | null;
  stock_securite: number | null;
  ventes_moyennes_jour_override: number | null;
  created_at: string;
  updated_at: string;
}

export type InventoryCreateInput = Pick<InventoryRow, "pays" | "produit" | "quantite_stock" | "delai_appro_jours" | "stock_securite" | "ventes_moyennes_jour_override">;

// pays/produit verrouillés après création (clé unique) — on ne les édite pas via PATCH pour
// éviter une collision silencieuse avec une autre ligne.
export type InventoryUpdate = Partial<Pick<InventoryRow, "quantite_stock" | "delai_appro_jours" | "stock_securite" | "ventes_moyennes_jour_override">>;

export type InventoryStatus = "ok" | "a_commander" | "rupture" | "non_configure";

export interface InventoryThreshold {
  ventesMoyennesJour: number;
  ventesSource: "observed" | "override";
  seuilAlerte: number | null;
  statut: InventoryStatus;
}

// seuil_alerte = (ventes_moyennes_jour × délai_appro_jours) + stock_sécurité — calculé à la
// volée, jamais stocké (évite deux sources qui divergent). Si delai_appro_jours ou
// stock_securite est NULL, le statut est "non_configure", jamais "ok" par défaut.
export function computeInventoryThreshold(
  quantiteStock: number,
  delaiApproJours: number | null,
  stockSecurite: number | null,
  ventesObservees: number,
  ventesOverride: number | null
): InventoryThreshold {
  const ventesMoyennesJour = ventesOverride ?? ventesObservees;
  const ventesSource: "observed" | "override" = ventesOverride != null ? "override" : "observed";

  if (delaiApproJours == null || stockSecurite == null) {
    return { ventesMoyennesJour, ventesSource, seuilAlerte: null, statut: "non_configure" };
  }

  const seuilAlerte = ventesMoyennesJour * delaiApproJours + stockSecurite;

  let statut: InventoryStatus;
  if (quantiteStock === 0) statut = "rupture";
  else if (quantiteStock <= seuilAlerte) statut = "a_commander";
  else statut = "ok";

  return { ventesMoyennesJour, ventesSource, seuilAlerte, statut };
}

// Nombre de jours (inclusif) de la fenêtre du filtre date global — utilisé pour ramener les
// livrées de la période à une moyenne quotidienne.
export function daysBetweenInclusive(dateFrom: string, dateTo: string): number {
  const diffMs = new Date(dateTo).getTime() - new Date(dateFrom).getTime();
  const days = Math.round(diffMs / (24 * 60 * 60 * 1000)) + 1;
  return Math.max(days, 1);
}

export async function fetchInventory(): Promise<InventoryRow[]> {
  const res = await fetch("/api/inventory");
  if (!res.ok) throw new Error(`Échec du chargement de l'inventaire (${res.status})`);
  const json = await res.json();
  return json.inventory as InventoryRow[];
}

export async function createInventoryRow(input: InventoryCreateInput): Promise<InventoryRow> {
  const res = await fetch("/api/inventory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Échec de la création (${res.status})`);
  const json = await res.json();
  return json.row as InventoryRow;
}

export async function updateInventoryRow(id: string, patch: InventoryUpdate): Promise<InventoryRow> {
  const res = await fetch(`/api/inventory/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Échec de la mise à jour (${res.status})`);
  const json = await res.json();
  return json.row as InventoryRow;
}

export async function deleteInventoryRow(id: string): Promise<void> {
  const res = await fetch(`/api/inventory/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Échec de la suppression (${res.status})`);
}
