import { Logo } from "@/components/Logo";
import { RouteKindToggle } from "@/components/RouteKindToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import type { AreaProps } from "@/lib/api";
import { SearchBox } from "@/map/SearchBox";

const floating = "rounded-[10px] bg-background shadow-float";

interface Props {
  areas: AreaProps[];
  onPickArea(id: number): void;
  onPickCrag(id: number): void;
}

export function TopBar({ areas, onPickArea, onPickCrag }: Props) {
  return (
    <header className={`absolute inset-x-3 top-3 z-10 flex items-center gap-2 px-3 sm:gap-3 py-2 lg:right-auto lg:w-[600px] ${floating}`}>
      <Logo />
      <SearchBox areas={areas} onPickArea={onPickArea} onPickCrag={onPickCrag} />
      <RouteKindToggle />
      <UserMenu />
      <ThemeToggle />
    </header>
  );
}
