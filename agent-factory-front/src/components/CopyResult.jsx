import { useEffect, useRef, useState } from "react";
import { copyResult } from "./resultClipboard.js";

export default function CopyResult({ text, label }) {
  const [message, setMessage] = useState("");
  const [copying, setCopying] = useState(false);
  const mounted = useRef(false);
  const timeout = useRef(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timeout.current);
    };
  }, []);

  async function handleCopy(event) {
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(timeout.current);
    setMessage("");
    setCopying(true);
    const result = await copyResult(text);
    if (!mounted.current) return;
    setMessage(result);
    setCopying(false);
    if (result === "Copiado") {
      timeout.current = setTimeout(() => setMessage(""), 2000);
    }
  }

  return (
    <span className="ml-2 inline-flex max-w-full flex-wrap items-center gap-2 align-middle">
      <button
        type="button"
        onClick={handleCopy}
        disabled={copying}
        aria-label={`Copiar ${label}`}
        className="shrink-0 rounded border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-50"
      >
        {copying ? "Copiando…" : "Copiar"}
      </button>
      <span role="status" aria-atomic="true" className="min-w-0 break-words text-xs text-slate-300">{message}</span>
    </span>
  );
}
