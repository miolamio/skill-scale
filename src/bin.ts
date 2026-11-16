#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { httpFetcher } from "./catalog/fetcher.ts";
import { main } from "./cli.ts";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

process.exitCode = await main(process.argv.slice(2), {
  stdout: (s) => void process.stdout.write(s),
  stderr: (s) => void process.stderr.write(s),
  fetcher: httpFetcher,
  catalogDir: fileURLToPath(new URL("../catalog/", import.meta.url)),
  version: pkg.version,
});
