import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChangeOut, RevertConflict } from "@/lib/api";
import { ConflictDialog } from "./ConflictDialog";

const change: ChangeOut = {
  id: 9, author: "ania", comment: null, issued_at: new Date().toISOString(), is_import: false, reverts_id: null, reverted_by: null,
  crag: null, area_path: [], objects: [],
};
const field: RevertConflict = {
  kind: "route", id: 7, name: "Filar", field: "grade", author: "bartek", issued_at: new Date().toISOString(), current: "VI.1", restored: "VI",
};
const whole: RevertConflict = { ...field, kind: "wall", name: "2", field: "*" };

function setup(conflicts: RevertConflict[]) {
  const handlers = { onCancel: vi.fn(), onSafe: vi.fn(), onAll: vi.fn() };
  render(<ConflictDialog change={change} conflicts={conflicts} {...handlers} />);
  return handlers;
}

describe("ConflictDialog", () => {
  it("trzy przyciski wołają swoje obsługi", async () => {
    const handlers = setup([field]);
    expect(screen.getByText(/Cofnąć zmianę ania z/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    await userEvent.click(screen.getByRole("button", { name: "Cofnij tylko bez konfliktu" }));
    await userEvent.click(screen.getByRole("button", { name: "Cofnij wszystko" }));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onSafe).toHaveBeenCalledTimes(1);
    expect(handlers.onAll).toHaveBeenCalledTimes(1);
  });

  it("opisuje konflikt pola: kto, obecna i przywracana wartość", () => {
    setup([field]);
    expect(screen.getByText(/Droga Filar/)).toBeInTheDocument();
    expect(screen.getByText(/wycena — bartek/)).toBeInTheDocument();
    expect(screen.getByText("VI")).toHaveClass("diff-ins");
  });

  it("konflikt całego obiektu ma osobny opis", () => {
    setup([whole]);
    expect(screen.getByText(/zmieniono później w całości/)).toBeInTheDocument();
  });
});
