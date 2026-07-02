"use client";
import Topbar from "@/components/layout/Topbar";
import { Section, KpiCard, ProgressBar } from "@/components/ui";
import CashFlowChart from "@/components/charts/CashFlowChart";
import SpendChart from "@/components/charts/SpendChart";
import ProjectionChart from "@/components/charts/ProjectionChart";
import { MARKETS, fmtUSD, calcNetMargin } from "@/lib/data";
import {
  ArrowDownCircle, ArrowUpCircle, DollarSign,
  TrendingUp, Users, ShoppingBag, Truck, RotateCcw,
  Clock, Flame
} from "lucide-react";

export default function TresoreriePage() {
  const mkts = MARKETS;

  const totalIn = mkts.reduce((a, m) => a + m.rev, 0);
  const totalOut = mkts.reduce((a, m) => a + (m.adSpend + m.cogs + m.callCenter + m.logistics), 0);
  const net = totalIn - totalOut;

  const avgCPL = (mkts.reduce((a, m) => a + m.cpl, 0) / mkts.length).toFixed(2);
  const avgDeliv = Math.round(mkts.reduce((a, m) => a + m.delivRate, 0) / mkts.length);
  const totalRev = mkts.reduce((a, m) => a + m.rev, 0);
  const totalSpend = mkts.reduce((a, m) => a + m.adSpend, 0);
  const roas = (totalRev / totalSpend).toFixed(1);
  const avgRTO = Math.round(mkts.reduce((a, m) => a + m.rto, 0) / mkts.length);
  const totalLeads = Math.round(totalSpend / parseFloat(avgCPL));
  const totalNet = mkts.reduce((a, m) => a + calcNetMargin(m), 0);

  return (
    <div>
      <Topbar
        title="Trésorerie"
        subtitle="Combien rentre, combien sort, combien reste — aujourd'hui"
      />

      <div className="px-6 py-5 space-y-5">

        {/* Cash hero */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl p-5 border" style={{ background: "#ecfdf5", borderColor: "#1d9e75" }}>
            <div className="flex items-center gap-2 mb-3">
              <ArrowDownCircle size={16} className="text-emerald-600" />
              <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">Cash IN</span>
            </div>
            <p className="text-3xl font-semibold text-emerald-700">{fmtUSD(totalIn)}</p>
            <p className="text-xs text-emerald-600 mt-1.5">Encaissements COD effectifs</p>
            <div className="mt-3 flex items-center gap-1 text-xs text-emerald-600">
              <TrendingUp size={11} />
              <span>+18% vs semaine précédente</span>
            </div>
          </div>

          <div className="rounded-xl p-5 border" style={{ background: "#fef2f2", borderColor: "#e24b4a" }}>
            <div className="flex items-center gap-2 mb-3">
              <ArrowUpCircle size={16} className="text-red-600" />
              <span className="text-xs font-semibold text-red-600 uppercase tracking-wide">Cash OUT</span>
            </div>
            <p className="text-3xl font-semibold text-red-700">{fmtUSD(totalOut)}</p>
            <p className="text-xs text-red-600 mt-1.5">Ads + COGS + logistique + CC</p>
            <div className="mt-3 flex items-center gap-1 text-xs text-red-600">
              <Flame size={11} />
              <span>Burn ads/jour · {fmtUSD(mkts.reduce((a, m) => a + m.adSpend, 0) / 30)}</span>
            </div>
          </div>

          <div className="rounded-xl p-5 border" style={{ background: "#eff6ff", borderColor: "#378add" }}>
            <div className="flex items-center gap-2 mb-3">
              <DollarSign size={16} className="text-blue-600" />
              <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Cash Net</span>
            </div>
            <p className="text-3xl font-semibold" style={{ color: net >= 0 ? "#2563eb" : "#dc2626" }}>
              {fmtUSD(net)}
            </p>
            <p className="text-xs text-blue-700 mt-1.5">Marge nette après tous les coûts</p>
            <div className="mt-3 flex items-center gap-1 text-xs text-blue-600">
              <Clock size={11} />
              <span>Runway estimé · 47 jours</span>
            </div>
          </div>
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-2 gap-4">
          <Section title="Cash IN / OUT · 7 derniers jours">
            <CashFlowChart />
            <div className="flex items-center gap-4 mt-2">
              {[
                { color: "#1d9e75", label: "Cash IN" },
                { color: "#e24b4a", label: "Cash OUT" },
                { color: "#c9a227", label: "Net" },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
                  <span className="text-[10px] text-slate-500">{label}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Répartition Cash OUT">
            <SpendChart />
          </Section>
        </div>

        {/* KPIs strip */}
        <Section title="KPIs clés">
          <div className="grid grid-cols-6 gap-3">
            <KpiCard
              label="Leads"
              value={totalLeads.toLocaleString()}
              delta="↑ +12% vs préc."
              deltaUp
              icon={<Users size={14} />}
            />
            <KpiCard
              label="CPL moyen"
              value={`$${avgCPL}`}
              delta="↓ −8% vs préc."
              deltaUp
              icon={<DollarSign size={14} />}
            />
            <KpiCard
              label="Delivery rate"
              value={`${avgDeliv}%`}
              delta={avgDeliv >= 65 ? "Dans les seuils" : "⚠ Seuil ≥65%"}
              deltaUp={avgDeliv >= 65}
              icon={<Truck size={14} />}
            />
            <KpiCard
              label="ROAS net"
              value={`${roas}×`}
              delta="↑ +0.4× vs préc."
              deltaUp
              icon={<TrendingUp size={14} />}
            />
            <KpiCard
              label="RTO moyen"
              value={`${avgRTO}%`}
              delta={avgRTO <= 12 ? "Dans les seuils" : "⚠ Au-dessus seuil"}
              deltaUp={avgRTO <= 12}
              icon={<RotateCcw size={14} />}
            />
            <KpiCard
              label="AOV moyen"
              value="$38"
              delta="↑ +5% vs préc."
              deltaUp
              icon={<ShoppingBag size={14} />}
            />
          </div>
        </Section>

        {/* Runway */}
        <div className="grid grid-cols-3 gap-4">
          <Section className="col-span-2" title="Projection cashflow · 14 prochains jours">
            <ProjectionChart />
            <div className="flex items-center gap-4 mt-2">
              {[
                { color: "#1d9e75", label: "Cash IN projeté", dash: false },
                { color: "#e24b4a", label: "Burn projeté", dash: true },
              ].map(({ color, label, dash }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="w-4 h-0.5" style={{ background: color, borderTop: dash ? "1px dashed" : "none" }} />
                  <span className="text-[10px] text-slate-500">{label}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Indicateurs de survie">
            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs text-slate-500">Runway</span>
                  <span className="text-sm font-semibold text-blue-600">47 jours</span>
                </div>
                <ProgressBar value={47} max={90} color="#378add" />
                <p className="text-[10px] text-slate-400 mt-1">Alerte si ≤ 30 jours</p>
              </div>
              <div className="pt-1 border-t border-slate-200">
                <div className="flex justify-between py-1.5">
                  <span className="text-xs text-slate-500">Trésorerie dispo</span>
                  <span className="text-xs font-medium text-slate-900">$12,450</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-xs text-slate-500">Burn ads/jour</span>
                  <span className="text-xs font-medium text-red-600">$265</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-xs text-slate-500">Engagements 14j</span>
                  <span className="text-xs font-medium text-amber-600">$3,710</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-xs text-slate-500">Pipeline non encaissé</span>
                  <span className="text-xs font-medium text-emerald-600">$8,240</span>
                </div>
                <div className="flex justify-between py-1.5 border-t border-slate-200 mt-1">
                  <span className="text-xs text-slate-500">Marge nette période</span>
                  <span className="text-xs font-semibold text-slate-900">{fmtUSD(totalNet)}</span>
                </div>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
