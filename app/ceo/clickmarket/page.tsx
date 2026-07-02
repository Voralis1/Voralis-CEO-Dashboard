"use client";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { CLICKMARKET_DATA, fmtUSD } from "@/lib/data";

export default function ClickMarketPage() {


  const data = CLICKMARKET_DATA;

  const sorted = [...data].sort((a, b) => b.confirmedLeads - a.confirmedLeads);

  return (
    <div>
      <Topbar title="ClickMarket" subtitle="Commandes confirmées et revenus par pays" />

      <div className="px-6 py-5 space-y-5">
        {/* ClickMarket Performance Table */}
        <Section title="Performance ClickMarket par pays">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Pays", "Commandes confirmées", "Revenue"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
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
                    <td className="px-3 py-3 font-semibold text-emerald-600">{Math.round(d.confirmedLeads).toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3 text-slate-700">{fmtUSD(d.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Summary Stats */}
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
