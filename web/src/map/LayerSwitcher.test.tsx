import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LayerSwitcher } from "@/map/LayerSwitcher";

describe("LayerSwitcher", () => {
  it("zaznacza aktywny podkład i zmienia go", async () => {
    const onChange = vi.fn();
    render(<LayerSwitcher value="osm" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Mapa + cieniowanie" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Ortofotomapa" }));
    expect(onChange).toHaveBeenCalledWith("orto");
  });
});
