import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ME_KEY } from "./api/auth";
import { ApiError } from "./api/client";
import { App } from "./App";
import "./styles.css";

const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
  queryCache: new QueryCache({
    // Session expired or signed out in another tab: any 401 sends the user to the sign-in page.
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) queryClient.setQueryData(ME_KEY, null);
    },
  }),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
