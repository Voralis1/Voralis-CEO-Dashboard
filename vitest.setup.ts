// Charge .env dans process.env pour les tests — Next.js le fait automatiquement en dev/build,
// Vitest non. Nécessaire uniquement parce que lib/supabase/server.ts lit ces variables au
// niveau module (import), même si les tests ciblés ne l'utilisent pas directement.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(__dirname, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    if (!line.includes("=") || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
