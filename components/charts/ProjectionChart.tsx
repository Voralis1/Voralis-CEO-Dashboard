"use client";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { CASHFLOW_14D } from "@/lib/data";

const fmt = (v: number) => `$${Math.round(v / 1000)}k`;

export default function ProjectionChart() {
  return (
    <ResponsiveContainer width="100%" height={140}>
      <AreaChart data={CASHFLOW_14D} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#1d9e75" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#1d9e75" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="burnGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#e24b4a" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#e24b4a" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="day" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={fmt} />
        <Tooltip
          contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: "#475569" }}
          formatter={(v) => [`$${Math.round(Number(v ?? 0)).toLocaleString()}`, ""]}
        />
        <Area type="monotone" dataKey="projected" name="Cash IN projeté" stroke="#1d9e75" fill="url(#projGrad)" strokeWidth={2} dot={false} />
        <Area type="monotone" dataKey="burn" name="Burn (ads+charges)" stroke="#e24b4a" fill="url(#burnGrad)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
