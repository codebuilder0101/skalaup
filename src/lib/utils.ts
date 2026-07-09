import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Capitalize the first letter of each word (and each hyphenated part); rest lowercase. */
function capitalizeNameWord(word: string): string {
  if (!word) return word;
  return word
    .split("-")
    .map((part) => {
      if (!part) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("-");
}

/**
 * Formats a person's full name as the user types (e.g. "ana maria" → "Ana Maria").
 * Preserves a trailing space so typing the next word feels natural.
 */
export function formatFullNameTitleCase(raw: string): string {
  /** Single trailing space after a character (typing next word); not pasted runs of spaces. */
  const keepTrailingSpace = /\S $/.test(raw);
  const core = raw.trim();
  if (!core) return keepTrailingSpace ? " " : "";

  const formatted = core
    .split(/\s+/)
    .map((word) => capitalizeNameWord(word))
    .join(" ");

  return keepTrailingSpace ? `${formatted} ` : formatted;
}
