import { BAND_COLORS, BAND_LABELS } from "@/lib/grades";
import { useTheme } from "@/lib/theme";

export function GradeBar({ bands }: { bands: number[] }) {
  const { theme } = useTheme();
  const total = bands.reduce((sum, value) => sum + value, 0);
  if (total === 0) return null;
  return (
    <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-label="Rozkład trudności">
      {bands.map((count, band) =>
        count > 0 ? (
          <span
            key={band}
            data-testid="grade-segment"
            title={`${BAND_LABELS[band]}: ${count}`}
            className="block h-full rounded-sm"
            style={{ width: `${(count / total) * 100}%`, backgroundColor: BAND_COLORS[theme][band] }}
          />
        ) : null,
      )}
    </div>
  );
}
