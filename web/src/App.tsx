import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { ThemeProvider } from "@/lib/theme";
import MapPage from "@/map/MapPage";
import CragPage from "@/pages/CragPage";

const router = createBrowserRouter([
  { path: "/", element: <MapPage /> },
  { path: "/skaly/:slug", element: <CragPage /> },
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
