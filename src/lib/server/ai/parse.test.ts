import { describe, expect, it } from "vitest";
import { ActionError } from "@/lib/server/errors";
import { asNumber, asObjectArray, asStringArray, clampScore, parseJsonObject } from "@/lib/server/ai/parse";

describe("AI response parsing", () => {
  it("parses JSON objects, including fenced JSON", () => {
    expect(parseJsonObject('{"title":"Brief"}')).toEqual({ title: "Brief" });
    expect(parseJsonObject('```json\n{"title":"Brief"}\n```')).toEqual({ title: "Brief" });
  });

  it.each(["", "not json", "[]", "null", "\"text\""])('rejects invalid object payload %j', (input) => {
    expect(() => parseJsonObject(input)).toThrow(ActionError);
  });

  it("normalizes untrusted field values and bounds list output", () => {
    expect(asStringArray(["  React ", null, "", "Node"], 1)).toEqual(["React"]);
    expect(asObjectArray([{ id: 1 }, null, [], "x"], 2)).toEqual([{ id: 1 }]);
    expect(asNumber("12.5")).toBe(12.5);
    expect(asNumber("NaN")).toBeNull();
    expect(clampScore(130)).toBe(100);
    expect(clampScore(-4)).toBe(0);
  });
});
