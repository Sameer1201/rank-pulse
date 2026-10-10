import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ColorMode = "light" | "dark";

type ThemeContextValue = { colorMode: ColorMode; toggleColorMode: () => void };
const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSavedColorMode(): ColorMode {
  try { return localStorage.getItem("theme") === "dark" ? "dark" : "light"; } catch { return "light"; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [colorMode, setColorMode] = useState<ColorMode>(getSavedColorMode);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", colorMode === "dark");
    document.documentElement.style.colorScheme = colorMode;
    try { localStorage.setItem("theme", colorMode); } catch { /* Theme still applies for this session. */ }
  }, [colorMode]);

  const toggleColorMode = () => setColorMode((current) => current === "dark" ? "light" : "dark");
  return <ThemeContext.Provider value={{ colorMode, toggleColorMode }}>{children}</ThemeContext.Provider>;
}

export function useThemeMode() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useThemeMode must be used inside ThemeProvider");
  return value;
}
