import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import "@echo/ui/tokens.css";
import "./reset.css";

import { AuthProvider } from "./lib/auth-context";
import { router } from "./router";

const queryClient = new QueryClient();

const container = document.getElementById("app");
if (!container) throw new Error("#app root element not found");

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
