import "@fontsource-variable/inter";
import "./styles/globals.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { LazyMotion, domAnimation } from "framer-motion";
import { Toaster } from "sonner";
import { queryClient } from "./lib/query-client";
import { router } from "./router";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domAnimation}>
        <RouterProvider router={router} />
        <Toaster position="top-center" closeButton />
      </LazyMotion>
    </QueryClientProvider>
  </StrictMode>,
);
