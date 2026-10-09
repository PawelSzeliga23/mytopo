import type { Draft, DraftLine } from "@/editor/types";

const letter = (index: number) => (index < 26 ? String.fromCharCode(97 + index) : `z${index - 25}`);

/** Root of a variant chain inside the draft; stops on broken data (cycles, missing parents). */
function rootOf(line: DraftLine, lines: Map<string, DraftLine>): DraftLine {
  const seen = new Set<string>();
  let current = line;
  while (current.parent && !seen.has(current.key)) {
    seen.add(current.key);
    const parent = lines.get(current.parent.lineKey);
    if (!parent) break;
    current = parent;
  }
  return current;
}

/** Topo numbers of the draft's lines, by the viewer's rule: top-level lines 1, 2, 3… in order; variants "5a", "5b". */
export function draftLabels(draft: Draft): Map<string, string> {
  const lines = new Map(draft.lines.map((line) => [line.key, line]));
  const groups = new Map<string, DraftLine[]>();
  for (const line of draft.lines) {
    const root = rootOf(line, lines);
    groups.set(root.key, [...(groups.get(root.key) ?? []), line]);
  }
  const labels = new Map<string, string>();
  draft.lines
    .filter((line) => groups.has(line.key))
    .forEach((root, index) => {
      const number = String(index + 1);
      labels.set(root.key, number);
      (groups.get(root.key) ?? [])
        .filter((line) => line.key !== root.key)
        .forEach((line, i) => labels.set(line.key, `${number}${letter(i)}`));
    });
  return labels;
}
