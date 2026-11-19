import { describe, expect, it } from "vitest";
import { cookTime, plainText, recipeLayout } from "./recipes";

describe("recipe layout", () => {
  it("splits a recipe note into intro, ingredient groups, steps and notes", () => {
    const r = recipeLayout(
      [
        "# Pumpkin pie",
        "",
        "![](attachments/recipes/pumpkin-pie.jpg)",
        "",
        "A **family** favourite.",
        "",
        "## Ingredients",
        "### Crust",
        "- 1 pie crust",
        "### Filling",
        "- [ ] 2 eggs",
        "- 425 g [pumpkin](https://x.test)",
        "",
        "## Method",
        "1. Heat the oven.",
        "2. Mix everything,",
        "   then pour.",
        "",
        "## Notes",
        "- Less clove next time.",
      ].join("\n"),
    );
    expect(r.intro).toBe("A **family** favourite.");
    expect(r.ingredients).toEqual([
      { label: "Crust", items: ["1 pie crust"] },
      { label: "Filling", items: ["2 eggs", "425 g pumpkin"] },
    ]);
    expect(r.steps).toEqual([{ items: ["Heat the oven.", "Mix everything, then pour."] }]);
    expect(r.others).toEqual([{ heading: "Notes", text: "- Less clove next time." }]);
  });

  it("takes paragraphs as steps and other method headings", () => {
    const r = recipeLayout("## Directions\nToast the bread.\n\nButter it\nwhile hot.\n");
    expect(r.steps).toEqual([{ items: ["Toast the bread.", "Butter it while hot."] }]);
    expect(plainText("Use **2** `cups` of _flour_")).toBe("Use 2 cups of flour");
    expect(cookTime("PT1H30M")).toBe("1 h 30 min");
  });
});
