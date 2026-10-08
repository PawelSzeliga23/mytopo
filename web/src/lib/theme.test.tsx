import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/ThemeToggle";
import { THEME_KEY, ThemeProvider } from "@/lib/theme";

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe("motyw", () => {
  afterEach(() => vi.restoreAllMocks());

  it("przełącza klasę dark i zapamiętuje wybór", async () => {
    renderToggle();
    await userEvent.click(screen.getByRole("button", { name: "Przełącz motyw" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");

    await userEvent.click(screen.getByRole("button", { name: "Przełącz motyw" }));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
  });

  it("startuje od motywu ustawionego przed renderem", () => {
    document.documentElement.classList.add("dark");
    renderToggle();
    expect(screen.getByRole("button", { name: "Przełącz motyw" })).toHaveTextContent("☀");
  });

  it("działa, gdy localStorage rzuca wyjątek", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("zablokowane");
    });
    renderToggle();
    await userEvent.click(screen.getByRole("button", { name: "Przełącz motyw" }));
    expect(document.documentElement).toHaveClass("dark");
  });
});
