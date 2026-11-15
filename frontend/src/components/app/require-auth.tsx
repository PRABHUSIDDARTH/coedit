"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/api/auth";
import { ErrorState } from "@/components/states/states";
import { Skeleton } from "@/components/ui/skeleton";

/** Renders its children only for a signed-in user; otherwise sends them to /login. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const me = useMe();
  const signedOut = me.isSuccess && me.data === null;
  useEffect(() => { if (signedOut) router.replace("/login"); }, [signedOut, router]);

  if (me.isError) return <ErrorState title="Coedit couldn't reach the server" error={me.error} onRetry={() => me.refetch()} className="min-h-dvh" />;
  if (!me.isSuccess || me.data === null) {
    return <div className="flex h-dvh" aria-busy="true" aria-label="Loading"><Skeleton className="hidden h-full w-64 rounded-none lg:block" /><div className="flex-1 space-y-3 p-8"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-40 w-full" /></div></div>;
  }
  return <>{children}</>;
}
