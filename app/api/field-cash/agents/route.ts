import { getCurrentUserRole } from "@/lib/auth/role";
import { fetchFieldCashByAgent } from "@/lib/fieldCashServer";

export async function GET(request: Request) {
  const role = await getCurrentUserRole();
  if (!role) return Response.json({ error: "Non authentifié." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  if (!country || !dateFrom || !dateTo) {
    return Response.json({ error: "Paramètres country/dateFrom/dateTo requis." }, { status: 400 });
  }

  const agents = await fetchFieldCashByAgent(country, dateFrom, dateTo);
  return Response.json({ agents });
}