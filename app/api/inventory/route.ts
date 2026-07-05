import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth/role";
import type { InventoryCreateInput } from "@/lib/inventory";

// Lecture : tout utilisateur authentifié (pas de donnée financière confidentielle ici — utile
// à une future personne logistique/ops). Écriture : réservée au rôle CEO pour l'instant (pas
// encore de rôle "gestion stock" dédié — à affiner plus tard).
export async function GET() {
  const role = await getCurrentUserRole();
  if (!role) return Response.json({ error: "Non authentifié." }, { status: 401 });

  const { data, error } = await supabaseAdmin.from("inventory").select("*").order("pays").order("produit");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ inventory: data });
}

export async function POST(request: Request) {
  const role = await getCurrentUserRole();
  if (role !== "ceo") return Response.json({ error: "Accès réservé au CEO." }, { status: 403 });

  const body = (await request.json()) as InventoryCreateInput;

  const { data, error } = await supabaseAdmin
    .from("inventory")
    .insert({
      pays: body.pays,
      produit: body.produit,
      quantite_stock: body.quantite_stock,
      delai_appro_jours: body.delai_appro_jours,
      stock_securite: body.stock_securite,
      ventes_moyennes_jour_override: body.ventes_moyennes_jour_override,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ row: data }, { status: 201 });
}
