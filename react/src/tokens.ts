/**
 * Unoverse style vocabulary → CSS values (web renderer).
 *
 * A small, fixed token set — the part that is native-per-platform. (Later this
 * is sourced from shared design tokens; for v0 it's a sensible inline set.)
 */
import type { CSSProperties } from "react";

export const spacing: Record<string, string> = {
  xs: "4px",
  sm: "12px",
  md: "16px",
  lg: "24px",
  xl: "32px",
};

export const colors: Record<string, string> = {
  "text-primary": "#111827",
  "text-secondary": "#4b5563",
  muted: "#6b7280",
  surface: "#ffffff",
};

export const fonts: Record<string, CSSProperties> = {
  "headline-sm": { fontSize: "1.25rem", lineHeight: 1.3 },
  title: { fontSize: "1.125rem", lineHeight: 1.3 },
  "body-md": { fontSize: "1rem", lineHeight: 1.6 },
  body: { fontSize: "1rem", lineHeight: 1.6 },
};

export const shadows: Record<string, string> = {
  lg: "0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)",
};

export const radii: Record<string, string> = { sm: "4px", md: "8px", lg: "12px" };
export const borders: Record<string, string> = { subtle: "1px solid #e5e7eb" };

/** Brand button (matches the SAB-red primary). */
export function buttonStyle(variant = "primary"): CSSProperties {
  const base: CSSProperties = {
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
    padding: "12px 24px",
    borderRadius: radii.sm,
  };
  if (variant === "primary") return { ...base, background: "#d81e2c", color: "#ffffff" };
  if (variant === "outline") return { ...base, background: "transparent", border: "2px solid #d81e2c", color: "#d81e2c" };
  return base;
}
