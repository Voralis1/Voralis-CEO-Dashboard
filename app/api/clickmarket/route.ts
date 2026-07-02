import { fetchClickMarketOrdersPage } from "@/lib/clickmarket";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const countryId = Number(searchParams.get("country_id") ?? "19");
  const countryName = searchParams.get("country_name") ?? "Gabon";
  const currency = searchParams.get("currency") ?? "XAF";
  const page = Number(searchParams.get("page") ?? "1");
  const perPage = Number(searchParams.get("per_page") ?? "100");

  try {
    const data = await fetchClickMarketOrdersPage(
      { id: countryId, name: countryName, currency },
      page,
      perPage
    );
    return Response.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 502 });
  }
}
