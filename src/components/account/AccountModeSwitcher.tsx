import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAccountMode } from "@/contexts/AccountModeContext";
import { routeForAccountMode, type AccountMode } from "@/lib/accountMode";

export function AccountModeSwitcher({ mobile = false }: { mobile?: boolean }) {
  const navigate = useNavigate();
  const { mode, allowedModes, setMode } = useAccountMode();

  const selectMode = (next: AccountMode) => {
    if (setMode(next)) navigate(routeForAccountMode(next));
  };

  return (
    <div className={cn("rounded-xl border border-primary/30 bg-background/90 p-1", mobile ? "grid w-full grid-cols-3" : "flex")} aria-label="Account mode">
      {allowedModes.map((item) => (
        <Button
          key={item}
          type="button"
          size="sm"
          variant="ghost"
          aria-pressed={mode === item}
          onClick={() => selectMode(item)}
          className={cn("h-8 px-3 text-[11px] font-semibold uppercase tracking-wider", mode === item && "bg-primary text-primary-foreground hover:bg-primary/90")}
        >
          {item}
        </Button>
      ))}
    </div>
  );
}