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

// ─── HELPERS ───────────────────────────────────────────────────────────────

export function fmtUSD(v: number): string {
  return "$" + Math.round(v).toLocaleString("fr-FR").replace(/\s/g, " ");
}
