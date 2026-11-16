// Lists the practices of the given areas that still need anchors and a fix hint, with what the author needs to see.
// Usage: node tools/authoring-todo.ts META DESC TRIG
import { loadCatalogue } from "../src/catalog/load.ts";
import { isMechanicalOnly } from "../src/catalog/types.ts";

const areas = new Set(process.argv.slice(2));
const cat = loadCatalogue(new URL("../catalog/", import.meta.url).pathname);
const todo = cat.practices.filter((p) => areas.has(p.area) && p.inferred !== true);
for (const p of todo) {
  const keys = p.assessable_from === "process" ? "none (fix_hint only)" : isMechanicalOnly(p) ? "0 and 3" : "0, 1, 2 and 3";
  console.log(`\n${p.id}  ${p.title}`);
  console.log(`  strength: ${p.strength}${p.contested ? "  CONTESTED" : ""}   assess: ${p.assess.join("+")}   from: ${p.assessable_from}   profiles: ${p.profiles.join(",")}`);
  console.log(`  anchors needed: ${keys}`);
  for (const q of p.quotes.slice(0, 6)) console.log(`  - [${q.source}${q.older ? ", older" : ""}] ${q.text.slice(0, 160)}`);
}
console.log(`\n${todo.length} practice(s) to author in ${[...areas].join(", ")}`);
