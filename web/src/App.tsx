import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { SessionProvider } from "@/lib/session";
import { ThemeProvider } from "@/lib/theme";
import MapPage from "@/map/MapPage";

// The crag page (konva, and three.js behind it) loads only when opened, so the map does not carry it.
const CragPage = lazy(() => import("@/pages/CragPage"));
const ChangesPage = lazy(() => import("@/pages/ChangesPage"));
const EditorPage = lazy(() => import("@/editor/EditorPage"));
const ModelEditorPage = lazy(() => import("@/model/ModelEditorPage"));

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
  {
    path: "/skaly/:slug/topo/:wallId",
    element: (
      <Suspense fallback={<p className="p-4 text-muted-foreground">Wczytywanie…</p>}>
        <EditorPage />
      </Suspense>
    ),
  },
  {
    path: "/skaly/:slug/model/:wallId",
    element: (
      <Suspense fallback={<p className="p-4 text-muted-foreground">Wczytywanie…</p>}>
        <ModelEditorPage />
      </Suspense>
    ),
  },
  {
    path: "/zmiany",
    element: (
      <Suspense fallback={<p className="p-4 text-muted-foreground">Wczytywanie…</p>}>
        <ChangesPage />
      </Suspense>
    ),
  },
]);

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60_000, retry: 1 } } });

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <RouterProvider router={router} />
          <Toaster />
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
