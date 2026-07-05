import { getCurrentUserRole } from "@/lib/auth/role";
import { supabaseAdmin } from "@/lib/supabase/server";
import { buildCopilotSnapshot } from "@/lib/copilot/snapshot";
import { computeBottleneckAnalysis } from "@/lib/copilot/bottleneck";
import { computeProactiveAlerts, previousEquivalentPeriod } from "@/lib/copilot/alerts";
import type { CopilotAlertThresholds } from "@/lib/copilot/alertThresholds";

// Alertes proactives rendues par template (jamais par le LLM — choix validé) : rafraîchissement
// à la demande, pas de push temps réel (architecture validée par le CEO pour ce lot).
export async function GET(request: Request) {
  const role = await getCurrentUserRole();
  if (!role) return Response.json({ error: "Non authentifié." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  if (!dateFrom || !dateTo) return Response.json({ error: "Paramètres dateFrom/dateTo requis." }, { status: 400 });

  const prevPeriod = previousEquivalentPeriod(dateFrom, dateTo);

  const [current, previous, thresholdsRes] = await Promise.all([
    buildCopilotSnapshot(dateFrom, dateTo, role),
    buildCopilotSnapshot(prevPeriod.dateFrom, prevPeriod.dateTo, role).catch(() => null),
    supabaseAdmin.from("copilot_alert_thresholds").select("*").eq("id", "default").single(),
  ]);

  if (thresholdsRes.error) return Response.json({ error: thresholdsRes.error.message }, { status: 500 });
  const thresholds = thresholdsRes.data as CopilotAlertThresholds;

  const bottleneck = computeBottleneckAnalysis(current);
  const alerts = computeProactiveAlerts(current, previous, bottleneck, thresholds);

  return Response.json({ alerts, bottleneck: { cibleJour: bottleneck.cibleJour, livresRentablesJourActuel: bottleneck.livresRentablesJourActuel, ecartJour: bottleneck.ecartJour, angleMortObjectif: bottleneck.angleMortObjectif } });
}
