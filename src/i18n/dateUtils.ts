import type { Locale } from "date-fns";
import { enUS } from "date-fns/locale";
import { ptBR } from "date-fns/locale";

export function getDateLocale(language: string): Locale {
  return language.startsWith("pt") ? ptBR : enUS;
}
