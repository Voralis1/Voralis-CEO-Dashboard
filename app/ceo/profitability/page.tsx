"use client";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge, DecisionPill, ProgressBar } from "@/components/ui";
import { MARKETS, CREATIVES, fmtUSD, calcNetMargin, calcMarginPct, calcROASNet } from "@/lib/data";
import { BarChart2 } from "lucide-react";

export default function ProfitabilityPage() {
  const sorted = [...MARKETS].sort((a, b) => calcNetMargin(b) - calcNetMargin(a));

  return (
    <div>
      <Topbar title="Rentabilité" subtitle="Scaler, maintenir, arrêter — par marché, produit, créa" />

      <div className="px-6 py-5 space-y-5">

        {/* Markets table */}
        <Section title="Marge nette par marché">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Marché", "Revenue", "Ad spend", "Marge nette", "Marge %", "ROAS net", "Delivery", "RTO", "Décision"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((m, i) => {
                  const net = calcNetMargin(m);
                  const marg = calcMarginPct(m);
                  const roas = calcROASNet(m);
                  const isTop = i === 0;
                  return (
                    <tr key={m.code} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2 font-medium text-slate-900">
                          <span className="text-base">{m.flag}</span>
                          {m.name}
                          {isTop && <span className="text-[10px] text-[#c9a227]">★ #1</span>}
                          <span className="text-[9px] text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded">{m.entity}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{fmtUSD(m.rev)}</td>
                      <td className="px-3 py-3 text-slate-500">{fmtUSD(m.adSpend)}</td>
                      <td className="px-3 py-3 font-medium" style={{ color: net >= 0 ? "#16a34a" : "#dc2626" }}>
                        {fmtUSD(net)}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={marg >= 20 ? "green" : marg >= 10 ? "yellow" : "red"}>{marg}%</Badge>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{roas}×</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <ProgressBar value={m.delivRate} color={m.delivRate >= 65 ? "#1d9e75" : m.delivRate >= 55 ? "#ef9f27" : "#e24b4a"} className="w-14" />
                          <span className={m.delivRate >= 65 ? "text-emerald-600" : m.delivRate >= 55 ? "text-amber-600" : "text-red-600"}>{m.delivRate}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={m.rto <= 12 ? "green" : m.rto <= 17 ? "yellow" : "red"}>{m.rto}%</Badge>
                      </td>
                      <td className="px-3 py-3"><DecisionPill decision={m.decision} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ROAS creatives + Funnel */}
        <div className="grid grid-cols-2 gap-4">
          <Section
            title="ROAS net vs ROAS Meta brute · par créa"
            titleRight={
              <span className="text-[10px] text-slate-500">Écart &gt; 50% = créa trompeuse</span>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    {["Créa", "Spend", "Livr.", "ROAS net", "ROAS Meta", "Écart"].map((h) => (
                      <th key={h} className="text-left px-2 py-2 text-slate-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CREATIVES.map((c) => {
                    const ecart = Math.round(((c.roasMeta - c.roasNet) / c.roasNet) * 100);
                    return (
                      <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="px-2 py-2.5 max-w-[130px] truncate text-slate-700" title={c.name}>{c.name}</td>
                        <td className="px-2 py-2.5 text-slate-500">${c.spend}</td>
                        <td className="px-2 py-2.5 text-slate-500">{c.deliveries}</td>
                        <td className="px-2 py-2.5 font-semibold text-emerald-600">{c.roasNet}×</td>
                        <td className="px-2 py-2.5 text-slate-500">{c.roasMeta}×</td>
                        <td className="px-2 py-2.5">
                          <Badge variant={ecart > 80 ? "red" : ecart > 40 ? "yellow" : "green"}>+{ecart}%</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Funnel COD · Angola">
            <div className="flex gap-2 mb-5">
              {[
                { label: "Leads", value: 847, color: "#378add" },
                { label: "Confirmés", value: 492, color: "#1d9e75" },
                { label: "Livrés", value: 349, color: "#c9a227" },
                { label: "Encaissés", value: 318, color: "#3b6d11" },
              ].map((step, i, arr) => (
                <div key={step.label} className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-50 rounded-lg p-3 border-t-2 min-w-[72px]" style={{ borderColor: step.color }}>
                    <p className="text-[9px] text-slate-500 mb-1">{step.label}</p>
                    <p className="text-lg font-semibold" style={{ color: step.color }}>{step.value}</p>
                  </div>
                  {i < arr.length - 1 && <span className="text-slate-400 text-sm">›</span>}
                </div>
              ))}
            </div>

            <div className="space-y-3">
              {[
                { label: "Taux confirmation", value: 58, color: "#378add", threshold: 55 },
                { label: "Taux livraison effectif", value: 71, color: "#1d9e75", threshold: 65 },
                { label: "Taux encaissement", value: 91, color: "#c9a227", threshold: 85 },
                { label: "RTO / retours", value: 11, color: "#e24b4a", threshold: 15, inverse: true },
              ].map(({ label, value, color, threshold, inverse }) => (
                <div key={label}>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-slate-500">{label}</span>
                    <span className="text-xs font-medium" style={{ color }}>
                      {value}%
                      {inverse ? value <= threshold ? " ✓" : " ⚠" : value >= threshold ? " ✓" : " ⚠"}
                    </span>
                  </div>
                  <ProgressBar value={value} color={color} />
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* Decision table */}
        <Section
          title="Tableau de décision · aujourd'hui"
          titleRight={<span className="text-[10px] text-slate-500">PPDO = Profit per Delivered Order</span>}
        >
          <div className="grid grid-cols-4 gap-3">
            {sorted.map((m) => {
              const net = calcNetMargin(m);
              const marg = calcMarginPct(m);
              return (
                <div key={m.code} className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm">{m.flag} <span className="font-medium text-slate-900">{m.name.split(" ")[0]}</span></span>
                    <DecisionPill decision={m.decision} />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">PPDO</span>
                      <span className="font-medium" style={{ color: m.ppdo >= 10 ? "#16a34a" : m.ppdo >= 5 ? "#ea580c" : "#dc2626" }}>${m.ppdo}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Marge</span>
                      <span className="font-medium" style={{ color: marg >= 15 ? "#16a34a" : marg >= 5 ? "#ea580c" : "#dc2626" }}>{marg}%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Break-even/jour</span>
                      <span className="text-slate-700">{m.breakEven} livr.</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Net 30j</span>
                      <span className="font-medium text-slate-900">{fmtUSD(net)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* PPDO bar chart */}
        <Section title="PPDO comparé · tous marchés" titleRight={<span className="text-[10px] text-slate-500">Break-even ligne rouge pointillée</span>}>
          <div className="space-y-2.5">
            {sorted.map((m) => (
              <div key={m.code} className="flex items-center gap-3">
                <span className="text-xs text-slate-500 w-28 shrink-0">{m.flag} {m.name}</span>
                <div className="flex-1 relative h-5">
                  <div className="absolute inset-y-0 left-0 h-full bg-slate-100 rounded-full w-full" />
                  <div
                    className="absolute inset-y-0 left-0 h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min((m.ppdo / 25) * 100, 100)}%`,
                      background: m.ppdo >= 10 ? "#1d9e75" : m.ppdo >= 5 ? "#ef9f27" : "#e24b4a",
                    }}
                  />
                  {/* break-even marker */}
                  <div
                    className="absolute top-0 bottom-0 w-px bg-red-500/50"
                    style={{ left: `${Math.min((m.breakEven / 25) * 100, 100)}%` }}
                  />
                </div>
                <span className="text-xs font-medium w-10 text-right" style={{ color: m.ppdo >= 10 ? "#16a34a" : m.ppdo >= 5 ? "#ea580c" : "#dc2626" }}>
                  ${m.ppdo}
                </span>
                <BarChart2 size={12} className="text-slate-400" />
              </div>
            ))}
          </div>
        </Section>

      </div>
    </div>
  );
}
