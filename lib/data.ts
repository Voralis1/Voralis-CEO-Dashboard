// ─── HELPERS ───────────────────────────────────────────────────────────────

export function fmtUSD(v: number): string {
  return "$" + Math.round(v).toLocaleString("fr-FR").replace(/\s/g, " ");
}
