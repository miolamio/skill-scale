import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { Catalogue, CatalogueMeta, LoadFact, Practice, Source } from "./types.ts";
import { validateLoadFacts, validatePractices, validateSources } from "./schema.ts";

export class CatalogueError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`catalogue is invalid:\n  ${problems.join("\n  ")}`);
    this.name = "CatalogueError";
    this.problems = problems;
  }
}

function readYaml(dir: string, file: string): unknown {
  try {
    return parse(readFileSync(join(dir, file), "utf8"));
  } catch (e) {
    throw new CatalogueError([`${file}: ${(e as Error).message}`]);
  }
}

export function loadCatalogue(dir: string): Catalogue {
  const meta = readYaml(dir, "meta.yaml") as CatalogueMeta;
  const sources = readYaml(dir, "sources.yaml");
  const practices = readYaml(dir, "practices.yaml");
  const facts = readYaml(dir, "load-facts.yaml");
  const problems: string[] = [];
  if (typeof meta?.revision !== "number") problems.push("meta.yaml: revision must be a number");
  problems.push(...validateSources(sources), ...validateLoadFacts(facts));
  const ids = new Set(Array.isArray(sources) ? (sources as Source[]).map((s) => s.id) : []);
  problems.push(...validatePractices(practices, ids));
  if (problems.length > 0) throw new CatalogueError(problems);
  return { meta, sources: sources as Source[], practices: practices as Practice[], load_facts: facts as LoadFact[] };
}
