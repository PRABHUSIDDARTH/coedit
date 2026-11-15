import { cn } from "@/lib/utils";

/** The mark and lockups are used exactly as supplied: never recolor or restyle them.
 *  The lockup swaps between the light and dark files with the app theme. */
export function Logo({ height = 28, className }: { height?: number; className?: string }) {
  const width = Math.round((height * 753) / 256);
  return (
    <span className={cn("inline-flex shrink-0", className)} role="img" aria-label="Coedit">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/coedit-lockup-on-light.svg" alt="" width={width} height={height} className="dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/coedit-lockup-on-dark.svg" alt="" width={width} height={height} className="hidden dark:block" />
    </span>
  );
}

/** Symbol only. Minimum 24px; below that use favicon.svg. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/coedit-symbol.svg" alt="Coedit" width={Math.max(size, 24)} height={Math.max(size, 24)} className={className} />;
}
