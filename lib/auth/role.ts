import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export type UserRole = "ceo" | "team";

// Lit le rôle depuis la session Supabase authentifiée (cookie), JAMAIS depuis une valeur
// envoyée par le client. Le rôle vit dans app_metadata (modifiable uniquement via l'API Admin,
// clé service_role) — jamais user_metadata, qui est modifiable par l'utilisateur lui-même via
// le SDK client et donc falsifiable.
// Rôle absent/inconnu → "team" (fail-closed) : un compte sans rôle explicite ne doit jamais
// voir la marge, le CPL réel détaillé, etc. — seul un rôle "ceo" explicite débloque la vue complète.
export async function getCurrentUserRole(): Promise<UserRole | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // no-op : lecture seule d'une session existante dans un Route Handler, pas de refresh
        // de cookies nécessaire ici (contrairement à proxy.ts qui gère la navigation complète).
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;
  return user.app_metadata?.role === "ceo" ? "ceo" : "team";
}
