import { describe, expect, it } from "vitest";
import { ParsedFile } from "../core/parse";
import { cookTime, mailtoUrl, plainText, recipeEmail, recipeLayout } from "./recipes";

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

describe("recipe email", () => {
  const file = (body: string, frontmatter: Record<string, unknown> = {}) => ({ title: "Pumpkin pie", body, frontmatter }) as unknown as ParsedFile;

  it("writes the recipe out with the link to the original", () => {
    const e = recipeEmail(
      file(
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
        { time: "1 h 10 min", servings: 8, source: "https://example.com/pie" },
      ),
    );
    expect(e.subject).toBe("Recipe: Pumpkin pie");
    expect(e.body).toBe(
      [
        "Pumpkin pie",
        "",
        "A family favourite.",
        "",
        "Time: 1 h 10 min   Serves: 8",
        "",
        "INGREDIENTS",
        "",
        "Crust",
        "- 1 pie crust",
        "",
        "Filling",
        "- 2 eggs",
        "- 425 g pumpkin",
        "",
        "METHOD",
        "1. Heat the oven.",
        "2. Mix everything, then pour.",
        "",
        "Original recipe: https://example.com/pie",
        "",
      ].join("\n"),
    );
    expect(e.body).not.toContain("clove");
  });

  it("leaves out what a recipe doesn't have", () => {
    expect(recipeEmail(file("## Ingredients\n- salt")).body).toBe("Pumpkin pie\n\nINGREDIENTS\n- salt\n");
  });

  it("drafts a mailto link with CRLF line breaks", () => {
    expect(mailtoUrl("Recipe: Pie & tart", "a\nb")).toBe("mailto:?subject=Recipe%3A%20Pie%20%26%20tart&body=a%0D%0Ab");
    expect(mailtoUrl("Pie")).toBe("mailto:?subject=Pie");
  });
});
