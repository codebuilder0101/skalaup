// Brazilian document/contact formatting + validation helpers used by the
// restaurant and freelancer registration forms.
//
// Masks are applied progressively as the user types (so partial input stays
// readable); validators check the canonical digit counts. CPF/CNPJ here validate
// length only (not the check-digit algorithm) — enough to catch typos at the form
// level while keeping the helpers small and dependency-free.

const digits = (v: string) => v.replace(/\D/g, "");

// ---- CPF — 000.000.000-00 (11 digits) -------------------------------------
export function maskCpf(v: string): string {
  const d = digits(v).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
}
export const isValidCpf = (v: string) => digits(v).length === 11;

// ---- CNPJ — 00.000.000/0000-00 (14 digits) --------------------------------
export function maskCnpj(v: string): string {
  const d = digits(v).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, "$1.$2.$3/$4-$5");
}
export const isValidCnpj = (v: string) => digits(v).length === 14;

// ---- CEP — 00000-000 (8 digits) -------------------------------------------
export function maskCep(v: string): string {
  const d = digits(v).slice(0, 8);
  return d.replace(/^(\d{5})(\d)/, "$1-$2");
}
export const isValidCep = (v: string) => digits(v).length === 8;

// ---- Phone / WhatsApp — (00) 00000-0000 / (00) 0000-0000 ------------------
export function maskPhone(v: string): string {
  const d = digits(v).slice(0, 11);
  if (d.length <= 10) {
    return d
      .replace(/^(\d{2})(\d)/, "($1) $2")
      .replace(/^\((\d{2})\)\s(\d{4})(\d)/, "($1) $2-$3");
  }
  return d
    .replace(/^(\d{2})(\d)/, "($1) $2")
    .replace(/^\((\d{2})\)\s(\d{5})(\d)/, "($1) $2-$3");
}
export const isValidPhone = (v: string) => {
  const n = digits(v).length;
  return n === 10 || n === 11;
};
