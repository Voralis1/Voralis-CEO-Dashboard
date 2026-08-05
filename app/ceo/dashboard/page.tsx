"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import { fetchAffiliatesData, type AffiliateRow } from "@/lib/affiliates";
import { AlertTriangle, Loader2, Trophy } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";

// Couleurs : palette catégorielle validée (skill dataviz), slots 1/3/2 dans l'ordre fixe —
// jamais recyclées, jamais réordonnées selon les données. Une seule teinte par graphique (une
// seule série à la fois ici), donc pas de risque de collision CVD entre séries adjacentes.
const COLOR_CA = "#2a78d6"; // slot 1 (bleu)
const COLOR_MARGE = "#1baf7a"; // slot 3 (aqua)
const COLOR_LIVRES = "#eb6834"; // slot 2 (orange)

interface DailyPoint {
  date: string;
  caLivreUsd: number;
  livres: number;
  margeSimplifieeUsd: number;
}

interface CountryPoint {
  country: string;
  caLivreUsd: number;
  livres: number;
}

interface TimeseriesData {
  daily: DailyPoint[];
  byCountry: CountryPoint[];
}

function fmtUsd(value: number): string {
  return `$${Math.round(value).toLocaleString("fr-FR")}`;
}

function fmtDateShort(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function ChartCard({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <Section title={title}>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
        <span className="text-[11px] text-slate-500">Période sélectionnée</span>
      </div>
      <div className="h-45">{children}</div>
    </Section>
  );
}

const PODIUM_STYLE = [
  { place: "🥇", height: "h-24", bg: "bg-amber-50 border-amber-200" },
  { place: "🥈", height: "h-16", bg: "bg-slate-50 border-slate-200" },
  { place: "🥉", height: "h-12", bg: "bg-orange-50 border-orange-200" },
];

export default function DashboardOverviewPage() {
  const { dateFrom, dateTo } = useFilters();
  const [ts, setTs] = useState<TimeseriesData | null>(null);
  const [affiliates, setAffiliates] = useState<AffiliateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [tsRes, affData] = await Promise.all([
          fetch(`/api/dashboard/timeseries?dateFrom=${dateFrom}&dateTo=${dateTo}`),
          fetchAffiliatesData(dateFrom, dateTo),
        ]);
        const tsJson = await tsRes.json();
        if (!tsRes.ok) throw new Error(tsJson.error ?? "Erreur inconnue");
        if (!cancelled) {
          setTs(tsJson);
          setAffiliates(affData.affiliates);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erreur inconnue");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo]);

  const topAffiliates = [...affiliates]
    .filter((a) => a.margeNetteUsd != null)
    .sort((a, b) => (b.margeNetteUsd as number) - (a.margeNetteUsd as number))
    .slice(0, 5);
  const podium = topAffiliates.slice(0, 3);
  const runnerUps = topAffiliates.slice(3, 5);
  // Ordre visuel du podium : 2e / 1er / 3e (le 1er au centre, plus haut).
  const podiumOrder = podium.length === 3 ? [podium[1], podium[0], podium[2]] : podium;

  if (error) {
    return (
      <div>
        <Topbar title="Tableau de bord" subtitle="Vue d'ensemble — évolution, comparaisons par pays, meilleurs affiliés" />
        <div className="px-6 py-5">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
            <AlertTriangle size={14} />
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (loading || !ts) {
    return (
      <div>
        <Topbar title="Tableau de bord" subtitle="Vue d'ensemble — évolution, comparaisons par pays, meilleurs affiliés" />
        <div className="px-6 flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Calcul en cours…</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Topbar title="Tableau de bord" subtitle="Vue d'ensemble — évolution, comparaisons par pays, meilleurs affiliés" />

      <div className="px-6 py-5 space-y-5">
        {/* ═══ Courbes d'évolution ═══ */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ChartCard title="CA livré encaissé (USD)" color={COLOR_CA}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ts.daily} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="0" stroke="#e1e0d9" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDateShort} tick={{ fontSize: 10, fill: "#898781" }} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 10, fill: "#898781" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtUsd(v)} width={56} />
                <Tooltip formatter={(v) => fmtUsd(Number(v))} labelFormatter={(l) => l} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e1e0d9" }} />
                <Line type="monotone" dataKey="caLivreUsd" stroke={COLOR_CA} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Marge simplifiée (USD)" color={COLOR_MARGE}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ts.daily} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="0" stroke="#e1e0d9" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDateShort} tick={{ fontSize: 10, fill: "#898781" }} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 10, fill: "#898781" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtUsd(v)} width={56} />
                <Tooltip formatter={(v) => fmtUsd(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e1e0d9" }} />
                <Line type="monotone" dataKey="margeSimplifieeUsd" stroke={COLOR_MARGE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Commandes livrées" color={COLOR_LIVRES}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ts.daily} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="0" stroke="#e1e0d9" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDateShort} tick={{ fontSize: 10, fill: "#898781" }} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 10, fill: "#898781" }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e1e0d9" }} />
                <Line type="monotone" dataKey="livres" stroke={COLOR_LIVRES} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
        <p className="text-[11px] text-slate-400 -mt-3">
          Marge simplifiée = CA livré encaissé − dépense pub Meta Ads uniquement (hors COGS et payout affiliés,
          hors coût réel Field Cash Angola) — vue d&apos;ensemble rapide, pas un remplacement du détail précis
          par pays disponible sur Rentabilité.
        </p>

        {/* ═══ Comparaison par pays ═══ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Section title="CA livré encaissé par pays (USD)">
            <div className="h-65">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ts.byCountry} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="0" stroke="#e1e0d9" vertical={false} />
                  <XAxis dataKey="country" tick={{ fontSize: 10, fill: "#898781" }} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} interval={0} angle={-25} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10, fill: "#898781" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtUsd(v)} width={56} />
                  <Tooltip formatter={(v) => fmtUsd(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e1e0d9" }} cursor={{ fill: "rgba(42,120,214,0.06)" }} />
                  <Bar dataKey="caLivreUsd" fill={COLOR_CA} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>

          <Section title="Commandes livrées par pays">
            <div className="h-65">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ts.byCountry} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="0" stroke="#e1e0d9" vertical={false} />
                  <XAxis dataKey="country" tick={{ fontSize: 10, fill: "#898781" }} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} interval={0} angle={-25} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10, fill: "#898781" }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e1e0d9" }} cursor={{ fill: "rgba(235,104,52,0.06)" }} />
                  <Bar dataKey="livres" fill={COLOR_LIVRES} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
        </div>

        {/* ═══ Podium affiliés ═══ */}
        <Section
          title="Meilleurs affiliés"
          titleRight={
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <Trophy size={12} /> classé sur la rentabilité nette (USD)
            </span>
          }
        >
          {podium.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">Aucun affilié avec une rentabilité nette calculable sur cette période.</p>
          ) : (
            <>
              <div className="flex items-end justify-center gap-4 pt-2 pb-4">
                {podiumOrder.map((a, i) => {
                  const style = i === 1 ? PODIUM_STYLE[0] : i === 0 ? PODIUM_STYLE[1] : PODIUM_STYLE[2];
                  return (
                    <div key={a.id} className="flex flex-col items-center w-28">
                      <span className="text-2xl mb-1">{style.place}</span>
                      <p className="text-xs font-semibold text-slate-900 truncate max-w-full">{a.name}</p>
                      <p className="text-[10px] text-slate-500 mb-1 truncate max-w-full">{a.networkName}</p>
                      <p className="text-sm font-bold" style={{ color: COLOR_MARGE }}>
                        {fmtUsd(a.margeNetteUsd as number)}
                      </p>
                      <div className={`w-full ${style.height} ${style.bg} border rounded-t-lg mt-2`} />
                    </div>
                  );
                })}
              </div>
              {runnerUps.length > 0 && (
                <div className="border-t border-slate-100 pt-3 space-y-1.5">
                  {runnerUps.map((a, i) => (
                    <div key={a.id} className="flex items-center justify-between text-xs px-2">
                      <span className="text-slate-500">
                        {i + 4}. <span className="text-slate-900 font-medium">{a.name}</span>{" "}
                        <span className="text-slate-400">({a.networkName})</span>
                      </span>
                      <span className="font-semibold" style={{ color: COLOR_MARGE }}>
                        {fmtUsd(a.margeNetteUsd as number)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
