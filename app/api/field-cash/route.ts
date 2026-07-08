import { getCurrentUserRole } from "@/lib/auth/role";
import { fetchFieldCashRecap } from "@/lib/fieldCashServer";

// Lecture seule — la mini-app "Field Cash Angola" est la seule à écrire dans ces tables.
// Même niveau d'accès que cash_holdings/inventory (tout utilisateur authentifié) : ce ne sont
// pas des montants de marge/COGS confidentiels, plutôt un suivi opérationnel de trésorerie.
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

  const recap = await fetchFieldCashRecap(country, dateFrom, dateTo);
  return Response.json({ recap });
}