import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth/role";
import type { CopilotAlertThresholdsUpdate } from "@/lib/copilot/alertThresholds";

// Lecture : tout utilisateur authentifié (les seuils eux-mêmes ne sont pas confidentiels — ce
// sont des politiques, pas de la marge). Écriture : CEO uniquement.
export async function GET() {
  const role = await getCurrentUserRole();
  if (!role) return Response.json({ error: "Non authentifié." }, { status: 401 });

  const { data, error } = await supabaseAdmin.from("copilot_alert_thresholds").select("*").eq("id", "default").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ thresholds: data });
}

export async function PATCH(request: Request) {
  const role = await getCurrentUserRole();
  if (role !== "ceo") return Response.json({ error: "Accès réservé au CEO." }, { status: 403 });

  const body = (await request.json()) as CopilotAlertThresholdsUpdate;
  const patch: Record<string, unknown> = {};
  for (const field of ["taux_rupture_stock_max_pct", "dr_pct_drop_max_points", "cash_non_rapatrie_max_usd"] as const) {
    if (body[field] !== undefined) patch[field] = body[field];
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "Aucun champ éditable fourni." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("copilot_alert_thresholds")
    .update(patch)
    .eq("id", "default")
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ thresholds: data });
}
