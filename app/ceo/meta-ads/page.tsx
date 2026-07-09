"use client";
import { useEffect, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section, Badge } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import {
  fetchMetaAdsByCountry,
  MetaAdsCountryRow,
  fetchMetaAdsByAccount,
  MetaAdsAccountRow,
  diagnoseSupabaseConnection,
} from "@/lib/supabase/queries";
import { fmtUSD } from "@/lib/data";
import { COUNTRY_FLAGS } from "@/lib/countries";

interface ProcessedMetaAdsData {
  country: string;
  flag: string;
  clicks: number;
  spend: number;
  impressions: number;
  leads: number;
  cpl: number;
  ctr: number;
}

interface ProcessedMetaAdsAccountData {
  accountId: string;
  label: string;
  clicks: number;
  spend: number;
  impressions: number;
  leads: number;
  cpl: number;
  ctr: number;
}

export default function MetaAdsPage() {
  const { dateFrom, dateTo } = useFilters();
  const [data, setData] = useState<ProcessedMetaAdsData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [accountData, setAccountData] = useState<ProcessedMetaAdsAccountData[]>([]);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);

  // Run diagnosis once on mount
  useEffect(() => {
    diagnoseSupabaseConnection();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        console.log(`Fetching meta ads from ${dateFrom} to ${dateTo}`);

        const rawData = await fetchMetaAdsByCountry(dateFrom, dateTo);
        console.log("Raw data from Supabase:", rawData);

        if (!rawData || rawData.length === 0) {
          console.warn("No data returned from Supabase");
          setData([]);
          return;
        }

        // Aggregate data by country
        const aggregatedByCountry: Record<string, ProcessedMetaAdsData> = {};

        rawData.forEach((row: MetaAdsCountryRow) => {
          if (!aggregatedByCountry[row.country]) {
            aggregatedByCountry[row.country] = {
              country: row.country,
              flag: COUNTRY_FLAGS[row.country] || "🌍",
              clicks: 0,
              spend: 0,
              impressions: 0,
              leads: 0,
              cpl: 0,
              ctr: 0,
            };
          }
          aggregatedByCountry[row.country].clicks += row.clicks || 0;
          aggregatedByCountry[row.country].spend += row.spend || 0;
          aggregatedByCountry[row.country].impressions += row.impressions || 0;
          aggregatedByCountry[row.country].leads += row.leads || 0;
        });

        // Calculate CPL and CTR after aggregation
        const processed = Object.values(aggregatedByCountry).map((item: ProcessedMetaAdsData) => ({
          country: item.country,
          flag: item.flag,
          clicks: item.clicks,
          spend: item.spend,
          impressions: item.impressions,
          leads: item.leads,
          cpl: item.leads > 0 ? item.spend / item.leads : 0,
          ctr: item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0,
        }));

        console.log("Processed data:", processed);
        setData(processed);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.error("Failed to fetch meta ads data:", errorMessage);
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [dateFrom, dateTo]);

  // Meta Ads par compte publicitaire (meta_ads_by_account) — chargement séparé du tableau par
  // pays ci-dessus : une erreur ou une absence de données ici n'affecte jamais l'affichage déjà
  // existant par pays.
  useEffect(() => {
    const fetchAccountData = async () => {
      setAccountLoading(true);
      setAccountError(null);
      try {
        const rawData = await fetchMetaAdsByAccount(dateFrom, dateTo);

        const aggregatedByAccount: Record<string, ProcessedMetaAdsAccountData> = {};

        rawData.forEach((row: MetaAdsAccountRow) => {
          if (!aggregatedByAccount[row.account_id]) {
            aggregatedByAccount[row.account_id] = {
              accountId: row.account_id,
              label: row.account_name || row.account_id,
              clicks: 0,
              spend: 0,
              impressions: 0,
              leads: 0,
              cpl: 0,
              ctr: 0,
            };
          }
          aggregatedByAccount[row.account_id].clicks += row.clicks || 0;
          aggregatedByAccount[row.account_id].spend += row.spend || 0;
          aggregatedByAccount[row.account_id].impressions += row.impressions || 0;
          aggregatedByAccount[row.account_id].leads += row.leads || 0;
        });

        const processed = Object.values(aggregatedByAccount).map((item) => ({
          ...item,
          cpl: item.leads > 0 ? item.spend / item.leads : 0,
          ctr: item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0,
        }));

        setAccountData(processed);
      } catch (err) {
        setAccountError(err instanceof Error ? err.message : "Erreur inconnue");
      } finally {
        setAccountLoading(false);
      }
    };

    fetchAccountData();
  }, [dateFrom, dateTo]);

  if (loading) {
    return (
      <div>
        <Topbar title="Media Buying Interne" subtitle="Dépense Meta Ads par pays — clicks, spend, impressions, leads, filtrable par période" />
        <div className="px-6 py-5">
          <div className="text-slate-500">Chargement des données...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Topbar title="Media Buying Interne" subtitle="Dépense Meta Ads par pays — clicks, spend, impressions, leads, filtrable par période" />
        <div className="px-6 py-5">
          <div className="text-red-600">Erreur: {error}</div>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div>
        <Topbar title="Media Buying Interne" subtitle="Dépense Meta Ads par pays — clicks, spend, impressions, leads, filtrable par période" />
        <div className="px-6 py-5">
          <div className="text-slate-500">Aucune donnée disponible pour cette période</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Topbar title="Media Buying Interne" subtitle="Dépense Meta Ads par pays — clicks, spend, impressions, leads, filtrable par période" />

      <div className="px-6 py-5 space-y-5">
        {/* Meta Ads Stats Table */}
        <Section title="Performance Meta Ads par pays">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  {["Pays", "Clicks", "Spend", "Impressions", "Leads", "CPL", "CTR"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.country} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-medium text-slate-900">
                        <span className="text-base">{d.flag}</span>
                        {d.country}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{Math.round(d.clicks).toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3 text-slate-700">{fmtUSD(d.spend)}</td>
                    <td className="px-3 py-3 text-slate-700">{Math.round(d.impressions).toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3 font-semibold text-emerald-600">{Math.round(d.leads).toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-3 text-slate-700">${d.cpl.toFixed(2)}</td>
                    <td className="px-3 py-3">
                      <Badge variant={d.ctr >= 6.5 ? "green" : d.ctr >= 5 ? "yellow" : "red"}>
                        {d.ctr.toFixed(2)}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Meta Ads par compte publicitaire */}
        <Section title="Performance Meta Ads par compte publicitaire">
          {accountLoading ? (
            <div className="text-slate-500 text-xs py-4">Chargement des données par compte…</div>
          ) : accountError ? (
            <div className="text-red-600 text-xs py-2">Erreur : {accountError}</div>
          ) : accountData.length === 0 ? (
            <div className="text-slate-500 text-xs py-4">Aucune donnée par compte publicitaire pour cette période.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    {["Compte", "Clicks", "Spend", "Impressions", "Leads", "CPL", "CTR"].map((h) => (
                      <th key={h} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {accountData.map((d) => (
                    <tr key={d.accountId} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3 font-medium text-slate-900">{d.label}</td>
                      <td className="px-3 py-3 text-slate-700">{Math.round(d.clicks).toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-3 text-slate-700">{fmtUSD(d.spend)}</td>
                      <td className="px-3 py-3 text-slate-700">{Math.round(d.impressions).toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-3 font-semibold text-emerald-600">{Math.round(d.leads).toLocaleString("fr-FR")}</td>
                      <td className="px-3 py-3 text-slate-700">${d.cpl.toFixed(2)}</td>
                      <td className="px-3 py-3">
                        <Badge variant={d.ctr >= 6.5 ? "green" : d.ctr >= 5 ? "yellow" : "red"}>
                          {d.ctr.toFixed(2)}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Section title="Total Clicks">
            <p className="text-3xl font-bold text-slate-900 mt-2">
              {Math.round(data.reduce((sum, d) => sum + d.clicks, 0)).toLocaleString("fr-FR")}
            </p>
          </Section>
          <Section title="Total Spend">
            <p className="text-3xl font-bold text-slate-900 mt-2">
              {fmtUSD(data.reduce((sum, d) => sum + d.spend, 0))}
            </p>
          </Section>
          <Section title="Total Impressions">
            <p className="text-3xl font-bold text-slate-900 mt-2">
              {Math.round(data.reduce((sum, d) => sum + d.impressions, 0)).toLocaleString("fr-FR")}
            </p>
          </Section>
          <Section title="Total Leads">
            <p className="text-3xl font-bold text-emerald-600 mt-2">
              {Math.round(data.reduce((sum, d) => sum + d.leads, 0)).toLocaleString("fr-FR")}
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
