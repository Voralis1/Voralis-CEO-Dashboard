import Topbar from "@/components/layout/Topbar";
import { Section } from "@/components/ui";
import { SHIPSEN_DATA, PartnerCountryData, fmtUSD } from "@/lib/data";
import { fetchShipsenStats } from "@/lib/shipsen";

async function getShipsenData(): Promise<{ data: PartnerCountryData[]; source: "live" | "mock" }> {
  try {
    const data = await fetchShipsenStats();
    return { data, source: "live" };
  } catch {
    return { data: SHIPSEN_DATA, source: "mock" };
  }
}

export default async function ShipsenPage() {
  const { data, source } = await getShipsenData();
  const sorted = [...data].sort((a, b) => b.confirmedLeads - a.confirmedLeads);

  return (
    <div>
      <Topbar
        title="Shipsen"
        subtitle={
          source === "live"
            ? "Commandes confirmées et revenus par pays · données live"
            : "Commandes confirmées et revenus par pays · données de démonstration"
        }
      />

      <div className="px-6 py-5 space-y-5">
        {source === "mock" && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600">
            Connexion Shipsen indisponible — données de démonstration affichées. Vérifiez{" "}
            <code className="font-mono">SHIPSEN_API_KEY</code> /{" "}
            <code className="font-mono">SHIPSEN_API_SECRET</code> dans votre <code className="font-mono">.env</code>.
          </div>
        )}

        <Section title="Performance Shipsen par pays">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Pays", "Commandes confirmées", "Revenue"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => (
                  <tr key={d.country} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-medium text-slate-900">
                        <span className="text-base">{d.flag}</span>
                        {d.country}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-semibold text-emerald-600">
                      {Math.round(d.confirmedLeads).toLocaleString("fr-FR")}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{fmtUSD(d.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="grid grid-cols-2 gap-4">
          <Section title="Total commandes confirmées">
            <p className="text-3xl font-bold text-emerald-600 mt-2">
              {Math.round(data.reduce((sum, d) => sum + d.confirmedLeads, 0)).toLocaleString("fr-FR")}
            </p>
          </Section>
          <Section title="Total Revenue">
            <p className="text-3xl font-bold text-slate-900 mt-2">
              {fmtUSD(data.reduce((sum, d) => sum + d.revenue, 0))}
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
