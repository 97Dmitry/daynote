import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { errorText } from "./types";
export type ThemeMode = "system" | "light" | "dark";
const valid = (value: unknown): value is ThemeMode =>
  value === "system" || value === "light" || value === "dark";
const cached = (): ThemeMode => {
  try {
    const v = localStorage.getItem("daynote.theme");
    return valid(v) ? v : "system";
  } catch {
    return "system";
  }
};
const ThemeContext = createContext<{
  mode: ThemeMode;
  pending: boolean;
  error: string;
  change: (mode: ThemeMode) => Promise<void>;
} | null>(null);
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(cached),
    [systemDark, setSystemDark] = useState(
      () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    ),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const revision = useRef(0);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setSystemDark(media.matches);
    media.addEventListener("change", listener);
    listener();
    return () => media.removeEventListener("change", listener);
  }, []);
  useEffect(() => {
    let active = true;
    const version = revision.current;
    api
      .settings()
      .then((s) => {
        if (active && version === revision.current && valid(s.theme)) setMode(s.theme);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const resolved = mode === "system" ? (systemDark ? "dark" : "light") : mode;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.colorScheme = resolved;
    document.documentElement.style.colorScheme = resolved;
    api.windowTheme(mode);
    try {
      localStorage.setItem("daynote.theme", mode);
    } catch {
      /* UI cache is optional; Go persists the preference. */
    }
  }, [mode, systemDark]);
  const change = async (next: ThemeMode) => {
    revision.current++;
    setPending(true);
    setError("");
    try {
      await api.setTheme(next);
      setMode(next);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <ThemeContext.Provider value={{ mode, pending, error, change }}>
      {children}
    </ThemeContext.Provider>
  );
}
export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("ThemeProvider is required");
  return value;
}
export function ThemeSelect() {
  const theme = useTheme();
  return (
    <label className="theme-picker">
      Оформление
      <select
        aria-label="Оформление"
        value={theme.mode}
        disabled={theme.pending}
        onChange={(e) => {
          if (valid(e.target.value)) void theme.change(e.target.value);
        }}
      >
        <option value="system">Как в системе</option>
        <option value="light">Светлое</option>
        <option value="dark">Тёмное</option>
      </select>
      {theme.error && (
        <span className="danger" role="alert">
          {theme.error}
        </span>
      )}
    </label>
  );
}
