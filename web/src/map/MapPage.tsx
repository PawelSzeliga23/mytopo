import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function MapPage() {
  return (
    <div className="flex items-center gap-4 p-4">
      <Logo />
      <ThemeToggle />
    </div>
  );
}
