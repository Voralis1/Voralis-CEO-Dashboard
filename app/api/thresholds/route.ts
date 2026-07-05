import { getCurrentUserRole } from "@/lib/auth/role";
import { computeAllThresholds, stripCeoDetail } from "@/lib/thresholds";

// Calcule TOUJOURS la chaîne complète côté serveur (M, T, COGS, coût call center inclus), puis
// façonne la réponse selon le rôle authentifié — jamais l'inverse. Un rôle "team" ne reçoit
// jamais ceoDetail dans le JSON, même en inspectant la requête réseau : la clé est retirée de
// l'objet avant sérialisation, pas seulement cachée côté client.
export async function GET(request: Request) {
  const role = await getCurrentUserRole();
  if (!role) return Response.json({ error: "Non authentifié." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  if (!dateFrom || !dateTo) {
    return Response.json({ error: "dateFrom et dateTo sont requis." }, { status: 400 });
  }

  const rows = await computeAllThresholds(dateFrom, dateTo);

  return Response.json({
    role,
    rows: role === "ceo" ? rows : stripCeoDetail(rows),
  });
}
