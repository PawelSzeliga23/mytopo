import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WallViewer } from "@/crag/WallViewer";
import type { ImageStatus } from "@/lib/useHtmlImage";
import { makeWall } from "@/test/fixtures";

const imageState = vi.hoisted(() => ({ current: { image: null as HTMLImageElement | null, status: "loading" as ImageStatus } }));
vi.mock("@/lib/useHtmlImage", () => ({ useHtmlImage: () => imageState.current }));
vi.mock("@/lib/useElementSize", () => ({ useElementSize: () => ({ width: 400, height: 300 }) }));
vi.mock("@/crag/WallCanvas", () => ({ WallCanvas: () => <div data-testid="canvas" /> }));

const props = { routes: new Map(), selectedRouteId: null, hoveredRouteId: null, onSelectRoute: vi.fn(), onHoverRoute: vi.fn() };

describe("WallViewer", () => {
  it("ściana bez zdjęcia", () => {
    render(<WallViewer wall={makeWall(1, [], { image_url: null })} {...props} />);
    expect(screen.getByText("Brak zdjęcia tej ściany.")).toBeInTheDocument();
  });

  it("zdjęcie, które się nie wczytało", () => {
    imageState.current = { image: null, status: "failed" };
    render(<WallViewer wall={makeWall(1, [])} {...props} />);
    expect(screen.getByText("Nie udało się wczytać zdjęcia.")).toBeInTheDocument();
  });

  it("wczytywanie, potem rysunek", () => {
    imageState.current = { image: null, status: "loading" };
    const view = render(<WallViewer wall={makeWall(1, [])} {...props} />);
    expect(screen.getByText("Wczytywanie zdjęcia…")).toBeInTheDocument();
    imageState.current = { image: document.createElement("img"), status: "loaded" };
    view.rerender(<WallViewer wall={makeWall(1, [])} {...props} />);
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
  });
});
