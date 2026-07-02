"use client";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { CASH_7D } from "@/lib/data";

const fmt = (v: number) => `$${Math.round(v / 1000)}k`;

export default function CashFlowChart() {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={CASH_7D} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="day" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmt} />
        <Tooltip
          contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: "#475569" }}
          formatter={(v) => [`$${Math.round(Number(v ?? 0)).toLocaleString()}`, ""]}
        />
        <Bar dataKey="cashIn" name="Cash IN" fill="#1d9e75" radius={[3, 3, 0, 0]} opacity={0.85} />
        <Bar dataKey="cashOut" name="Cash OUT" fill="#e24b4a" radius={[3, 3, 0, 0]} opacity={0.7} />
        <Line dataKey="net" name="Net" stroke="#c9a227" strokeWidth={2} dot={false} type="monotone" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
