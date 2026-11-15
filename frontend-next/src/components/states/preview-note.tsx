import { FlaskConical } from "lucide-react";

/** Marks a screen that runs on sample data because there is no backend for it yet. */
export function PreviewNote({ children }: { children: React.ReactNode }) {
  return (
    <div role="note" className="flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-xs text-ink-2">
      <FlaskConical className="size-3.5 shrink-0 text-warning" aria-hidden /><span><strong className="font-medium text-ink">Preview.</strong> {children}</span>
    </div>
  );
}
