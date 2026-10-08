import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GradeBar } from "@/components/GradeBar";
import { ThemeProvider } from "@/lib/theme";

const renderBar = (bands: number[]) =>
  render(
    <ThemeProvider>
      <GradeBar bands={bands} />
    </ThemeProvider>,
  );

describe("GradeBar", () => {
  it("rysuje segmenty proporcjonalnie", () => {
    renderBar([1, 1, 0, 2]);
    const segments = screen.getAllByTestId("grade-segment");
    expect(segments).toHaveLength(3);
    expect(segments[0]).toHaveStyle({ width: "25%" });
    expect(segments[2]).toHaveStyle({ width: "50%" });
    expect(segments[2]).toHaveAttribute("title", "≥ VI.5: 2");
  });

  it("nic nie rysuje bez dróg z wyceną", () => {
    const { container } = renderBar([0, 0, 0, 0]);
    expect(container).toBeEmptyDOMElement();
  });
});
