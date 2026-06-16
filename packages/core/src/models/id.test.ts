import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "../errors";
import { type IssueIdParts, nextIssueId, parseIssueId } from "./id";

describe("nextIssueId", () => {
  describe("happy path", () => {
    it("returns REEF-001 when currentMax is 0 (empty repo)", () => {
      expect(nextIssueId({ prefix: "REEF", currentMax: 0 })).toBe("REEF-001");
    });

    it("returns REEF-006 when currentMax is 5 (gap scenario: max+1)", () => {
      expect(nextIssueId({ prefix: "REEF", currentMax: 5 })).toBe("REEF-006");
    });

    it("returns REEF-043 when currentMax is 42", () => {
      expect(nextIssueId({ prefix: "REEF", currentMax: 42 })).toBe("REEF-043");
    });

    it("returns REEF-100 when currentMax is 99 (3+ digit number)", () => {
      expect(nextIssueId({ prefix: "REEF", currentMax: 99 })).toBe("REEF-100");
    });

    it("returns REEF-1000 when currentMax is 999 (overflow — no truncation)", () => {
      expect(nextIssueId({ prefix: "REEF", currentMax: 999 })).toBe(
        "REEF-1000",
      );
    });

    it("returns PROJ-001 when prefix is PROJ and currentMax is 0", () => {
      expect(nextIssueId({ prefix: "PROJ", currentMax: 0 })).toBe("PROJ-001");
    });
  });

  describe("boundary inputs", () => {
    it("throws SchemaValidationError when currentMax is Number.NEGATIVE_INFINITY", () => {
      expect(() =>
        nextIssueId({ prefix: "REEF", currentMax: Number.NEGATIVE_INFINITY }),
      ).toThrow(SchemaValidationError);
    });
  });

  describe("error path", () => {
    it("throws SchemaValidationError when prefix is empty string", () => {
      expect(() => nextIssueId({ prefix: "", currentMax: 0 })).toThrow(
        SchemaValidationError,
      );
    });

    it("throws SchemaValidationError with field 'prefix' for empty prefix", () => {
      try {
        nextIssueId({ prefix: "", currentMax: 0 });
      } catch (err) {
        expect(err).toBeInstanceOf(SchemaValidationError);
        if (err instanceof SchemaValidationError) {
          expect(err.context.field).toBe("prefix");
        }
      }
    });

    it("throws SchemaValidationError when prefix is lowercase (round-trip invariant)", () => {
      expect(() => nextIssueId({ prefix: "reef", currentMax: 0 })).toThrow(
        SchemaValidationError,
      );
    });

    it("throws SchemaValidationError when prefix is mixed case", () => {
      expect(() => nextIssueId({ prefix: "Reef", currentMax: 0 })).toThrow(
        SchemaValidationError,
      );
    });

    it("throws SchemaValidationError when prefix is numeric", () => {
      expect(() => nextIssueId({ prefix: "123", currentMax: 0 })).toThrow(
        SchemaValidationError,
      );
    });

    it("throws SchemaValidationError when prefix contains a dash", () => {
      expect(() => nextIssueId({ prefix: "RE-EF", currentMax: 0 })).toThrow(
        SchemaValidationError,
      );
    });

    it("throws SchemaValidationError when currentMax is negative", () => {
      expect(() => nextIssueId({ prefix: "REEF", currentMax: -1 })).toThrow(
        SchemaValidationError,
      );
    });

    it("throws SchemaValidationError when currentMax is a non-integer", () => {
      expect(() => nextIssueId({ prefix: "REEF", currentMax: 1.5 })).toThrow(
        SchemaValidationError,
      );
    });

    it("throws SchemaValidationError when currentMax is NaN", () => {
      expect(() =>
        nextIssueId({ prefix: "REEF", currentMax: Number.NaN }),
      ).toThrow(SchemaValidationError);
    });

    it("throws SchemaValidationError when currentMax is Infinity", () => {
      expect(() =>
        nextIssueId({
          prefix: "REEF",
          currentMax: Number.POSITIVE_INFINITY,
        }),
      ).toThrow(SchemaValidationError);
    });

    it("records field 'currentMax' in SchemaValidationError context for bad currentMax", () => {
      try {
        nextIssueId({ prefix: "REEF", currentMax: -1 });
      } catch (err) {
        expect(err).toBeInstanceOf(SchemaValidationError);
        if (err instanceof SchemaValidationError) {
          expect(err.context.field).toBe("currentMax");
        }
      }
    });
  });

  describe("round-trip invariant", () => {
    it("every generated ID is parseable back to its inputs", () => {
      const cases: Array<{ prefix: string; currentMax: number }> = [
        { prefix: "REEF", currentMax: 0 },
        { prefix: "REEF", currentMax: 42 },
        { prefix: "REEF", currentMax: 99 },
        { prefix: "REEF", currentMax: 999 },
        { prefix: "PROJ", currentMax: 7 },
      ];
      for (const { prefix, currentMax } of cases) {
        const id = nextIssueId({ prefix, currentMax });
        const parts: IssueIdParts = parseIssueId(id);
        expect(parts.prefix).toBe(prefix);
        expect(parts.number).toBe(currentMax + 1);
      }
    });
  });
});

describe("parseIssueId", () => {
  describe("happy path", () => {
    it("parses REEF-001 into { prefix: 'REEF', number: 1 }", () => {
      expect(parseIssueId("REEF-001")).toEqual({ prefix: "REEF", number: 1 });
    });

    it("parses REEF-042 into { prefix: 'REEF', number: 42 }", () => {
      expect(parseIssueId("REEF-042")).toEqual({ prefix: "REEF", number: 42 });
    });

    it("parses REEF-100 into { prefix: 'REEF', number: 100 }", () => {
      expect(parseIssueId("REEF-100")).toEqual({ prefix: "REEF", number: 100 });
    });

    it("parses PROJ-001 into { prefix: 'PROJ', number: 1 }", () => {
      expect(parseIssueId("PROJ-001")).toEqual({ prefix: "PROJ", number: 1 });
    });

    it("parses REEF-1000 into { prefix: 'REEF', number: 1000 } (large number)", () => {
      expect(parseIssueId("REEF-1000")).toEqual({
        prefix: "REEF",
        number: 1000,
      });
    });

    it("parses REEF-01 into { prefix: 'REEF', number: 1 } (non-canonical leading zero is accepted by parser)", () => {
      // Canonical form (REEF-001) is enforced at generation time via padStart.
      // The parser intentionally accepts non-canonical leading-zeros for resilience.
      expect(parseIssueId("REEF-01")).toEqual({ prefix: "REEF", number: 1 });
    });
  });

  describe("error path — all should throw SchemaValidationError", () => {
    it("throws on empty string", () => {
      expect(() => parseIssueId("")).toThrow(SchemaValidationError);
    });

    it("throws on 'invalid' (no dash)", () => {
      expect(() => parseIssueId("invalid")).toThrow(SchemaValidationError);
    });

    it("throws on 'REEF-' (no number after dash)", () => {
      expect(() => parseIssueId("REEF-")).toThrow(SchemaValidationError);
    });

    it("throws on '-042' (no prefix before dash)", () => {
      expect(() => parseIssueId("-042")).toThrow(SchemaValidationError);
    });

    it("throws on 'reef-042' (lowercase prefix is invalid)", () => {
      expect(() => parseIssueId("reef-042")).toThrow(SchemaValidationError);
    });

    it("throws on 'REEF-abc' (non-numeric suffix)", () => {
      expect(() => parseIssueId("REEF-abc")).toThrow(SchemaValidationError);
    });

    it("throws on 'REEF-0' (zero is not a valid issue number)", () => {
      expect(() => parseIssueId("REEF-0")).toThrow(SchemaValidationError);
    });

    it("throws on 'REEF-00' (zero-padded zero — still parses to 0, not a valid issue number)", () => {
      expect(() => parseIssueId("REEF-00")).toThrow(SchemaValidationError);
    });

    it("throws on '123-042' (numeric prefix — only alpha A-Z allowed)", () => {
      expect(() => parseIssueId("123-042")).toThrow(SchemaValidationError);
    });
  });
});
