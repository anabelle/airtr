import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
// Import the generated route tree
import { routeTree } from '../routeTree.gen';
import '../index.css';
import { ToastHost } from '@/shared/components/feedback/ToastHost';
import { ConfirmProvider } from '@/shared/lib/confirm';

// Create a new router instance
const router = createRouter({ routeTree });

// Register the router instance for type safety
declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}

// Render the app
const rootElement = document.getElementById('root')!;
if (!rootElement.innerHTML) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
        <React.StrictMode>
            <ConfirmProvider>
                <RouterProvider router={router} />
                <ToastHost />
            </ConfirmProvider>
        </React.StrictMode>,
    );
}
