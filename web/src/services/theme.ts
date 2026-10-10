export type Theme = {
  accent: string;
  background: string;
  surface: string;
  text: string;
};

export const defaultTheme: Theme = {
  accent: "#c36b46",
  background: "#f7f5f0",
  surface: "#fffdf9",
  text: "#24221f",
};

const themeStorageKey = "amadeus_theme";
const colorPattern = /^#[0-9a-f]{6}$/i;

function isTheme(value: unknown): value is Theme {
  if (!value || typeof value !== "object") return false;
  const theme = value as Partial<Theme>;
  return (
    typeof theme.accent === "string" &&
    colorPattern.test(theme.accent) &&
    typeof theme.background === "string" &&
    colorPattern.test(theme.background) &&
    typeof theme.surface === "string" &&
    colorPattern.test(theme.surface) &&
    typeof theme.text === "string" &&
    colorPattern.test(theme.text)
  );
}

export function loadTheme(): Theme {
  try {
    const stored = JSON.parse(localStorage.getItem(themeStorageKey) ?? "null");
    return isTheme(stored) ? stored : { ...defaultTheme };
  } catch {
    return { ...defaultTheme };
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.style.setProperty("--theme-accent", theme.accent);
  root.style.setProperty("--theme-background", theme.background);
  root.style.setProperty("--theme-surface", theme.surface);
  root.style.setProperty("--theme-text", theme.text);
}

export function saveTheme(theme: Theme) {
  localStorage.setItem(themeStorageKey, JSON.stringify(theme));
  applyTheme(theme);
}
