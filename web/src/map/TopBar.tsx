import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

const floating = "rounded-[10px] bg-background shadow-[0_4px_14px_rgba(43,36,32,0.18)]";

export function TopBar() {
  return (
    <header className={`absolute inset-x-3 top-3 z-10 flex items-center gap-3 px-3 py-2 lg:right-auto lg:w-[520px] ${floating}`}>
      <Logo />
      <input
        type="search"
        disabled
        placeholder="Szukaj skały lub drogi…"
        title="Wyszukiwarka w przygotowaniu"
        className="min-w-0 flex-1 rounded-md border border-input bg-card px-3 py-1.5 text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
      <ThemeToggle />
    </header>
  );
}
