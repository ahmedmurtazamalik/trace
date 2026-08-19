"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "night";
const storageKey = "trace-theme";

function storedTheme(): Theme {
  const documentTheme = document.documentElement.dataset.theme;
  if (documentTheme === "light" || documentTheme === "night") return documentTheme;
  try {
    const value = window.localStorage.getItem(storageKey);
    if (value === "light" || value === "night") return value;
  } catch {}
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "night" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const initial = storedTheme();
    document.documentElement.dataset.theme = initial;
    setTheme(initial);
  }, []);

  function toggle() {
    const next: Theme = theme === "night" ? "light" : "night";
    document.documentElement.dataset.theme = next;
    try { window.localStorage.setItem(storageKey, next); } catch {}
    setTheme(next);
  }

  const night = theme === "night";
  return <button className="theme-toggle" type="button" onClick={toggle} aria-label={night ? "Use light mode" : "Use night mode"} title={night ? "Use light mode" : "Use terminal night mode"}>
    {night ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    <span>{night ? "Light" : "Night"}</span>
  </button>;
}
