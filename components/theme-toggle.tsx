"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type ThemePreference = "light" | "dark" | "system";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function applyTheme(pref: ThemePreference) {
  if (pref === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", pref);
  }
}

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("theme");
    } catch {
      // localStorage unavailable (private mode, etc.) — fall back to system.
    }
    if (stored === "light" || stored === "dark") setPref(stored);
    setMounted(true);
  }, []);

  function choose(next: ThemePreference) {
    setPref(next);
    applyTheme(next);
    try {
      if (next === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {
      // ignore — theme just won't persist across reloads
    }
  }

  // Avoid a hydration mismatch: render the neutral "system" state until
  // mounted, then reflect whatever was actually persisted.
  if (!mounted) return <div className="h-8 w-[88px]" />;

  return (
    <div className="flex items-center rounded-md border border-border p-0.5">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={`Use ${label.toLowerCase()} theme`}
          aria-pressed={pref === value}
          onClick={() => choose(value)}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-sm transition-colors",
            pref === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
