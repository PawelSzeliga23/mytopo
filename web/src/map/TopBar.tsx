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

/** Phone: logo, filter and menu in the first row, the search in a full-width row below; from `md` up one row. */
export function TopBar({ areas, onPickArea, onPickCrag }: Props) {
  return (
    <header className={`absolute inset-x-3 top-3 z-10 flex flex-wrap items-center gap-2 px-3 py-2 sm:gap-3 md:flex-nowrap lg:right-auto lg:w-[820px] ${floating}`}>
      <Logo />
      <div className="order-last flex min-w-0 basis-full md:order-none md:flex-1 md:basis-auto">
        <SearchBox areas={areas} onPickArea={onPickArea} onPickCrag={onPickCrag} />
      </div>
      <div className="ml-auto flex items-center gap-2 sm:gap-3 md:ml-0">
        <RouteKindToggle />
        <UserMenu />
        <ThemeToggle />
      </div>
    </header>
  );
}
