import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter, RouterProvider, useParams } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { ApiError } from "@/lib/api";
import { RouteKindProvider } from "@/lib/routeKind";
import { SessionProvider } from "@/lib/session";
import { ThemeProvider } from "@/lib/theme";
import MapPage from "@/map/MapPage";

// The crag page (konva, and three.js behind it) loads only when opened, so the map does not carry it.
const CragPage = lazy(() => import("@/pages/CragPage"));
const ChangesPage = lazy(() => import("@/pages/ChangesPage"));
const AreaPage = lazy(() => import("@/pages/AreaPage"));
const EditorPage = lazy(() => import("@/editor/EditorPage"));
const ModelEditorPage = lazy(() => import("@/model/ModelEditorPage"));

/** A page per slug: going from one crag or area to another starts with fresh state. */
function BySlug({ page: Page }: { page: ComponentType }) {
  const { slug } = useParams();
  return <Page key={slug} />;
}

const router = createBrowserRouter([
  { path: "/", element: <MapPage /> },
  {
    path: "/skaly/:slug",
    element: (
      <Suspense fallback={<p className="p-4 text-muted-foreground">Wczytywanie…</p>}>
        <BySlug page={CragPage} />
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
    path: "/obszary/:slug",
    element: (
      <Suspense fallback={<p className="p-4 text-muted-foreground">Wczytywanie…</p>}>
        <BySlug page={AreaPage} />
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

// A missing crag (404) or a bad request will not change on a retry: say so at once. Network and server errors retry once.
const retry = (failures: number, error: Error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 1;
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60_000, retry } } });

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <RouteKindProvider>
            <RouterProvider router={router} />
          </RouteKindProvider>
          <Toaster />
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
