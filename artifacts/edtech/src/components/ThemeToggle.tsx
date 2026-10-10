import { Moon, Sun } from "lucide-react";
import { useThemeMode } from "@/contexts/ThemeContext";

export function ThemeToggle() {
  const { colorMode, toggleColorMode } = useThemeMode();

  return (
    <button
      type="button"
      onClick={toggleColorMode}
      aria-label={`Switch to ${colorMode === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${colorMode === "dark" ? "light" : "dark"} mode`}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card p-0 text-foreground shadow-sm transition hover:bg-muted"
      data-testid="theme-toggle"
    >
      {colorMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
