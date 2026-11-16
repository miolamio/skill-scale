import { readdirSync } from "node:fs";
import type { BadFixture } from "./skills.ts";

const dir = new URL("./bad/", import.meta.url);

/** Every bad fixture, from tests/helpers/bad/*.ts. Each file breaks the rules of one area. */
export const BAD_FIXTURES: BadFixture[] = (
  await Promise.all(
    readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .sort()
      .map(async (f) => ((await import(new URL(f, dir).href)) as { default: BadFixture[] }).default),
  )
).flat();
