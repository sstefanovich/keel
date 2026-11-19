import { describe, expect, it } from "vitest";
import { formatAmount, parseAmount, scaleIngredient, servingsCount } from "./scale";

describe("scaling recipes", () => {
  it("reads amounts", () => {
    expect(parseAmount("1 1/2")).toBe(1.5);
    expect(parseAmount("3/4")).toBe(0.75);
    expect(parseAmount("1½")).toBe(1.5);
    expect(parseAmount("½")).toBe(0.5);
    expect(parseAmount("2.5")).toBe(2.5);
  });

  it("writes kitchen amounts", () => {
    expect(formatAmount(0.375)).toBe("⅜");
    expect(formatAmount(1.5)).toBe("1½");
    expect(formatAmount(0.67)).toBe("⅔");
    expect(formatAmount(2.97)).toBe("3");
    expect(formatAmount(212.5, true)).toBe("213");
    expect(formatAmount(2.25, true)).toBe("2.3");
    expect(formatAmount(0.03)).toBe("0.03");
  });

  it("scales the leading amount only", () => {
    expect(scaleIngredient("3/4 cup granulated sugar", 0.5)).toBe("⅜ cup granulated sugar");
    expect(scaleIngredient("1 1/2 cups flour", 2)).toBe("3 cups flour");
    expect(scaleIngredient("425 g pumpkin purée", 0.5)).toBe("213 g pumpkin purée");
    expect(scaleIngredient("1 can (350 ml) evaporated milk", 2)).toBe("2 can (350 ml) evaporated milk");
    expect(scaleIngredient("2-3 cloves garlic", 2)).toBe("4–6 cloves garlic");
    expect(scaleIngredient("½ tsp salt", 3)).toBe("1½ tsp salt");
    expect(scaleIngredient("Salt, to taste", 2)).toBe("Salt, to taste");
    expect(scaleIngredient("3 eggs", 1)).toBe("3 eggs");
  });

  it("reads servings", () => {
    expect(servingsCount("8")).toBe(8);
    expect(servingsCount("6-8 people")).toBe(6);
    expect(servingsCount(4)).toBe(4);
    expect(servingsCount("a crowd")).toBeUndefined();
  });
});
