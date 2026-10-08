import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GradeBadge } from "@/components/GradeBadge";
import { ThemeProvider } from "@/lib/theme";

describe("GradeBadge", () => {
  it("kolory pasma i wycena francuska", () => {
    render(<ThemeProvider><GradeBadge grade="VI.2+" sort={146} french="6c+" /></ThemeProvider>);
    const badge = screen.getByText("VI.2+");
    expect(badge).toHaveStyle({ backgroundColor: "#F2D9D4", color: "#B23A2B" });
    expect(screen.getByText("6c+")).toBeInTheDocument();
  });

  it("bez wyceny: kreska i podpowiedź", () => {
    render(<ThemeProvider><GradeBadge grade={null} sort={null} /></ThemeProvider>);
    expect(screen.getByTitle("bez wyceny")).toHaveTextContent("—");
  });
});
