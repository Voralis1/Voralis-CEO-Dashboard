"use client";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge, ProgressBar, KpiCard } from "@/components/ui";
import { MOTOBOYS, AGENTS } from "@/lib/data";
import { Bike, Headphones, AlertTriangle, CheckCircle, Coffee, Clock } from "lucide-react";

export default function TeamPage() {
  const avgCashRatio = Math.round(MOTOBOYS.reduce((a, m) => a + m.cashRemitted / m.cashExpected * 100, 0) / MOTOBOYS.length);
  const totalDeliveries = MOTOBOYS.reduce((a, m) => a + m.deliveries, 0);
  const totalCash = MOTOBOYS.reduce((a, m) => a + m.cashRemitted, 0);
  const avgConfirm = Math.round(AGENTS.reduce((a, ag) => a + ag.confirmRate, 0) / AGENTS.length);

  const statusIcon = { online: CheckCircle, offline: Clock, break: Coffee };
  const statusColor = { online: "text-emerald-600", offline: "text-slate-500", break: "text-amber-600" };
  const statusLabel = { online: "En ligne", offline: "Hors ligne", break: "Pause" };

  return (
    <div>
      <Topbar title="Équipe" subtitle="Motoboys Angola, agents call center, indicateurs individuels" />

      <div className="px-6 py-5 space-y-5">

        {/* Summary KPIs */}
        <div className="grid grid-cols-4 gap-4">
          <KpiCard label="Livraisons aujourd'hui" value={totalDeliveries.toString()} delta="4 motoboys actifs" deltaUp icon={<Bike size={14} />} />
          <KpiCard label="Cash remis aujourd'hui" value={`$${totalCash.toLocaleString()}`} delta={`Ratio moy. ${avgCashRatio}%`} deltaUp={avgCashRatio >= 85} />
          <KpiCard label="Agents call center" value={AGENTS.length.toString()} delta={`Confirmation moy. ${avgConfirm}%`} deltaUp={avgConfirm >= 60} icon={<Headphones size={14} />} />
          <KpiCard label="Trésorerie disponible" value="$12,450" delta="Runway 47 jours" deltaUp />
        </div>

        {/* Motoboys */}
        <Section title="Motoboys Angola · performances du jour">
          <div className="grid grid-cols-2 gap-4">
            {MOTOBOYS.map((m) => {
              const ratio = Math.round((m.cashRemitted / m.cashExpected) * 100);
              const ok = ratio >= 85;
              const delivOk = m.deliveries / m.totalCourses >= 0.85;
              return (
                <div key={m.id} className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-sm font-semibold text-slate-700">
                        {m.name.split(" ").map((w) => w[0]).join("")}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{m.name}</p>
                        <p className="text-xs text-slate-500">Motoboy · Angola</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="text-xs text-slate-500">{m.lastSeen}</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-500">Livraisons</span>
                        <span className={delivOk ? "text-emerald-600" : "text-amber-600"}>
                          {m.deliveries}/{m.totalCourses} courses
                        </span>
                      </div>
                      <ProgressBar value={m.deliveries} max={m.totalCourses} color={delivOk ? "#1d9e75" : "#ef9f27"} />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-500">Cash remis / attendu</span>
                        <span className={ok ? "text-emerald-600 font-medium" : "text-red-600 font-semibold"}>
                          {ratio}%
                        </span>
                      </div>
                      <ProgressBar value={ratio} color={ok ? "#1d9e75" : "#e24b4a"} />
                    </div>

                    <div className="flex justify-between text-xs pt-1 border-t border-slate-200">
                      <span className="text-slate-500">Cash remis</span>
                      <span className={ok ? "font-medium text-slate-900" : "font-semibold text-red-600"}>
                        ${m.cashRemitted.toLocaleString()} / ${m.cashExpected.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {!ok && (
                    <div className="mt-3 flex items-center gap-2 p-2 rounded-lg bg-red-50 border border-red-200">
                      <AlertTriangle size={12} className="text-red-600" />
                      <p className="text-[10px] text-red-600">Ratio cash sous la moyenne — audit requis</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        {/* Agents */}
        <Section title="Agents call center · LeadVertex">
          <div className="grid grid-cols-3 gap-4">
            {AGENTS.map((ag) => {
              const Icon = statusIcon[ag.onlineStatus];
              const color = statusColor[ag.onlineStatus];
              const label = statusLabel[ag.onlineStatus];
              const ok = ag.confirmRate >= 60;
              return (
                <div key={ag.id} className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-sm font-semibold text-slate-700">
                        {ag.name.split(" ").map((w) => w[0]).join("")}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{ag.name}</p>
                        <p className="text-xs text-slate-500">Call center</p>
                      </div>
                    </div>
                    <div className={`flex items-center gap-1 ${color}`}>
                      <Icon size={11} />
                      <span className="text-[10px]">{label}</span>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Leads traités</span>
                      <span className="text-slate-900 font-medium">{ag.leadsHandled}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Confirmations</span>
                      <span className="text-slate-900">{ag.confirmed}</span>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-500">Taux confirmation</span>
                        <span className={ok ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>{ag.confirmRate}%</span>
                      </div>
                      <ProgressBar value={ag.confirmRate} color={ok ? "#1d9e75" : "#ef9f27"} />
                      <p className="text-[9px] text-slate-400 mt-0.5">Seuil min. 60%</p>
                    </div>

                    <div className="flex justify-between text-xs pt-1 border-t border-slate-200">
                      <span className="text-slate-500">Durée moy. appel</span>
                      <span className="text-slate-700">{ag.avgCallDuration}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* Reconciliation Angola */}
        <Section
          title="Réconciliation cash Angola · aujourd'hui"
          titleRight={<Badge variant="yellow">Audit manuel requis</Badge>}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Motoboy", "Courses", "Livraisons", "Cash attendu", "Cash remis", "Ratio", "Écart", "Statut"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MOTOBOYS.map((m) => {
                  const ratio = Math.round((m.cashRemitted / m.cashExpected) * 100);
                  const ecart = m.cashExpected - m.cashRemitted;
                  const ok = ratio >= 85;
                  return (
                    <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-3 font-medium text-slate-900">{m.name}</td>
                      <td className="px-3 py-3 text-slate-500">{m.totalCourses}</td>
                      <td className="px-3 py-3 text-slate-500">{m.deliveries}</td>
                      <td className="px-3 py-3 text-slate-700">${m.cashExpected.toLocaleString()}</td>
                      <td className="px-3 py-3 font-medium" style={{ color: ok ? "#16a34a" : "#dc2626" }}>
                        ${m.cashRemitted.toLocaleString()}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={ok ? "green" : "red"}>{ratio}%</Badge>
                      </td>
                      <td className="px-3 py-3" style={{ color: ecart === 0 ? "#64748b" : "#dc2626" }}>
                        {ecart > 0 ? `-$${ecart.toLocaleString()}` : "—"}
                      </td>
                      <td className="px-3 py-3">
                        {ok
                          ? <span className="flex items-center gap-1 text-emerald-600"><CheckCircle size={11} /> OK</span>
                          : <span className="flex items-center gap-1 text-red-600"><AlertTriangle size={11} /> Audit</span>}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-50">
                  <td className="px-3 py-3 font-semibold text-slate-900">TOTAL</td>
                  <td className="px-3 py-3 text-slate-900">{MOTOBOYS.reduce((a, m) => a + m.totalCourses, 0)}</td>
                  <td className="px-3 py-3 text-slate-900">{totalDeliveries}</td>
                  <td className="px-3 py-3 text-slate-900">${MOTOBOYS.reduce((a, m) => a + m.cashExpected, 0).toLocaleString()}</td>
                  <td className="px-3 py-3 font-semibold text-emerald-600">${totalCash.toLocaleString()}</td>
                  <td className="px-3 py-3"><Badge variant={avgCashRatio >= 85 ? "green" : "red"}>{avgCashRatio}%</Badge></td>
                  <td className="px-3 py-3 text-red-600">
                    -${(MOTOBOYS.reduce((a, m) => a + m.cashExpected, 0) - totalCash).toLocaleString()}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}
