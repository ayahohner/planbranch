import { describe, expect, it } from "vitest";
import { shouldFitRoot } from "./viewport-policy";

describe("canvas viewport policy", () => {
  it("fits the initial tree", () => {
    expect(shouldFitRoot(null, "root-a")).toBe(true);
  });

  it("preserves the viewport when nodes change within the same tree", () => {
    expect(shouldFitRoot("root-a", "root-a")).toBe(false);
  });

  it("fits a replacement tree", () => {
    expect(shouldFitRoot("root-a", "root-b")).toBe(true);
  });
});
