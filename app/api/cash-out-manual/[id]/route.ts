import { supabaseAdmin } from "@/lib/supabase/server";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/cash-out-manual/[id]">) {
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin.from("cash_out_manual").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
