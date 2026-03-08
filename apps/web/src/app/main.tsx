import { createRouter, RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
// Import the generated route tree
import { routeTree } from "../routeTree.gen";
import "../index.css";
// Initialize i18n (must be imported before any component that uses useTranslation)
import "../i18n";
import { TimelineToastBridge } from "@/shared/components/feedback/TimelineToastBridge";
import { ToastHost } from "@/shared/components/feedback/ToastHost";
import { BankruptcyOverlay } from "@/features/identity/components/BankruptcyOverlay";
import { ConfirmProvider } from "@/shared/lib/useConfirm";

// Create a new router instance
const router = createRouter({ routeTree });

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Render the app
const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <ConfirmProvider>
        <RouterProvider router={router} />
        <ToastHost />
        <TimelineToastBridge />
        <BankruptcyOverlay />
      </ConfirmProvider>
    </React.StrictMode>,
  );
}
