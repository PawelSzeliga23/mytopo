import { BADGE_COLORS, gradeBand } from "@/lib/grades";
import { useTheme } from "@/lib/theme";

export function GradeBadge({ grade, sort, french }: { grade: string | null; sort: number | null; french?: string | null }) {
  const { theme } = useTheme();
  const band = gradeBand(sort);
  const colors = band === null ? null : BADGE_COLORS[theme][band];
  return (
    <span
      data-testid="grade"
      title={grade === null ? "bez wyceny" : undefined}
      className={`inline-flex shrink-0 items-baseline gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${colors ? "" : "bg-secondary text-foreground"}`}
      style={colors ? { backgroundColor: colors[0], color: colors[1] } : undefined}
    >
      {grade ?? "—"}
      {french && <span className="font-normal opacity-75">{french}</span>}
    </span>
  );
}
