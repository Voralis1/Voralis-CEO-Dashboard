import { supabaseAdmin } from "@/lib/supabase/server";
import type { CashOutManualInput } from "@/lib/cashOps";

export async function GET() {
  const { data, error } = await supabaseAdmin.from("cash_out_manual").select("*").order("date", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ entries: data });
}

export async function POST(request: Request) {
  const body = (await request.json()) as CashOutManualInput;

  const { data, error } = await supabaseAdmin
    .from("cash_out_manual")
    .insert({
      type: body.type,
      pays: body.pays,
      montant: body.montant,
      description: body.description,
      date: body.date,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ entry: data }, { status: 201 });
}
