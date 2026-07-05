import { supabaseAdmin } from "@/lib/supabase/server";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/cash-holdings/[id]">) {
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin.from("cash_holdings").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
