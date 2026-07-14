import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth/role";
import type { MarketSettingsUpdate } from "@/lib/marketSettings";

// Champs éditables uniquement — pays et devise_locale sont verrouillés (mapping devise
// validé, voir lib/countries.ts et le check constraint dans market_settings_schema.sql)
// pour ne jamais reproduire un bug de devise incorrecte assignée à un pays.
const EDITABLE_FIELDS = [
  "fx_to_usd",
  "conf_pct",
  "dr_pct",
  "marge_plancher_t",
  "aov_override",
] as const;

export async function PATCH(request: Request, ctx: RouteContext<"/api/market-settings/[pays]">) {
  const role = await getCurrentUserRole();
  if (role !== "ceo") return Response.json({ error: "Accès réservé au CEO." }, { status: 403 });

  const { pays } = await ctx.params;
  const body = (await request.json()) as MarketSettingsUpdate;

  const patch: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) patch[field] = body[field];
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "Aucun champ éditable fourni." }, { status: 400 });
  }

  if (patch.fx_to_usd !== undefined) {
    patch.fx_updated_at = new Date().toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from("market_settings")
    .update(patch)
    .eq("pays", pays)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ setting: data });
}
