import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { ChangeOut } from "@/lib/api";
import { ChangeEntry } from "./ChangeEntry";

const change: ChangeOut = {
  id: 12, author: "bartek", comment: null, issued_at: new Date().toISOString(), is_import: false, reverts_id: null, reverted_by: 15,
  crag: null, area_path: [],
  objects: [{ kind: "route", id: 7, name: "Filar", op: "updated", summary: null, diffs: [{ field: "grade", before: "VI+", after: "VI.1" }] }],
};

describe("ChangeEntry", () => {
  it("cofnięta zmiana pokazuje „cofnięta przez” i dalej przycisk Cofnij", () => {
    render(<MemoryRouter><ChangeEntry change={change} onRevert={() => {}} /></MemoryRouter>);
    expect(screen.getByText("cofnięta przez #15")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "↶ Cofnij" })).toBeInTheDocument();
  });

  it("wpis importu nie ma przycisku", () => {
    render(<MemoryRouter><ChangeEntry change={{ ...change, is_import: true, reverted_by: null }} onRevert={() => {}} /></MemoryRouter>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
