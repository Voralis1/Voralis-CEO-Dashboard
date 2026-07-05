"use client";
import { useEffect, useRef, useState } from "react";
import Topbar from "@/components/layout/Topbar";
import { Section } from "@/components/ui";
import { useFilters } from "@/lib/filters";
import { Send, Loader2, Bot, User, Target, AlertTriangle } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface BottleneckSummary {
  cibleJour: number;
  livresRentablesJourActuel: number;
  ecartJour: number;
  angleMortObjectif: string | null;
}

const SUGGESTIONS = [
  "Où est le plus gros goulot en ce moment ?",
  "Que dois-je faire aujourd'hui pour me rapprocher de 50 livraisons rentables/jour ?",
  "Quel marché a le plus de risque de rupture de stock ?",
];

export default function CopilotPage() {
  const { dateFrom, dateTo } = useFilters();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<BottleneckSummary | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/copilot/alerts?dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.bottleneck) setSummary(json.bottleneck);
      })
      .catch(() => {
        // Résumé silencieux si l'appel échoue — le chat reste utilisable indépendamment.
      });
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || sending) return;
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text.trim() }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, dateFrom, dateTo }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Erreur ${res.status}`);
      setMessages((prev) => [...prev, { role: "assistant", content: json.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <Topbar title="Copilot IA" subtitle="Analyse le funnel complet et priorise les actions vers l'objectif 50 livraisons rentables/jour" />

      <div className="px-6 py-5 space-y-5">
        {summary && (
          <Section>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Target size={16} className="text-sidebar-700" />
                <span className="text-sm text-slate-600">Objectif</span>
                <span className="text-sm font-semibold text-slate-900">{summary.cibleJour} livraisons rentables/jour</span>
              </div>
              <div className="text-sm text-slate-600">
                Actuel : <span className="font-semibold text-slate-900">{summary.livresRentablesJourActuel.toFixed(1)}</span>
              </div>
              <div className={`text-sm font-semibold ${summary.ecartJour > 0 ? "text-red-600" : "text-emerald-600"}`}>
                {summary.ecartJour > 0 ? `Écart : -${summary.ecartJour.toFixed(1)}/jour` : "Objectif atteint"}
              </div>
            </div>
            {summary.angleMortObjectif && (
              <p className="text-xs text-amber-600 mt-2 flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {summary.angleMortObjectif}
              </p>
            )}
          </Section>
        )}

        <Section className="flex flex-col" title="Discussion">
          <div ref={scrollRef} className="flex-1 min-h-[360px] max-h-[520px] overflow-y-auto space-y-4 pr-1 mb-4">
            {messages.length === 0 ? (
              <div className="py-10 text-center">
                <Bot size={28} className="text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500 mb-4">Pose une question sur le funnel, un marché, un réseau ou un affilié.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:border-sidebar-400 hover:text-slate-900 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
                  {m.role === "assistant" && (
                    <div className="w-7 h-7 rounded-full bg-sidebar-100 flex items-center justify-center shrink-0">
                      <Bot size={14} className="text-sidebar-700" />
                    </div>
                  )}
                  <div
                    className={`max-w-[75%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                      m.role === "user" ? "bg-sidebar-700 text-white" : "bg-slate-100 text-slate-800"
                    }`}
                  >
                    {m.content}
                  </div>
                  {m.role === "user" && (
                    <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                      <User size={14} className="text-slate-600" />
                    </div>
                  )}
                </div>
              ))
            )}
            {sending && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-sidebar-100 flex items-center justify-center shrink-0">
                  <Bot size={14} className="text-sidebar-700" />
                </div>
                <div className="rounded-xl px-4 py-2.5 bg-slate-100 text-slate-500 text-sm flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Analyse du funnel en cours…
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
              <AlertTriangle size={14} />
              {error}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ex : où est le plus gros goulot cette semaine ?"
              className="flex-1 px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-sidebar-300"
              disabled={sending}
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-sidebar-700 text-white text-sm disabled:opacity-40"
            >
              <Send size={14} />
              Envoyer
            </button>
          </form>
        </Section>
      </div>
    </div>
  );
}
