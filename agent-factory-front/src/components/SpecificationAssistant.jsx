import { useRef, useState } from "react";
import { CheckCircle2, FileText, LoaderCircle, MessageCircleQuestion, Paperclip, Sparkles, WandSparkles, X } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

const MAX_ATTACHMENTS = 5;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function formatFileSize(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [attachments, setAttachments] = useState([]);
  const attachmentsRef = useRef([]);
  const fileInputRef = useRef(null);
  const attachmentIdCounter = useRef(0);

  function setAttachmentsAndRef(updater) {
    setAttachments((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      attachmentsRef.current = next;
      return next;
    });
  }

  function countActiveAttachments(list) {
    return list.filter((a) => a.status === "ok" || a.status === "truncated" || a.status === "processing").length;
  }

  async function handleFilesSelected(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    for (const file of files) {
      attachmentIdCounter.current += 1;
      const id = `${file.name}-${attachmentIdCounter.current}`;
      const activeCount = countActiveAttachments(attachmentsRef.current);

      if (activeCount >= MAX_ATTACHMENTS) {
        setAttachmentsAndRef((prev) => [...prev, { id, fileName: file.name, status: "rejected", reason: `Se alcanzo el maximo de ${MAX_ATTACHMENTS} PDFs por solicitud.` }]);
        continue;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        setAttachmentsAndRef((prev) => [...prev, { id, fileName: file.name, status: "rejected", reason: `El archivo supera el tamaño maximo permitido de 10 MB (pesa ${formatFileSize(file.size)}).` }]);
        continue;
      }

      setAttachmentsAndRef((prev) => [...prev, { id, fileName: file.name, status: "processing" }]);

      try {
        const formData = new FormData();
        formData.append("pdfs", file);
        formData.append("currentCount", String(activeCount));
        const response = await fetch(`${API_URL}/specifications/attachments/extract`, { method: "POST", body: formData });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "No se pudo procesar el archivo.");
        const extractionResult = (data.results || [])[0] || { status: "error", reason: "No se pudo procesar el archivo." };
        setAttachmentsAndRef((prev) => prev.map((a) => (a.id === id ? { ...a, ...extractionResult } : a)));
      } catch (err) {
        setAttachmentsAndRef((prev) => prev.map((a) => (a.id === id ? { ...a, status: "error", reason: err.message || "No se pudo procesar el archivo." } : a)));
      }
    }
  }

  function removeAttachment(id) {
    setAttachmentsAndRef((prev) => prev.filter((a) => a.id !== id));
  }

  async function analyze(nextConversation = conversation) {
    if (!idea.trim()) { setError("Escribi la idea o especificacion que queres mejorar."); return; }
    try {
      setLoading(true); setError("");
      const validAttachments = attachments
        .filter((a) => a.status === "ok" || a.status === "truncated")
        .map((a) => ({ fileName: a.fileName, text: a.text }));
      const response = await fetch(`${API_URL}/specifications/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: idea.trim(), conversation: nextConversation, attachments: validAttachments }),
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
    setAttachmentsAndRef([]);
  }

  const ready = result?.status === "READY";
  const activeAttachmentsCount = countActiveAttachments(attachments);
  const attachmentsLocked = loading || conversation.length > 0;

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
            <button type="button" onClick={() => analyze()} disabled={loading || !idea.trim() || attachments.some((a) => a.status === "processing")} className="inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-2.5 font-semibold text-white disabled:opacity-50">
              {loading ? <LoaderCircle className="animate-spin" size={17}/> : <Sparkles size={17}/>} {conversation.length ? "Volver a analizar" : "Analizar con IA"}
            </button>
            {(result || conversation.length > 0) && <button type="button" onClick={reset} disabled={loading} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold">Empezar de nuevo</button>}
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-300">Documentos PDF de contexto (opcional)</label>
              <span className="text-xs text-slate-500">{activeAttachmentsCount}/{MAX_ATTACHMENTS}</span>
            </div>
            <input ref={fileInputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => { handleFilesSelected(e.target.files); e.target.value = ""; }}/>
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={attachmentsLocked || activeAttachmentsCount >= MAX_ATTACHMENTS} className="mt-2 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold disabled:opacity-50">
              <Paperclip size={16}/> Adjuntar PDF
            </button>
            <p className="mt-1 text-xs text-slate-500">Hasta {MAX_ATTACHMENTS} archivos, 10 MB cada uno. El contenido se usa como contexto adicional, sin reemplazar tu texto.</p>

            {attachments.length > 0 && (
              <ul className="mt-3 space-y-2">
                {attachments.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-slate-900/80 p-3 text-sm">
                    <div className="flex min-w-0 items-start gap-2">
                      <FileText size={16} className="mt-0.5 shrink-0 text-slate-400"/>
                      <div className="min-w-0">
                        <div className="truncate text-slate-200">{a.fileName}</div>
                        {a.status === "processing" && <div className="text-xs text-slate-400">Procesando...</div>}
                        {a.status === "ok" && <div className="text-xs text-emerald-400">Listo · {a.charCount?.toLocaleString("es-AR")} caracteres</div>}
                        {a.status === "truncated" && <div className="text-xs text-amber-400">{a.reason}</div>}
                        {(a.status === "error" || a.status === "rejected") && <div className="text-xs text-red-400">{a.reason}</div>}
                      </div>
                    </div>
                    {!attachmentsLocked && <button type="button" onClick={() => removeAttachment(a.id)} className="shrink-0 text-slate-500 hover:text-slate-300"><X size={16}/></button>}
                  </li>
                ))}
              </ul>
            )}
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
              {result.sourceDocuments?.length > 0 && (
                <div className="mt-5">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Documentos PDF usados como contexto</h4>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.sourceDocuments.map((name) => (
                      <span key={name} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900/80 px-3 py-1.5 text-xs text-slate-300"><FileText size={14}/>{name}</span>
                    ))}
                  </div>
                </div>
              )}
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
