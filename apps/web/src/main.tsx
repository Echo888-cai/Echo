import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import "@echo/ui/tokens.css";
import "./reset.css";

import { AuthProvider } from "./lib/auth-context";
import { queryClient } from "./lib/queryClient";
import { router } from "./router";

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

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
