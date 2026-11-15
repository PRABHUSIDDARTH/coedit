import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function EmptyState({ icon: Icon, title, body, action, className }: { icon?: React.ElementType; title: string; body: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto flex max-w-sm flex-col items-center gap-3 px-6 py-16 text-center", className)}>
      {Icon && <Icon className="size-6 text-ink-3" aria-hidden />}
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="text-sm text-ink-2">{body}</p>
      {action}
    </div>
  );
}

export function ErrorState({ title = "This didn't load", error, onRetry, className }: { title?: string; error?: Error; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("mx-auto flex max-w-sm flex-col items-center gap-3 px-6 py-16 text-center", className)}>
      <AlertTriangle className="size-6 text-danger" aria-hidden />
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="text-sm text-ink-2">{error?.message ?? "Check your connection and try again."}</p>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
    </div>
  );
}
