import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const directory = await mkdtemp(join(process.cwd(), ".ui-tests-"));
try {
  const outfile = join(directory, "report-tag-filters.test.mjs");
  await build({
    entryPoints: ["tests/ui/report-tag-filters.test.tsx"],
    outfile,
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    jsx: "automatic",
    logLevel: "warning",
  });
  const result = spawnSync(
    process.execPath,
    ["--import", new URL("./test-ui-dom.mjs", import.meta.url).href, "--test", outfile],
    { stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
