import { describe, it, expect } from "vitest";
import { formatFullNameTitleCase } from "./utils";

describe("formatFullNameTitleCase", () => {
  it("capitalizes each word", () => {
    expect(formatFullNameTitleCase("ana silva")).toBe("Ana Silva");
    expect(formatFullNameTitleCase("ANA COSTA")).toBe("Ana Costa");
  });

  it("handles hyphenated parts", () => {
    expect(formatFullNameTitleCase("jean-pierre")).toBe("Jean-Pierre");
  });

  it("preserves trailing space while typing", () => {
    expect(formatFullNameTitleCase("ana ")).toBe("Ana ");
  });

  it("trims leading space and collapses internal gaps", () => {
    expect(formatFullNameTitleCase("  maria   santos  ")).toBe("Maria Santos");
  });
});
