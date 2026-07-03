import { supabaseAdmin } from "@/lib/supabase/server";

export async function GET() {
  const [{ data: byCountry, error: byCountryError }, { data: global, error: globalError }] =
    await Promise.all([
      supabaseAdmin.from("shipsen_kpi_by_country").select("*"),
      supabaseAdmin.from("shipsen_kpi_global").select("*").single(),
    ]);

  if (byCountryError || globalError) {
    const message = byCountryError?.message ?? globalError?.message ?? "Unknown error";
    return Response.json({ error: message }, { status: 502 });
  }

  return Response.json({ byCountry: byCountry ?? [], global: global ?? null });
}
