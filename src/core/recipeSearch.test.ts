import { describe, expect, it } from "vitest";
import { RecipeDoc, minutesOf, recipeTerms, searchRecipes } from "./recipeSearch";

const doc = (d: Partial<RecipeDoc> & { path: string }): RecipeDoc => ({ title: d.path, ingredients: [], collections: [], text: "", rating: 0, ...d });

const docs = [
  doc({ path: "piccata", title: "Chicken piccata", ingredients: ["4 chicken thighs", "1 lemon", "2 tbsp capers"], rating: 5, minutes: 40 }),
  doc({ path: "roast", title: "Roast chicken", ingredients: ["1 whole chicken", "1 lemon", "rosemary"], rating: 4, minutes: 90 }),
  doc({ path: "tart", title: "Lemon tart", ingredients: ["3 lemons", "4 eggs"], collections: ["Desserts"], rating: 3, minutes: 75 }),
  doc({ path: "moussaka", title: "Moussaka", ingredients: ["2 eggplants", "lamb mince"], text: "Serve with a squeeze of lemon." }),
];
const paths = (q: Parameters<typeof searchRecipes>[1]) => searchRecipes(docs, q).map((h) => h.path);

describe("recipe search", () => {
  it("splits terms on commas, else words", () => {
    expect(recipeTerms(" Chicken  thighs, lemon ")).toEqual(["chicken thighs", "lemon"]);
    expect(recipeTerms("chicken lemon chicken")).toEqual(["chicken", "lemon"]);
  });

  it("ranks recipes with every term first, then partial ones", () => {
    const hits = searchRecipes(docs, { q: "chicken lemon" });
    expect(hits.map((h) => [h.path, h.matched])).toEqual([
      ["piccata", 2],
      ["roast", 2],
      ["tart", 1],
      ["moussaka", 1],
    ]);
    expect(hits[0].ingredients).toEqual(["4 chicken thighs", "1 lemon"]);
    expect(hits[3].elsewhere).toEqual(["lemon"]);
  });

  it("matches words and plurals, and the word being typed as a prefix", () => {
    expect(paths({ q: "egg " })).toEqual(["tart"]);
    expect(paths({ q: "egg, lamb" }).sort()).toEqual(["moussaka", "tart"]); // eggs and lamb, not eggplants
    expect(paths({ q: "thigh" })).toEqual(["piccata"]);
    expect(paths({ q: "dessert " })).toEqual(["tart"]);
    expect(paths({ q: "chick" })).toEqual(["piccata", "roast"]);
    expect(paths({ q: "chick " })).toEqual([]);
  });

  it("filters by rating and time", () => {
    expect(paths({ q: "", minRating: 4 })).toEqual(["piccata", "roast"]);
    expect(paths({ q: "", minRating: -1 })).toEqual(["moussaka"]);
    expect(paths({ q: "lemon", maxMinutes: 60 })).toEqual(["piccata"]);
  });

  it("reads cooking times", () => {
    expect(minutesOf("1 h 20 min")).toBe(80);
    expect(minutesOf("PT1H30M")).toBe(90);
    expect(minutesOf("45 minutes")).toBe(45);
    expect(minutesOf("1 hour 30")).toBe(90);
    expect(minutesOf("1.5 hours")).toBe(90);
    expect(minutesOf("90")).toBe(90);
    expect(minutesOf("overnight")).toBeUndefined();
  });
});
