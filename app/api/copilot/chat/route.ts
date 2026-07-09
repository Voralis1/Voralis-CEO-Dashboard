import OpenAI from "openai";
import { getCurrentUserRole } from "@/lib/auth/role";
import { buildCopilotSnapshot } from "@/lib/copilot/snapshot";
import { computeBottleneckAnalysis } from "@/lib/copilot/bottleneck";

// Chatbot copilot — app/api/copilot/chat/route.ts. Architecture validée par le CEO :
//   1) buildCopilotSnapshot() calcule TOUS les chiffres (déterministe, testé unitairement).
//   2) computeBottleneckAnalysis() classe les goulots (déterministe, aucun LLM).
//   3) Le LLM ne fait QUE reformuler ce classement en actions priorisées — il ne recalcule et
//      n'invente jamais un chiffre. Le gating CEO/team est déjà appliqué AVANT que ce fichier ne
//      s'exécute : buildCopilotSnapshot() omet purement et simplement le champ margin/ceoDetail
//      pour le rôle "team" — cette donnée ne quitte donc jamais le serveur, quoi que le prompt
//      utilisateur demande (cohérent avec le module Seuils, Prompt 6).
//
// LLM servi via OpenRouter (2026-07-08) — endpoint compatible OpenAI, pas l'API Anthropic
// native. Modèle : deepseek/deepseek-v4-flash (slug confirmé sur l'API publique OpenRouter).
// Conséquence : pas de "thinking" natif ni de cache_control (spécifiques à l'API Anthropic) —
// juste un tableau messages plat, format OpenAI.
const OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function systemPrompt(role: "ceo" | "team"): string {
  const gatingClause =
    role === "ceo"
      ? "Tu t'adresses au CEO : tu PEUX citer la marge nette, le PPDO, les composantes de coût (COGS, coût des retours) et la marge plancher T quand elles sont présentes dans les données ci-dessous."
      : "Tu t'adresses à un membre de l'équipe (rôle \"team\") : la marge nette, le PPDO et le détail des coûts (COGS, retours, T) NE SONT PAS dans les données ci-dessous — ils ont été retirés côté serveur avant de t'atteindre. Ne les invente JAMAIS, ne les estime JAMAIS, et n'affirme jamais connaître la rentabilité exacte d'un marché : appuie-toi uniquement sur le feu tricolore CPL/payout (rouge/orange/vert) et les plafonds déjà fournis.";

  return `Tu es le copilote analytique du dashboard CEO Voralis (activité COD, 7 marchés africains).

OBJECTIF DIRECTEUR UNIQUE : atteindre 50 commandes livrées ET encaissées ET RENTABLES par jour
(rentable = marge nette positive après frais de livraison fixe 11 USD/commande — qui inclut déjà
le coût call center, jamais compté deux fois —, payout affilié ou dépense publicitaire, COGS,
coût des retours). Toute réponse doit se rattacher à cet objectif : identifie le goulot
d'étranglement le plus impactant sur le chemin acquisition → confirmation → livraison →
encaissement, jamais une liste de KPI déconnectée.

RÈGLES ABSOLUES :
1. Les données ci-dessous (snapshot + analyse de goulots) sont la SEULE source de vérité. Elles
   ont été calculées par un moteur déterministe (jamais par toi) — tu ne dois JAMAIS recalculer,
   corriger ou extrapoler un chiffre différent de ce qui t'est fourni.
2. Si une donnée est "null" ou absente dans le JSON, ou apparaît dans la liste "angleMorts", tu
   DOIS le signaler explicitement ("je ne peux pas évaluer X faute de donnée Y") — n'invente
   jamais de chiffre et ne calcule jamais comme si la valeur manquante valait 0.
3. Format de réponse OBLIGATOIRE : pour chaque point soulevé, structure ta réponse en
   OÙ (marché/réseau/affilié + étape du funnel) / QUOI (action concrète) / IMPACT (gain estimé en
   livraisons rentables/jour ou en marge, en reprenant l'estimation déjà calculée — jamais un
   chiffre que tu inventes). Il est INTERDIT de répondre uniquement par un tableau de chiffres :
   toute donnée citée doit être suivie d'une action.
4. Priorise: commence par le goulot le plus impactant (déjà classé dans "insights", trié du plus
   au moins impactant), puis descends dans l'ordre. Ne mentionne pas tous les marchés si un seul
   domine le goulot actuel — la valeur du copilote est de trancher, pas de tout lister.
5. ${gatingClause}

Sois concis : un CEO ou un membre d'équipe lit ça entre deux réunions, pas un rapport.`;
}

export async function POST(request: Request) {
  const role = await getCurrentUserRole();
  if (!role) return Response.json({ error: "Non authentifié." }, { status: 401 });

  if (!process.env.OPENROUTER_API_KEY) {
    return Response.json(
      { error: "OPENROUTER_API_KEY n'est pas configurée sur le serveur. Ajoutez-la dans .env pour activer le copilote." },
      { status: 503 }
    );
  }

  const body = (await request.json()) as { messages: ChatMessage[]; dateFrom: string; dateTo: string };
  if (!body.dateFrom || !body.dateTo || !Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "Paramètres invalides (messages, dateFrom, dateTo requis)." }, { status: 400 });
  }

  const snapshot = await buildCopilotSnapshot(body.dateFrom, body.dateTo, role);
  const bottleneck = computeBottleneckAnalysis(snapshot);

  const dataContext = JSON.stringify({ snapshot, bottleneck }, null, 0);

  const response = await client.chat.completions.create({
    model: OPENROUTER_MODEL,
    max_tokens: 4096,
    messages: [
      { role: "system", content: systemPrompt(role) },
      { role: "system", content: `DONNÉES (snapshot + analyse de goulots, période ${body.dateFrom} → ${body.dateTo}) :\n${dataContext}` },
      ...body.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  });

  const reply = response.choices[0]?.message?.content ?? "";

  return Response.json({ reply });
}
