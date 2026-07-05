import type { MetaAdsRow, NetworkKpiRow, ShipsenCountryKpi } from "@/app/api/network-overview/route";

export interface NetworkOverview {
  metaAds: MetaAdsRow[];
  networks: { network: string; rows: NetworkKpiRow[] }[];
  shipsen: {
    byCountry: ShipsenCountryKpi[];
    global: { total_confirmed_orders: number; total_orders_all: number; global_confirmation_rate: number | null } | null;
  };
  errors: Record<string, string>;
}

export async function fetchNetworkOverview(dateFrom: string, dateTo: string): Promise<NetworkOverview> {
  const res = await fetch(`/api/network-overview?dateFrom=${dateFrom}&dateTo=${dateTo}`);
  if (!res.ok) throw new Error(`Échec du chargement des données réseau (${res.status})`);
  return res.json();
}

// Chaque réseau facture dans sa propre devise locale — ne jamais additionner des montants
// de devises différentes entre eux (voir les commentaires dans les schémas SQL par réseau).
export function fmtCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${Math.round(value).toLocaleString("fr-FR")} ${currency}`;
  }
}

export type AlertLevel = "critical" | "warning" | "info";

export interface Alert {
  id: string;
  level: AlertLevel;
  title: string;
  desc: string;
  action: string;
  market?: string;
  timestamp: string;
}

// Seuils d'alerte — politique configurable, pas des données inventées : ils s'appliquent
// aux vraies métriques remontées par /api/network-overview.
const THRESHOLDS = {
  confirmationCritical: 30,
  confirmationWarning: 45,
  deliveryCritical: 40,
  deliveryWarning: 55,
  metaZeroLeadSpend: 20,
  metaCplWarning: 3,
};

export function computeAlerts(overview: NetworkOverview): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  for (const row of overview.metaAds) {
    if ((row.leads ?? 0) === 0 && (row.spend ?? 0) > THRESHOLDS.metaZeroLeadSpend) {
      alerts.push({
        id: `meta-zero-leads-${row.country}`,
        level: "critical",
        title: `${row.country} · dépense Meta Ads sans leads`,
        desc: `$${row.spend.toFixed(0)} dépensés sans générer un seul lead — la créa ou le ciblage ne convertit pas.`,
        action: "Suspendre la campagne",
        market: row.country,
        timestamp: now,
      });
    } else if ((row.cpl ?? 0) > THRESHOLDS.metaCplWarning) {
      alerts.push({
        id: `meta-cpl-${row.country}`,
        level: "warning",
        title: `${row.country} · CPL élevé`,
        desc: `CPL à $${row.cpl.toFixed(2)}, au-dessus du seuil de $${THRESHOLDS.metaCplWarning}.`,
        action: "Auditer le ciblage / la créa",
        market: row.country,
        timestamp: now,
      });
    }
  }

  function checkNetworkRow(network: string, row: NetworkKpiRow) {
    if (row.taux_confirmation != null) {
      if (row.taux_confirmation < THRESHOLDS.confirmationCritical) {
        alerts.push({
          id: `confirmation-${network}-${row.country_name}`,
          level: "critical",
          title: `${network} · ${row.country_name} · confirmation critique`,
          desc: `Taux de confirmation à ${row.taux_confirmation}% (< ${THRESHOLDS.confirmationCritical}%).`,
          action: "Auditer le script de confirmation",
          market: row.country_name,
          timestamp: now,
        });
      } else if (row.taux_confirmation < THRESHOLDS.confirmationWarning) {
        alerts.push({
          id: `confirmation-${network}-${row.country_name}`,
          level: "warning",
          title: `${network} · ${row.country_name} · confirmation faible`,
          desc: `Taux de confirmation à ${row.taux_confirmation}% (< ${THRESHOLDS.confirmationWarning}%).`,
          action: "Surveiller la qualité des leads",
          market: row.country_name,
          timestamp: now,
        });
      }
    }

    if (row.taux_livraison != null) {
      if (row.taux_livraison < THRESHOLDS.deliveryCritical) {
        alerts.push({
          id: `livraison-${network}-${row.country_name}`,
          level: "critical",
          title: `${network} · ${row.country_name} · livraison critique`,
          desc: `Taux de livraison à ${row.taux_livraison}% (< ${THRESHOLDS.deliveryCritical}%).`,
          action: "Auditer la logistique",
          market: row.country_name,
          timestamp: now,
        });
      } else if (row.taux_livraison < THRESHOLDS.deliveryWarning) {
        alerts.push({
          id: `livraison-${network}-${row.country_name}`,
          level: "warning",
          title: `${network} · ${row.country_name} · livraison faible`,
          desc: `Taux de livraison à ${row.taux_livraison}% (< ${THRESHOLDS.deliveryWarning}%).`,
          action: "Surveiller le partenaire logistique",
          market: row.country_name,
          timestamp: now,
        });
      }
    }
  }

  for (const net of overview.networks) {
    for (const row of net.rows) checkNetworkRow(net.network, row);
  }

  for (const row of overview.shipsen.byCountry) {
    if (row.confirmation_rate != null) {
      if (row.confirmation_rate < THRESHOLDS.confirmationCritical) {
        alerts.push({
          id: `confirmation-Shipsen-${row.country}`,
          level: "critical",
          title: `Shipsen · ${row.country} · confirmation critique`,
          desc: `Taux de confirmation à ${row.confirmation_rate}% (< ${THRESHOLDS.confirmationCritical}%).`,
          action: "Auditer le script de confirmation",
          market: row.country,
          timestamp: now,
        });
      } else if (row.confirmation_rate < THRESHOLDS.confirmationWarning) {
        alerts.push({
          id: `confirmation-Shipsen-${row.country}`,
          level: "warning",
          title: `Shipsen · ${row.country} · confirmation faible`,
          desc: `Taux de confirmation à ${row.confirmation_rate}% (< ${THRESHOLDS.confirmationWarning}%).`,
          action: "Surveiller la qualité des leads",
          market: row.country,
          timestamp: now,
        });
      }
    }
  }

  for (const [source, message] of Object.entries(overview.errors)) {
    alerts.push({
      id: `sync-error-${source}`,
      level: "info",
      title: "Erreur de synchronisation",
      desc: message,
      action: "Vérifier la source de données",
      timestamp: now,
    });
  }

  const order: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.level] - order[b.level]);
}
