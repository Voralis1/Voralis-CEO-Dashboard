import { supabaseAdmin } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  const [{ data: byCountry, error: byCountryError }, { data: global, error: globalError }] =
    dateFrom && dateTo
      ? await Promise.all([
          supabaseAdmin.rpc("kpi_shipsen_marche_periode", { date_from: dateFrom, date_to: dateTo }),
          supabaseAdmin.rpc("kpi_shipsen_global_periode", { date_from: dateFrom, date_to: dateTo }).single(),
        ])
      : await Promise.all([
          supabaseAdmin.from("shipsen_kpi_by_country").select("*"),
          supabaseAdmin.from("shipsen_kpi_global").select("*").single(),
        ]);

  if (byCountryError || globalError) {
    const message = byCountryError?.message ?? globalError?.message ?? "Unknown error";
    return Response.json({ error: message }, { status: 502 });
  }

  return Response.json({ byCountry: byCountry ?? [], global: global ?? null });
}
