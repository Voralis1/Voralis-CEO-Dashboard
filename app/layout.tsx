import type { Metadata } from "next";
import "./globals.css";
import { FilterProvider } from "@/lib/filters";

export const metadata: Metadata = {
  title: "VORALIS · CEO Dashboard",
  description: "Plateforme de pilotage financier multi-marchés — FGMED / Naturala Lda",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <FilterProvider>
          {children}
        </FilterProvider>
      </body>
    </html>
  );
}
