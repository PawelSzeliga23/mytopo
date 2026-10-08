import type { ReactNode } from "react";

export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-block rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground">{children}</span>;
}
