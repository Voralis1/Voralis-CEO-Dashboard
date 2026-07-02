export type Decision = "scale" | "hold" | "stop";
export type AlertLevel = "critical" | "warning" | "info";
export type ConnStatus = "ok" | "warning" | "error";

export interface Market {
  code: string;
  flag: string;
  name: string;
  entity: "FGMED" | "Naturala";
  currency: string;
  rev: number;
  adSpend: number;
  cogs: number;
  callCenter: number;
  logistics: number;
  returns: number;
  salaries: number;
  decision: Decision;
  ppdo: number;
  cpl: number;
  delivRate: number;
  rto: number;
  leads: number;
  confirmed: number;
  delivered: number;
  collected: number;
  breakEven: number;
}

export interface Creative {
  id: string;
  name: string;
  market: string;
  spend: number;
  leads: number;
  confirmations: number;
  deliveries: number;
  returns: number;
  revenueNet: number;
  roasNet: number;
  roasMeta: number;
}

export interface MetaAdsCountryData {
  country: string;
  flag: string;
  clicks: number;
  spend: number;
  impressions: number;
  leads: number;
  cpl: number;
  ctr: number;
  confirmedLeads: number;
}

export interface PartnerCountryData {
  country: string;
  flag: string;
  confirmedLeads: number;
  revenue: number;
}

export interface Alert {
  id: string;
  level: AlertLevel;
  title: string;
  desc: string;
  action: string;
  market?: string;
  snoozed: boolean;
  timestamp: string;
}

export interface Motoboy {
  id: string;
  name: string;
  deliveries: number;
  totalCourses: number;
  cashRemitted: number;
  cashExpected: number;
  deliveryRate: number;
  lastSeen: string;
}

export interface Agent {
  id: string;
  name: string;
  leadsHandled: number;
  confirmed: number;
  confirmRate: number;
  avgCallDuration: string;
  onlineStatus: "online" | "offline" | "break";
}

export interface DataSource {
  id: string;
  icon: string;
  name: string;
  detail: string;
  status: ConnStatus;
  lastSync: string;
  latency?: string;
}

export interface CashDayPoint {
  day: string;
  cashIn: number;
  cashOut: number;
  net: number;
}

// ─── MARKETS ───────────────────────────────────────────────────────────────

export const MARKETS: Market[] = [
  {
    code: "AO", flag: "🇦🇴", name: "Angola", entity: "Naturala", currency: "AOA",
    rev: 8420, adSpend: 1940, cogs: 1200, callCenter: 420, logistics: 380, returns: 210, salaries: 300,
    decision: "scale", ppdo: 18.4, cpl: 1.94, delivRate: 71, rto: 11,
    leads: 847, confirmed: 492, delivered: 349, collected: 318, breakEven: 12,
  },
  {
    code: "MA", flag: "🇲🇦", name: "Maroc", entity: "FGMED", currency: "MAD",
    rev: 5800, adSpend: 1420, cogs: 870, callCenter: 230, logistics: 190, returns: 120, salaries: 350,
    decision: "scale", ppdo: 22.1, cpl: 2.31, delivRate: 74, rto: 7,
    leads: 614, confirmed: 388, delivered: 290, collected: 271, breakEven: 9,
  },
  {
    code: "SN", flag: "🇸🇳", name: "Sénégal", entity: "FGMED", currency: "XOF",
    rev: 4100, adSpend: 820, cogs: 620, callCenter: 185, logistics: 160, returns: 95, salaries: 200,
    decision: "scale", ppdo: 14.2, cpl: 1.42, delivRate: 65, rto: 9,
    leads: 577, confirmed: 315, delivered: 205, collected: 190, breakEven: 11,
  },
  {
    code: "CI", flag: "🇨🇮", name: "Côte d'Ivoire", entity: "FGMED", currency: "XOF",
    rev: 3250, adSpend: 710, cogs: 490, callCenter: 145, logistics: 130, returns: 80, salaries: 180,
    decision: "hold", ppdo: 11.8, cpl: 1.71, delivRate: 62, rto: 13,
    leads: 415, confirmed: 226, delivered: 140, collected: 126, breakEven: 13,
  },
  {
    code: "ML", flag: "🇲🇱", name: "Mali", entity: "FGMED", currency: "XOF",
    rev: 2100, adSpend: 540, cogs: 380, callCenter: 95, logistics: 110, returns: 65, salaries: 150,
    decision: "hold", ppdo: 9.4, cpl: 1.38, delivRate: 58, rto: 15,
    leads: 391, confirmed: 196, delivered: 114, collected: 101, breakEven: 14,
  },
  {
    code: "GA", flag: "🇬🇦", name: "Gabon", entity: "FGMED", currency: "XAF",
    rev: 1820, adSpend: 490, cogs: 310, callCenter: 80, logistics: 95, returns: 70, salaries: 130,
    decision: "hold", ppdo: 8.2, cpl: 1.82, delivRate: 60, rto: 17,
    leads: 269, confirmed: 140, delivered: 84, collected: 72, breakEven: 15,
  },
  {
    code: "GN", flag: "🇬🇳", name: "Guinée", entity: "FGMED", currency: "GNF",
    rev: 980, adSpend: 310, cogs: 210, callCenter: 48, logistics: 72, returns: 45, salaries: 100,
    decision: "stop", ppdo: 3.1, cpl: 2.10, delivRate: 51, rto: 22,
    leads: 148, confirmed: 72, delivered: 37, collected: 29, breakEven: 18,
  },
  {
    code: "CG", flag: "🇨🇬", name: "Congo-Brazza", entity: "FGMED", currency: "XAF",
    rev: 1150, adSpend: 380, cogs: 230, callCenter: 58, logistics: 88, returns: 55, salaries: 120,
    decision: "stop", ppdo: 2.8, cpl: 2.40, delivRate: 49, rto: 21,
    leads: 158, confirmed: 76, delivered: 39, collected: 30, breakEven: 18,
  },
];

// ─── CREATIVES ─────────────────────────────────────────────────────────────

export const CREATIVES: Creative[] = [
  { id: "c1", name: "AO-ProstaPower-V2", market: "AO", spend: 820, leads: 423, confirmations: 246, deliveries: 198, returns: 18, revenueNet: 5148, roasNet: 6.28, roasMeta: 8.41 },
  { id: "c2", name: "AO-PerdaPeso-V4", market: "AO", spend: 610, leads: 314, confirmations: 175, deliveries: 132, returns: 22, revenueNet: 2904, roasNet: 4.76, roasMeta: 7.12 },
  { id: "c3", name: "SN-Potencia35-V1", market: "SN", spend: 420, leads: 295, confirmations: 148, deliveries: 108, returns: 11, revenueNet: 2484, roasNet: 5.91, roasMeta: 6.80 },
  { id: "c4", name: "MA-VitalMax-V3", market: "MA", spend: 780, leads: 338, confirmations: 202, deliveries: 162, returns: 9, revenueNet: 4212, roasNet: 5.40, roasMeta: 5.82 },
  { id: "c5", name: "CI-Minceur-V2", market: "CI", spend: 350, leads: 204, confirmations: 98, deliveries: 68, returns: 14, revenueNet: 1360, roasNet: 3.89, roasMeta: 7.34 },
  { id: "c6", name: "GN-Boost-V1", market: "GN", spend: 310, leads: 148, confirmations: 63, deliveries: 38, returns: 11, revenueNet: 646, roasNet: 2.08, roasMeta: 6.91 },
  { id: "c7", name: "MA-Potencia40-V2", market: "MA", spend: 640, leads: 290, confirmations: 186, deliveries: 148, returns: 8, revenueNet: 3848, roasNet: 6.01, roasMeta: 6.44 },
  { id: "c8", name: "ML-ForceMax-V1", market: "ML", spend: 280, leads: 203, confirmations: 95, deliveries: 56, returns: 12, revenueNet: 1008, roasNet: 3.60, roasMeta: 5.90 },
];

// ─── ALERTS ────────────────────────────────────────────────────────────────

export const ALERTS: Alert[] = [
  {
    id: "a1", level: "critical", market: "GN",
    title: "Guinée · taux de livraison critique",
    desc: "Taux livraison 51% < seuil 60%. Ad spend $310 continue à brûler sans retour.",
    action: "Suspendre ads Guinée", snoozed: false, timestamp: "14:10",
  },
  {
    id: "a2", level: "critical", market: "CG",
    title: "Congo-Brazza · PPDO négatif",
    desc: "PPDO $2.8, break-even estimé à $6.50. Le marché est en perte nette structurelle.",
    action: "Couper ad spend Congo", snoozed: false, timestamp: "13:55",
  },
  {
    id: "a3", level: "warning", market: "CI",
    title: "Créa CI-Minceur-V2 · fatigue détectée",
    desc: "ROAS Meta brute 7.34× vs ROAS net 3.89×. Écart +89% : leads Meta ne convertissent pas en cash.",
    action: "Pauser la créa et tester 3 nouvelles variantes", snoozed: false, timestamp: "12:30",
  },
  {
    id: "a4", level: "warning",
    title: "Motoboy João F. · ratio cash diverge",
    desc: "Cash remis / livraisons : 68% vs moyenne équipe 91%. Écart sur 18 courses consécutives.",
    action: "Audit João F. — vérifier reçus et géoloc", snoozed: false, timestamp: "11:00",
  },
  {
    id: "a5", level: "info",
    title: "LeadVertex · export manuel en attente",
    desc: "Dernier import il y a 26h. Statuts orders Angola non synchronisés.",
    action: "Importer l'export LeadVertex maintenant", snoozed: false, timestamp: "09:45",
  },
];

// ─── MOTOBOYS ──────────────────────────────────────────────────────────────

export const MOTOBOYS: Motoboy[] = [
  { id: "m1", name: "Carlos M.", deliveries: 13, totalCourses: 14, cashRemitted: 4550, cashExpected: 4900, deliveryRate: 93, lastSeen: "14:28" },
  { id: "m2", name: "Pedro S.", deliveries: 10, totalCourses: 11, cashRemitted: 3420, cashExpected: 3750, deliveryRate: 91, lastSeen: "14:15" },
  { id: "m3", name: "João F.", deliveries: 16, totalCourses: 18, cashRemitted: 3840, cashExpected: 5600, deliveryRate: 68, lastSeen: "13:40" },
  { id: "m4", name: "Miguel A.", deliveries: 9, totalCourses: 9, cashRemitted: 3060, cashExpected: 3150, deliveryRate: 97, lastSeen: "14:30" },
];

// ─── AGENTS ────────────────────────────────────────────────────────────────

export const AGENTS: Agent[] = [
  { id: "ag1", name: "Glória N.", leadsHandled: 48, confirmed: 31, confirmRate: 65, avgCallDuration: "3m 12s", onlineStatus: "online" },
  { id: "ag2", name: "Paulina R.", leadsHandled: 52, confirmed: 30, confirmRate: 58, avgCallDuration: "4m 05s", onlineStatus: "online" },
  { id: "ag3", name: "Erica C.", leadsHandled: 41, confirmed: 25, confirmRate: 61, avgCallDuration: "3m 44s", onlineStatus: "break" },
];

// ─── DATA SOURCES ──────────────────────────────────────────────────────────

export const DATA_SOURCES: DataSource[] = [
  { id: "ds1", icon: "meta", name: "Meta Ads API", detail: "act_1655996505828767", status: "ok", lastSync: "14:32", latency: "<1min" },
  { id: "ds2", icon: "sheets", name: "LeadVertex Export", detail: "Excel · Angola + Maroc", status: "warning", lastSync: "il y a 26h" },
  { id: "ds3", icon: "sheets", name: "Angola Google Sheet", detail: "Livraisons + encaissements", status: "ok", lastSync: "14:18", latency: "~15min" },
  { id: "ds4", icon: "tiktok", name: "TikTok Ads API", detail: "App review en cours (1-2 sem.)", status: "error", lastSync: "N/A" },
  { id: "ds5", icon: "instagram", name: "Instagram / Facebook", detail: "Graph API organique", status: "warning", lastSync: "Non configuré" },
  { id: "ds6", icon: "motorbike", name: "App Motoboys", detail: "Appsheet Angola · v1 prototype", status: "warning", lastSync: "Mois 2" },
  { id: "ds7", icon: "fx", name: "FX Rates API", detail: "exchangerate.host · AOA/MAD/XOF/XAF/GNF", status: "ok", lastSync: "00:05", latency: "quotidien" },
  { id: "ds8", icon: "database", name: "Supabase PostgreSQL", detail: "PostgREST + RLS · Vercel", status: "ok", lastSync: "14:32", latency: "temps réel" },
];

// ─── CASH TREND ────────────────────────────────────────────────────────────

export const CASH_7D: CashDayPoint[] = [
  { day: "3 juin", cashIn: 4200, cashOut: 1600, net: 2600 },
  { day: "4 juin", cashIn: 5100, cashOut: 1800, net: 3300 },
  { day: "5 juin", cashIn: 3800, cashOut: 1500, net: 2300 },
  { day: "6 juin", cashIn: 6200, cashOut: 2100, net: 4100 },
  { day: "7 juin", cashIn: 5500, cashOut: 1900, net: 3600 },
  { day: "8 juin", cashIn: 7100, cashOut: 2200, net: 4900 },
  { day: "9 juin", cashIn: 8420, cashOut: 1940, net: 6480 },
];

export const CASHFLOW_14D = Array.from({ length: 14 }, (_, i) => ({
  day: `J+${i + 1}`,
  projected: Math.round(8000 + i * 350 + Math.sin(i) * 800),
  burn: Math.round(2100 + i * 70),
}));

// ─── META ADS ──────────────────────────────────────────────────────────────

export const META_ADS_DATA: MetaAdsCountryData[] = [
  { country: "Angola", flag: "🇦🇴", clicks: 3420, spend: 1940, impressions: 45200, leads: 847, cpl: 2.29, ctr: 7.56, confirmedLeads: 492 },
  { country: "Maroc", flag: "🇲🇦", clicks: 2680, spend: 1420, impressions: 38900, leads: 614, cpl: 2.31, ctr: 6.89, confirmedLeads: 388 },
  { country: "Sénégal", flag: "🇸🇳", clicks: 1950, spend: 820, impressions: 28400, leads: 577, cpl: 1.42, ctr: 6.87, confirmedLeads: 315 },
  { country: "Côte d'Ivoire", flag: "🇨🇮", clicks: 1240, spend: 710, impressions: 19800, leads: 415, cpl: 1.71, ctr: 6.26, confirmedLeads: 226 },
  { country: "Mali", flag: "🇲🇱", clicks: 890, spend: 540, impressions: 15600, leads: 391, cpl: 1.38, ctr: 5.70, confirmedLeads: 196 },
  { country: "Gabon", flag: "🇬🇦", clicks: 645, spend: 490, impressions: 12300, leads: 269, cpl: 1.82, ctr: 5.24, confirmedLeads: 140 },
  { country: "Guinée", flag: "🇬🇳", clicks: 380, spend: 310, impressions: 8900, leads: 148, cpl: 2.10, ctr: 4.27, confirmedLeads: 72 },
  { country: "Congo-Brazza", flag: "🇨🇬", clicks: 420, spend: 380, impressions: 10200, leads: 158, cpl: 2.40, ctr: 4.12, confirmedLeads: 76 },
];

// ─── SHIPSEN ──────────────────────────────────────────────────────────────

export const SHIPSEN_DATA: PartnerCountryData[] = [
  { country: "Angola", flag: "🇦🇴", confirmedLeads: 145, revenue: 3480 },
  { country: "Maroc", flag: "🇲🇦", confirmedLeads: 98, revenue: 2352 },
  { country: "Sénégal", flag: "🇸🇳", confirmedLeads: 67, revenue: 1608 },
  { country: "Côte d'Ivoire", flag: "🇨🇮", confirmedLeads: 45, revenue: 1080 },
  { country: "Mali", flag: "🇲🇱", confirmedLeads: 32, revenue: 768 },
  { country: "Gabon", flag: "🇬🇦", confirmedLeads: 28, revenue: 672 },
  { country: "Guinée", flag: "🇬🇳", confirmedLeads: 15, revenue: 360 },
];

// ─── AFRIQUECOD / NOKI NOKI ────────────────────────────────────────────────

export const NOKI_NOKI_DATA: PartnerCountryData[] = [
  { country: "Angola", flag: "🇦🇴", confirmedLeads: 182, revenue: 4368 },
  { country: "Maroc", flag: "🇲🇦", confirmedLeads: 128, revenue: 3072 },
  { country: "Sénégal", flag: "🇸🇳", confirmedLeads: 85, revenue: 2040 },
  { country: "Côte d'Ivoire", flag: "🇨🇮", confirmedLeads: 56, revenue: 1344 },
  { country: "Mali", flag: "🇲🇱", confirmedLeads: 42, revenue: 1008 },
  { country: "Gabon", flag: "🇬🇦", confirmedLeads: 35, revenue: 840 },
];

// ─── AFRICACOD / COLISCOD ──────────────────────────────────────────────────

export const COLISCOD_DATA: PartnerCountryData[] = [
  { country: "Angola", flag: "🇦🇴", confirmedLeads: 165, revenue: 2640 },
  { country: "Maroc", flag: "🇲🇦", confirmedLeads: 112, revenue: 1792 },
  { country: "Sénégal", flag: "🇸🇳", confirmedLeads: 75, revenue: 1200 },
  { country: "Côte d'Ivoire", flag: "🇨🇮", confirmedLeads: 48, revenue: 768 },
  { country: "Mali", flag: "🇲🇱", confirmedLeads: 35, revenue: 560 },
  { country: "Gabon", flag: "🇬🇦", confirmedLeads: 28, revenue: 448 },
  { country: "Guinée", flag: "🇬🇳", confirmedLeads: 12, revenue: 192 },
];

// ─── CLICKMARKET ──────────────────────────────────────────────────────────

export const CLICKMARKET_DATA: PartnerCountryData[] = [
  { country: "Angola", flag: "🇦🇴", confirmedLeads: 128, revenue: 3840 },
  { country: "Maroc", flag: "🇲🇦", confirmedLeads: 95, revenue: 2850 },
  { country: "Sénégal", flag: "🇸🇳", confirmedLeads: 62, revenue: 1860 },
  { country: "Côte d'Ivoire", flag: "🇨🇮", confirmedLeads: 42, revenue: 1260 },
  { country: "Mali", flag: "🇲🇱", confirmedLeads: 28, revenue: 840 },
];

// ─── HELPERS ───────────────────────────────────────────────────────────────

export function calcNetMargin(m: Market): number {
  return m.rev - m.adSpend - m.cogs - m.callCenter - m.logistics - m.returns - m.salaries;
}

export function calcMarginPct(m: Market): number {
  return Math.round((calcNetMargin(m) / m.rev) * 100);
}

export function calcROASNet(m: Market): string {
  return (m.rev / m.adSpend).toFixed(1);
}

export function fmtUSD(v: number): string {
  return "$" + Math.round(v).toLocaleString("fr-FR").replace(/\s/g, "\u202f");
}

export function fmtPct(v: number): string {
  return v + "%";
}
