import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth/role";

// market_settings mélange des champs non confidentiels (pays, devise, FX — nécessaires à
// Trésorerie/Logistics COD/ProviderKpiTable pour afficher les montants) et des champs
// confidentiels CEO (COGS, coût call center, marge plancher T). ?scope=public ne renvoie que
// les premiers, pour tout utilisateur authentifié ; le mode par défaut (tous les champs) est
// réservé au rôle "ceo", vérifié côté serveur sur la session (jamais un rôle envoyé par le client).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const role = await getCurrentUserRole();

  if (searchParams.get("scope") === "public") {
    if (!role) return Response.json({ error: "Non authentifié." }, { status: 401 });
    const { data, error } = await supabaseAdmin
      .from("market_settings")
      .select("pays, devise_locale, fx_to_usd, delivery_model")
      .order("pays");
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ settings: data });
  }

  if (role !== "ceo") return Response.json({ error: "Accès réservé au CEO." }, { status: 403 });

  const { data, error } = await supabaseAdmin.from("market_settings").select("*").order("pays");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ settings: data });
}
