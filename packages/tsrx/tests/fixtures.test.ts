import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures_root = join(here, "fixtures");

const fixtures = readdirSync(fixtures_root)
  .filter((name) => statSync(join(fixtures_root, name)).isDirectory())
  .sort();

function snapshotError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function snapshotUpdateAll(): boolean {
  const { snapshotState } = expect.getState() as {
    snapshotState?: { snapshotUpdateState: "all" | "new" | "none" };
  };
  return snapshotState?.snapshotUpdateState === "all";
}

describe("@marko/tsrx fixtures", () => {
  for (const name of fixtures) {
    it(name, async () => {
      const dir = join(fixtures_root, name);
      const source = readFileSync(join(dir, "index.tsrx"), "utf8");
      try {
        const { code } = compile(source, "index.tsrx");
        await expect(code).toMatchFileSnapshot(
          join(dir, "__snapshots__", "index.marko"),
        );
        if (snapshotUpdateAll()) {
          rmSync(join(dir, "__snapshots__", "error.txt"), { force: true });
        }
      } catch (err) {
        if (snapshotUpdateAll()) {
          const snapDir = join(dir, "__snapshots__");
          if (existsSync(snapDir)) {
            for (const snapName of readdirSync(snapDir)) {
              if (snapName.endsWith(".marko")) {
                rmSync(join(snapDir, snapName), { force: true });
              }
            }
          }
        }
        await expect(snapshotError(err)).toMatchFileSnapshot(
          join(dir, "__snapshots__", "error.txt"),
        );
      }
    });
  }
});
