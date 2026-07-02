"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import {
  LayoutDashboard,
  TrendingUp,
  Bell,
  Users,
  Plug,
  ChevronRight,
  Globe,
  Zap,
  Share2,
  Map,
  LogOut,
} from "lucide-react";
import { ALERTS } from "@/lib/data";

const activeAlerts = ALERTS.filter((a) => !a.snoozed).length;

const NAV = [
  { href: "/ceo",               label: "Trésorerie", icon: LayoutDashboard, exact: true },
  { href: "/ceo/profitability", label: "Rentabilité", icon: TrendingUp },
  { href: "/ceo/meta-ads",      label: "Meta Ads", icon: Globe },
  { href: "/ceo/shipsen",       label: "Shipsen", icon: Zap },
  { href: "/ceo/noki-noki",     label: "Africod Congo", icon: Share2 },
  { href: "/ceo/coliscod",      label: "Coliscod Angola", icon: Map },
  { href: "/ceo/clickmarket",   label: "ClickMarket", icon: Zap },
  { href: "/ceo/crm-voralis",   label: "CRM Voralis", icon: Share2 },
  { href: "/ceo/alerts",        label: "Alertes",    icon: Bell, badge: activeAlerts },
  { href: "/ceo/team",          label: "Équipe",     icon: Users },
  { href: "/ceo/connections",   label: "Sources",    icon: Plug },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="fixed inset-y-0 left-0 w-56 flex flex-col bg-sidebar-50 border-r border-sidebar-200 z-20">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-200">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-semibold"
          style={{ background: "#0f2040", border: "1px solid #c9a227", color: "#c9a227" }}
        >
          V
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900 tracking-wide">VORALIS</p>
          <p className="text-xs text-slate-600">CEO Dashboard</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
        {NAV.map(({ href, label, icon: Icon, badge, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all",
                active
                  ? "bg-sidebar-200 text-slate-900 font-medium"
                  : "text-slate-600 hover:text-slate-900 hover:bg-sidebar-100"
              )}
            >
              <Icon size={16} className={active ? "text-sidebar-700" : ""} />
              <span className="flex-1">{label}</span>
              {badge ? (
                <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">
                  {badge}
                </span>
              ) : active ? (
                <ChevronRight size={12} className="text-sidebar-600" />
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 pt-2 border-t border-sidebar-200">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-600 hover:text-red-600 hover:bg-red-50 transition-all"
        >
          <LogOut size={16} />
          <span>Déconnexion</span>
        </button>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-sidebar-200">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs text-slate-600">Meta live · sync 14:32</span>
        </div>
        <p className="text-xs text-slate-500 mt-1">FGMED / Naturala Lda</p>
      </div>
    </aside>
  );
}
