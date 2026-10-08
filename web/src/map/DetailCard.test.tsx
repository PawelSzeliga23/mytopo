import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AreaProps, CragProps } from "@/lib/api";
import { ThemeProvider } from "@/lib/theme";
import { DetailCardBody } from "@/map/DetailCard";

const region: AreaProps = {
  id: 1, name: "Dolina Kobylańska", slug: "dolina-kobylanska", kind: "region", parent_id: 34,
  crag_count: 49, route_count: 645, center: [19.75, 50.15], bbox: [19.7, 50.1, 19.8, 50.2],
};
const crag: CragProps = {
  id: 7, name: "Żabi Koń", slug: "zabi-kon", area_id: 102, area_kind: "sektor", in_sector: true,
  route_count: 1, grade_bands: [1, 0, 0, 0],
};

const wrap = (ui: ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe("DetailCardBody", () => {
  it("region: liczby po polsku i przybliżanie", async () => {
    const onZoom = vi.fn();
    wrap(<DetailCardBody selection={{ type: "region", area: region, bands: [5, 4, 3, 1] }} onZoom={onZoom} onOpenCrag={vi.fn()} />);
    expect(screen.getByText("Region")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dolina Kobylańska" })).toBeInTheDocument();
    expect(screen.getByText("49 skał")).toBeInTheDocument();
    expect(screen.getByText("645 dróg")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Przybliż" }));
    expect(onZoom).toHaveBeenCalledWith([19.7, 50.1, 19.8, 50.2]);
  });

  it("skała: otwieranie strony skały", async () => {
    const onOpenCrag = vi.fn();
    wrap(<DetailCardBody selection={{ type: "crag", crag }} onZoom={vi.fn()} onOpenCrag={onOpenCrag} />);
    expect(screen.getByText("Skała")).toBeInTheDocument();
    expect(screen.getByText("1 droga")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Otwórz skałę" }));
    expect(onOpenCrag).toHaveBeenCalledWith("zabi-kon");
  });
});
