import { useState } from "react";
import { CheckCircle2, LoaderCircle, MessageCircleQuestion, Sparkles, WandSparkles } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

function buildTaskDescription(spec) {
  const sections = [spec.description?.trim()];
  if (spec.requirements?.length) sections.push(`REQUISITOS FUNCIONALES\n${spec.requirements.join("\n")}`);
  if (spec.acceptanceCriteria?.length) sections.push(`CRITERIOS DE ACEPTACION\n${spec.acceptanceCriteria.join("\n")}`);
  if (spec.constraints?.length) sections.push(`RESTRICCIONES\n${spec.constraints.map((x) => `- ${x}`).join("\n")}`);
  if (spec.outOfScope?.length) sections.push(`FUERA DE ALCANCE\n${spec.outOfScope.map((x) => `- ${x}`).join("\n")}`);
  return sections.filter(Boolean).join("\n\n");
}

function formatTraceStep(step) {
  const base = `${step.provider} - ${step.stage}: ${step.status}`;

  if (!step.fallbackFrom && !step.fallbackReason) {
    return base;
  }

  return `${base} - fallback desde ${step.fallbackFrom || "proveedor original"} por ${step.fallbackReason || "falla de proveedor"}`;
}

export default function SpecificationAssistant({ onUseSpecification }) {
  const [idea, setIdea] = useState("");
  const [conversation, setConversation] = useState([]);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function analyze(nextConversation = conversation) {
    if (!idea.trim()) { setError("Escribi la idea o especificacion que queres mejorar."); return; }
    try {
      setLoading(true); setError("");
      const response = await fetch(`${API_URL}/specifications/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: idea.trim(), conversation: nextConversation }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "No se pudo analizar la especificacion");
      setResult(data);
    } catch (err) {
      setError(err.message || "No se pudo analizar la especificacion");
    } finally { setLoading(false); }
  }

  async function sendAnswer() {
    if (!answer.trim()) return;
    const questions = (result?.questions || []).join("\n");
    const next = [
      ...conversation,
      { role: "assistant", content: questions },
      { role: "user", content: answer.trim() },
    ];
    setConversation(next); setAnswer("");
    await analyze(next);
  }

  function reset() {
    setIdea(""); setConversation([]); setAnswer(""); setResult(null); setError("");
  }

  const ready = result?.status === "READY";

  return (
    <section>
      <div className="mb-8">
        <div className="flex items-center gap-2 text-violet-400"><WandSparkles size={18}/><span className="text-sm font-medium">Analista IA</span></div>
        <h2 className="mt-2 text-3xl font-bold text-white">Asistente de especificacion</h2>
        <p className="mt-2 max-w-3xl text-slate-400">Conta lo que necesitas en lenguaje coloquial. Claude y Codex lo analizan, te preguntan solo lo necesario y generan una especificacion ejecutable cuando el alcance esta claro.</p>
      </div>

      {error && <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <label className="mb-2 block text-sm font-medium text-slate-300">Idea, necesidad o especificacion existente</label>
          <textarea value={idea} onChange={(e) => setIdea(e.target.value)} disabled={loading || conversation.length > 0} rows="10" placeholder="Ej: Quiero que si QA falla porque Codex se quedo sin cuota no marque la tarea como fallida..." className="w-full resize-y rounded-lg border border-white/10 bg-slate-900 px-3 py-3 outline-none focus:border-violet-500"/>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={() => analyze()} disabled={loading || !idea.trim()} className="inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-2.5 font-semibold text-white disabled:opacity-50">
              {loading ? <LoaderCircle className="animate-spin" size={17}/> : <Sparkles size={17}/>} {conversation.length ? "Volver a analizar" : "Analizar con IA"}
            </button>
            {(result || conversation.length > 0) && <button type="button" onClick={reset} disabled={loading} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold">Empezar de nuevo</button>}
          </div>

          {result?.status === "NEEDS_CLARIFICATION" && (
            <div className="mt-6 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
              <div className="flex items-center gap-2 font-semibold text-amber-300"><MessageCircleQuestion size={18}/>Necesito aclarar esto</div>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-300">{result.questions?.map((q) => <li key={q}>{q}</li>)}</ol>
              <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={loading} rows="5" placeholder="Responde normalmente; podes contestar todas las preguntas juntas." className="mt-4 w-full resize-y rounded-lg border border-white/10 bg-slate-950 px-3 py-3 outline-none focus:border-amber-400"/>
              <button type="button" onClick={sendAnswer} disabled={loading || !answer.trim()} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 font-semibold text-slate-950 disabled:opacity-50">{loading && <LoaderCircle className="animate-spin" size={17}/>}Responder y continuar</button>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          {!result && <div className="flex min-h-64 items-center justify-center text-center text-slate-500">La especificacion refinada aparecera aca.</div>}
          {result && !ready && <div className="flex min-h-64 items-center justify-center text-center text-slate-400">Todavia no genero la especificacion final porque hay decisiones que necesitan tu respuesta.</div>}
          {ready && (
            <div>
              <div className="flex items-center gap-2 text-emerald-300"><CheckCircle2 size={18}/><span className="font-semibold">Especificacion lista</span></div>
              <h3 className="mt-4 text-xl font-bold text-white">{result.title}</h3>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{result.description}</p>
              {[["Requisitos", result.requirements], ["Criterios de aceptacion", result.acceptanceCriteria], ["Restricciones", result.constraints], ["Fuera de alcance", result.outOfScope]].map(([title, items]) => items?.length ? (
                <div className="mt-5" key={title}><h4 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h4><div className="mt-2 space-y-2">{items.map((item) => <div key={item} className="rounded-lg bg-slate-900/80 p-3 text-sm text-slate-300">{item}</div>)}</div></div>
              ) : null)}
              <div className="mt-6 flex flex-wrap gap-3">
                <button type="button" onClick={() => onUseSpecification({ title: result.title, description: buildTaskDescription(result) })} className="rounded-lg bg-emerald-500 px-4 py-2.5 font-semibold text-slate-950">Usar para crear tarea</button>
                <button type="button" onClick={() => { setResult({ ...result, status: "NEEDS_CLARIFICATION", questions: ["¿Que queres cambiar o mejorar de esta especificacion?"] }); }} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold">Seguir mejorando</button>
              </div>
            </div>
          )}

          {result?.trace?.length > 0 && <div className="mt-6 border-t border-white/10 pt-4 text-xs text-slate-500">{result.trace.map((step, i) => <span key={`${step.provider}-${step.stage}-${i}`} className="mr-3 inline-block">{formatTraceStep(step)}</span>)}</div>}
        </div>
      </div>
    </section>
  );
}
