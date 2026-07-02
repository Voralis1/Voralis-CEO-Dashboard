"use client";
import { createContext, useContext, useState, ReactNode } from "react";

interface FilterState {
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;   // YYYY-MM-DD
  setDateFrom: (date: string) => void;
  setDateTo: (date: string) => void;
}

const FilterContext = createContext<FilterState | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  // Today's date
  const today = new Date().toISOString().split("T")[0];
  // 30 days ago
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const [dateFrom, setDateFrom] = useState<string>(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState<string>(today);

  return (
    <FilterContext.Provider value={{ dateFrom, dateTo, setDateFrom, setDateTo }}>
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilters must be inside FilterProvider");
  return ctx;
}
