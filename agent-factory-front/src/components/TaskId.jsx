import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyTaskId } from "./copyTaskId.js";

export default function TaskId({ id }) {
  const [message, setMessage] = useState("");
  const [copying, setCopying] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function handleCopy() {
    clearTimeout(timer.current);
    setMessage("");
    setCopying(true);
    const result = await copyTaskId(id);
    setMessage(result);
    setCopying(false);
    timer.current = setTimeout(() => setMessage(""), 2000);
  }

  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1 text-xs text-slate-400">
      <span className="min-w-0 break-all">ID: {id}</span>
      <button
        type="button"
        onClick={handleCopy}
        disabled={copying}
        aria-label={`Copiar ID de tarea ${id}`}
        title="Copiar ID de tarea"
        className="shrink-0 rounded p-2 text-slate-400 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-50"
      >
        {message === "ID copiado" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
      <span role="status" aria-atomic="true">{message}</span>
    </div>
  );
}
