import type { Tool } from "@/editor/EditorCanvas";
import { cn } from "@/lib/utils";

export const TOOLS: { tool: Tool; icon: string; label: string; key: string }[] = [
  { tool: "select", icon: "⬉", label: "Zaznacz / przesuń", key: "V" },
  { tool: "line", icon: "✚", label: "Nowa linia", key: "N" },
  { tool: "point", icon: "•", label: "Dodaj punkt", key: "P" },
  { tool: "variant", icon: "⑂", label: "Wariant od punktu", key: "W" },
];

interface Props {
  tool: Tool;
  onTool(tool: Tool): void;
  orientation: "vertical" | "horizontal";
  /** Phone: the ☰ button opening the lines panel. */
  onLines?: () => void;
}

export function Toolbar({ tool, onTool, orientation, onLines }: Props) {
  return (
    <div
      role="toolbar"
      aria-label="Narzędzia edytora"
      className={cn("flex gap-1.5", orientation === "vertical" ? "flex-col" : "justify-around")}
    >
      {TOOLS.map((item) => (
        <button
          key={item.tool}
          type="button"
          aria-label={item.label}
          aria-pressed={tool === item.tool}
          title={`${item.label} (${item.key})`}
          onClick={() => onTool(item.tool)}
          // Never takes focus: Enter (end line) and Space (pan) must reach the editor, not re-press the button.
          onMouseDown={(event) => event.preventDefault()}
          className="grid size-10 place-items-center rounded-md border border-border bg-background text-lg aria-pressed:bg-foreground aria-pressed:text-background"
        >
          {item.icon}
        </button>
      ))}
      {onLines && (
        <button
          type="button"
          aria-label="Linie"
          title="Linie"
          onClick={onLines}
          className="grid size-10 place-items-center rounded-md border border-border bg-background text-lg"
        >
          ☰
        </button>
      )}
    </div>
  );
}
