import { LoaderCircle } from "lucide-react";

export default function MetricCard({
  title,
  value,
  icon: Icon,
  color,
  execution = false,
}) {
  const isRunning = execution && Number(value) > 0;

  return (
    <article
      className={`min-w-0 rounded-2xl border p-5 ${
        isRunning
          ? "border-violet-400/50 bg-violet-500/10 shadow-lg shadow-violet-950/20"
          : "border-white/10 bg-white/5"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-400">{title}</span>
        <Icon aria-hidden="true" className={`${color} shrink-0`} size={20} />
      </div>

      <strong className="mt-3 block break-words text-3xl text-white tabular-nums">
        {value}
      </strong>

      {execution && (
        <p role="status" aria-atomic="true" className="mt-3 flex items-center gap-2 text-xs text-violet-200">
          {isRunning && (
            <LoaderCircle
              aria-hidden="true"
              size={14}
              className="shrink-0 motion-safe:animate-spin"
            />
          )}
          <span>
            {isRunning
              ? `${value} ${Number(value) === 1 ? "tarea en ejecución" : "tareas en ejecución"}`
              : "Sin tareas en ejecución"}
          </span>
        </p>
      )}
    </article>
  );
}
