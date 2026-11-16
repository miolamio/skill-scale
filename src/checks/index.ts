import { body02 } from "./body.ts";
import { desc01, desc02, desc10 } from "./desc.ts";
import { meta01, meta02, meta03, meta05, meta06, meta07 } from "./meta.ts";
import { safe02 } from "./safe.ts";
import { struct02, struct03, struct06, struct07, struct10 } from "./struct.ts";
import { test02 } from "./test.ts";
import type { Check } from "./types.ts";

export const CHECKS: Check[] = [meta01, meta02, meta03, meta05, meta06, meta07, desc01, desc02, desc10, body02, struct02, struct03, struct06, struct07, struct10, safe02, test02];

export const CHECKS_BY_PRACTICE: ReadonlyMap<string, Check> = new Map(CHECKS.map((c) => [c.practice, c]));
