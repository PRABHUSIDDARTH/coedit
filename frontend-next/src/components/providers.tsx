"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { ApiError } from "@/api/client";
import { ME_KEY } from "@/api/auth";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => {
    // Any 401 means the session ended: flip "me" to signed-out so the app guard leaves the page.
    const onUnauthorized = (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) c.setQueryData(ME_KEY, null);
    };
    const c: QueryClient = new QueryClient({
      queryCache: new QueryCache({ onError: (e, q) => { if (q.queryKey[0] !== ME_KEY[0]) onUnauthorized(e); } }),
      mutationCache: new MutationCache({ onError: onUnauthorized }),
      defaultOptions: { queries: { staleTime: 15_000, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: false } },
    });
    return c;
  });
  return (
    // Sets both class="dark" (Tailwind) and data-theme (brand tokens) on <html>.
    <ThemeProvider attribute={["class", "data-theme"]} defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
