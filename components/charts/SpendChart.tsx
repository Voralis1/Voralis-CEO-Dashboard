"use client";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

export interface SpendChartSlice {
  name: string;
  value: number;
  color: string;
}

export default function SpendChart({ data }: { data: SpendChartSlice[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={45}
          outerRadius={70}
          paddingAngle={2}
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.color} opacity={0.85} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11 }}
          formatter={(v) => [`$${Number(v ?? 0).toLocaleString()}`, ""]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
