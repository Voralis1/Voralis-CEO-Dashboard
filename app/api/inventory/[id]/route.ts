import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth/role";
import type { InventoryUpdate } from "@/lib/inventory";

const EDITABLE_FIELDS = ["delai_appro_jours", "stock_securite", "ventes_moyennes_jour_override"] as const;

export async function PATCH(request: Request, ctx: RouteContext<"/api/inventory/[id]">) {
  const role = await getCurrentUserRole();
  if (role !== "ceo") return Response.json({ error: "Accès réservé au CEO." }, { status: 403 });

  const { id } = await ctx.params;
  const body = (await request.json()) as InventoryUpdate;

  const patch: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) patch[field] = body[field];
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "Aucun champ éditable fourni." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.from("inventory").update(patch).eq("id", id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ row: data });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/inventory/[id]">) {
  const role = await getCurrentUserRole();
  if (role !== "ceo") return Response.json({ error: "Accès réservé au CEO." }, { status: 403 });

  const { id } = await ctx.params;
  const { error } = await supabaseAdmin.from("inventory").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
