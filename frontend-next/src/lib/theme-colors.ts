/** Mirrors `--bg` in coedit-theme.css. Browser chrome (<meta name="theme-color">) cannot read CSS
 *  variables, so this is the one place these values are repeated. Keep in sync with the theme file. */
export const THEME_COLOR = { light: "#FAFBFC", dark: "#08090A" } as const;
