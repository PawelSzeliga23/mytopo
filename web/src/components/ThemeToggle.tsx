import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="ghost" size="icon" aria-label="Przełącz motyw" onClick={toggle}>
      <span aria-hidden>{theme === "dark" ? "☀" : "☾"}</span>
    </Button>
  );
}
