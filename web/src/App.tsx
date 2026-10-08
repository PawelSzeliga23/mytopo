import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { ThemeProvider } from "@/lib/theme";
import MapPage from "@/map/MapPage";

// The crag page (konva, and three.js behind it) loads only when opened, so the map does not carry it.
const CragPage = lazy(() => import("@/pages/CragPage"));

const router = createBrowserRouter([
  { path: "/", element: <MapPage /> },
  {
    path: "/skaly/:slug",
    element: (
      <Suspense fallback={<p className="p-4 text-muted-foreground">Wczytywanie…</p>}>
        <CragPage />
      </Suspense>
    ),
  },
]);

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60_000, retry: 1 } } });

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
