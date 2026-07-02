"use client";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

const DATA = [
  { name: "Ad spend Meta", value: 1940, color: "#378add" },
  { name: "COGS produit", value: 1200, color: "#1d9e75" },
  { name: "Call center", value: 420, color: "#c9a227" },
  { name: "Logistique", value: 380, color: "#ef9f27" },
  { name: "Salaires", value: 300, color: "#888780" },
];

export default function SpendChart() {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie
          data={DATA}
          cx="40%"
          cy="50%"
          innerRadius={45}
          outerRadius={70}
          paddingAngle={2}
          dataKey="value"
        >
          {DATA.map((entry, index) => (
            <Cell key={index} fill={entry.color} opacity={0.85} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11 }}
          formatter={(v) => [`$${Number(v ?? 0).toLocaleString()}`, ""]}
        />
        <Legend
          layout="vertical"
          align="right"
          verticalAlign="middle"
          iconType="square"
          iconSize={8}
          formatter={(val) => <span style={{ color: "#475569", fontSize: 10 }}>{val}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
