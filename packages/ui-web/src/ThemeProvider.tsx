import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type Skin = "cream-film" | "cyan-night";
const STORAGE_KEY = "ai-video-studio:skin";
const SkinContext = createContext<{ skin: Skin; toggleSkin: () => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [skin, setSkin] = useState<Skin>(() => {
    try { return window.localStorage.getItem(STORAGE_KEY) === "cyan-night" ? "cyan-night" : "cream-film"; }
    catch { return "cream-film"; }
  });

  useEffect(() => {
    document.documentElement.dataset.skin = skin;
    try { window.localStorage.setItem(STORAGE_KEY, skin); } catch { /* preference may be unavailable */ }
  }, [skin]);

  return <SkinContext.Provider value={{ skin, toggleSkin: () => setSkin(current => current === "cream-film" ? "cyan-night" : "cream-film") }}>{children}</SkinContext.Provider>;
}

export function useSkin() {
  const value = useContext(SkinContext);
  if (!value) throw new Error("ThemeProvider is required");
  return value;
}

export function ThemeToggle() {
  const { skin, toggleSkin } = useSkin();
  const label = skin === "cream-film" ? "切换深色" : "切换暖色";
  return <button className="avs-theme-toggle" type="button" onClick={toggleSkin} aria-label={label}>{label}</button>;
}
