import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WallViewer } from "@/crag/WallViewer";
import type { ImageStatus } from "@/lib/useHtmlImage";
import { makeWall } from "@/test/fixtures";

const imageState = vi.hoisted(() => ({ current: { image: null as HTMLImageElement | null, status: "loading" as ImageStatus } }));
vi.mock("@/lib/useHtmlImage", () => ({ useHtmlImage: () => imageState.current }));
vi.mock("@/lib/useElementSize", () => ({ useElementSize: () => ({ width: 400, height: 300 }) }));
vi.mock("@/crag/WallCanvas", () => ({ WallCanvas: () => <div data-testid="canvas" /> }));
const webgl = vi.hoisted(() => ({ available: true }));
vi.mock("@/lib/webgl", () => ({ hasWebGL: () => webgl.available }));
const wall3d = vi.hoisted(() => ({ fail: false }));
vi.mock("@/crag/Wall3D", async () => {
  const { useEffect } = await import("react");
  return {
    default: function Wall3D({ onFail }: { onFail: () => void }) {
      useEffect(() => {
        if (wall3d.fail) onFail();
      }, [onFail]);
      return <div data-testid="model" />;
    },
  };
});

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

describe("WallViewer — 2.5D", () => {
  const ready = { depth_url: "/media/walls/1/depth.png", depth_status: "ready", segments_url: "/media/walls/1/segments.png" };

  it("każda ściana startuje w 2D, model 2.5D po kliknięciu w rogu", async () => {
    webgl.available = true;
    wall3d.fail = false;
    imageState.current = { image: document.createElement("img"), status: "loaded" };
    render(<WallViewer wall={makeWall(1, [], { ...ready, show_3d: true })} {...props} />);
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2D" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "2.5D" }));
    expect(await screen.findByTestId("model")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Wygląd modelu" })).toBeInTheDocument();
  });

  it("zarośnięta ściana startuje w 2D, ale można przełączyć na 2.5D", async () => {
    webgl.available = true;
    wall3d.fail = false;
    imageState.current = { image: document.createElement("img"), status: "loaded" };
    render(<WallViewer wall={makeWall(1, [], { ...ready, show_3d: false })} {...props} />);
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "2.5D" }));
    expect(await screen.findByTestId("model")).toBeInTheDocument();
  });

  it("bez mapy głębi nie ma przełącznika", () => {
    webgl.available = true;
    render(<WallViewer wall={makeWall(1, [], { show_3d: false })} {...props} />);
    expect(screen.queryByRole("group", { name: "Widok ściany" })).not.toBeInTheDocument();
  });

  it("bez WebGL zostaje 2D bez przełącznika", () => {
    webgl.available = false;
    imageState.current = { image: document.createElement("img"), status: "loaded" };
    render(<WallViewer wall={makeWall(1, [], { ...ready, show_3d: true })} {...props} />);
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Widok ściany" })).not.toBeInTheDocument();
  });

  it("gdy model się nie wczyta, wraca do zdjęcia z komunikatem", async () => {
    webgl.available = true;
    wall3d.fail = true;
    imageState.current = { image: document.createElement("img"), status: "loaded" };
    render(<WallViewer wall={makeWall(1, [], { ...ready, show_3d: true })} {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "2.5D" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Nie udało się wczytać modelu 2.5D");
    await act(async () => {});
    expect(screen.getByTestId("canvas")).toBeInTheDocument();
  });
});
