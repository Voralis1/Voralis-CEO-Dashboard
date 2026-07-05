import { supabaseAdmin } from "@/lib/supabase/server";
import type { CashHoldingInput } from "@/lib/cashOps";

export async function GET() {
  const { data, error } = await supabaseAdmin.from("cash_holdings").select("*").order("pays");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ holdings: data });
}

export async function POST(request: Request) {
  const body = (await request.json()) as CashHoldingInput;

  const { data, error } = await supabaseAdmin
    .from("cash_holdings")
    .insert({
      entite: body.entite,
      pays: body.pays,
      montant_detenu: body.montant_detenu,
      date_derniere_remise: body.date_derniere_remise,
      statut_rapatriement: body.statut_rapatriement,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ holding: data }, { status: 201 });
}
