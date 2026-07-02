"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { LineChart, TrendingUp, ShieldCheck, Eye, EyeOff, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setLoading(false);
      setError("Email ou mot de passe incorrect.");
      return;
    }

    router.push("/ceo");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex">
      {/* Left — branding panel */}
      <div
        className="hidden lg:flex lg:w-1/2 relative flex-col justify-between p-12 overflow-hidden"
        style={{ background: "linear-gradient(160deg, #0f2040 0%, #08132a 60%, #030814 100%)" }}
      >
        {/* Decorative background shapes */}
        <div
          className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, #c9a227, transparent 70%)" }}
        />
        <div
          className="absolute bottom-0 left-0 w-full h-64 opacity-10"
          style={{ background: "radial-gradient(circle at 20% 100%, #2f9e58, transparent 60%)" }}
        />

        <div className="relative flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center text-lg font-semibold"
            style={{ background: "#0f2040", border: "1px solid #c9a227", color: "#c9a227" }}
          >
            V
          </div>
          <div>
            <p className="text-lg font-semibold text-white tracking-wide">VORALIS</p>
            <p className="text-sm text-slate-400">CEO Dashboard</p>
          </div>
        </div>

        <div className="relative space-y-6">
          <h1 className="text-4xl font-semibold text-white leading-tight">
            Pilotez votre<br />performance financière<br />en temps réel.
          </h1>
          <p className="text-base text-slate-400 max-w-md">
            Trésorerie, rentabilité, acquisition et logistique — toute la donnée
            multi-marchés FGMED / Naturala Lda réunie dans un seul cockpit.
          </p>

          <div className="flex flex-col gap-4 pt-4">
            <div className="flex items-center gap-3 text-slate-300">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(47,158,88,0.15)" }}>
                <TrendingUp size={16} className="text-sidebar-400" />
              </div>
              <span className="text-sm">Suivi cashflow &amp; rentabilité en direct</span>
            </div>
            <div className="flex items-center gap-3 text-slate-300">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(201,162,39,0.15)" }}>
                <LineChart size={16} className="text-gold-400" />
              </div>
              <span className="text-sm">Vision consolidée de tous les marchés</span>
            </div>
            <div className="flex items-center gap-3 text-slate-300">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(55,138,221,0.15)" }}>
                <ShieldCheck size={16} className="text-blue-400" />
              </div>
              <span className="text-sm">Accès sécurisé réservé à l&apos;équipe direction</span>
            </div>
          </div>
        </div>

        <p className="relative text-xs text-slate-600">© {new Date().getFullYear()} FGMED / Naturala Lda</p>
      </div>

      {/* Right — login form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-base font-semibold"
              style={{ background: "#0f2040", border: "1px solid #c9a227", color: "#c9a227" }}
            >
              V
            </div>
            <div>
              <p className="text-base font-semibold text-slate-900 tracking-wide">VORALIS</p>
              <p className="text-xs text-slate-500">CEO Dashboard</p>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-slate-900">Connexion</h2>
          <p className="text-sm text-slate-500 mt-1.5 mb-8">
            Entrez vos identifiants pour accéder au dashboard.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@fgmed.com"
                className="w-full px-3.5 py-2.5 text-sm bg-white text-slate-900 border border-slate-300 rounded-lg placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sidebar-400 focus:border-sidebar-400 transition-colors"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 pr-10 text-sm bg-white text-slate-900 border border-slate-300 rounded-lg placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sidebar-400 focus:border-sidebar-400 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-60"
              style={{ background: "#227e45" }}
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              {loading ? "Connexion..." : "Se connecter"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
