import type { BadFixture } from "../skills.ts";
import { bad, variant } from "../skills.ts";

export default [
  bad("SAFE-02", "claude-code", "token in a script", variant({ "scripts/deploy.sh": `#!/bin/sh\nexport GITHUB_TOKEN=${"ghp_"}${"aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD2fH4jL6"}\n` })),
] satisfies BadFixture[];
