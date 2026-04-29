/**
 * Integration tests that verify each example app:
 *  1. Builds without errors
 *  2. Produces expected output artifacts
 *  3. (marko-run) Starts a server and serves correct SSR HTML
 *
 * These tests run against the real workspace examples, so they catch
 * breakage caused by changes in @marko/tsrx or @marko/vite-plugin-tsrx.
 */

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repo_root = resolve(here, "../../..");
const examples = {
  basic_spa: join(repo_root, "examples/basic-spa"),
  marko_run: join(repo_root, "examples/marko-run"),
};

// ── helpers ────────────────────────────────────────────────────────────────────

function build(example_dir: string): void {
  execSync("npm run build", {
    cwd: example_dir,
    stdio: "pipe",
    timeout: 60_000,
  });
}

function read_js_bundle(dist: string): string {
  const assets_dir = join(dist, "assets");
  if (!existsSync(assets_dir)) return "";
  return readdirSync(assets_dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(assets_dir, f), "utf8"))
    .join("\n");
}

function fetch_text(url: string, timeout_ms = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve(body));
    });
    req.setTimeout(timeout_ms, () => {
      req.destroy(new Error(`Request to ${url} timed out after ${timeout_ms}ms`));
    });
    req.on("error", reject);
  });
}

function wait_for_port(port: number, timeout_ms = 10_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const req = http.get(`http://localhost:${port}/`, (res) => {
        res.destroy();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeout_ms) {
          reject(new Error(`Server on port ${port} did not start within ${timeout_ms}ms`));
        } else {
          setTimeout(attempt, 200);
        }
      });
      req.end();
    }
    attempt();
  });
}

// ── basic-spa ──────────────────────────────────────────────────────────────────

describe("example: basic-spa", () => {
  const dist = join(examples.basic_spa, "dist");

  beforeAll(() => {
    rmSync(dist, { recursive: true, force: true });
    build(examples.basic_spa);
  });

  it("produces dist/index.html", () => {
    expect(existsSync(join(dist, "index.html"))).toBe(true);
  });

  it("dist/index.html references a JS asset", () => {
    const html = readFileSync(join(dist, "index.html"), "utf8");
    expect(html).toMatch(/src="\/assets\/.*\.js"/);
  });

  it("built JS bundle contains Counter component output", () => {
    const bundle = read_js_bundle(dist);
    expect(bundle).toContain("counter");
    expect(bundle).toContain("label");
    expect(bundle).toContain("Apples");
    expect(bundle).toContain("Oranges");
  });

  it("built JS bundle contains TodoList component output", () => {
    const bundle = read_js_bundle(dist);
    expect(bundle).toContain("Todo");
    expect(bundle).toContain("groceries");
  });
});

// ── marko-run ─────────────────────────────────────────────────────────────────

describe("example: marko-run", () => {
  const dist = join(examples.marko_run, "dist");
  const PORT = 3099; // non-default port to avoid conflicts with other processes

  let server_proc: ReturnType<typeof spawn> | null = null;

  beforeAll(async () => {
    rmSync(dist, { recursive: true, force: true });
    build(examples.marko_run);

    server_proc = spawn(
      process.execPath,
      ["--enable-source-maps", "./dist/index.mjs"],
      {
        cwd: examples.marko_run,
        env: { ...process.env, PORT: String(PORT) },
        stdio: "pipe",
      },
    );

    await wait_for_port(PORT);
  });

  afterAll(() => {
    server_proc?.kill();
  });

  it("produces dist/index.mjs server entry", () => {
    expect(existsSync(join(dist, "index.mjs"))).toBe(true);
  });

  it("produces at least one client JS asset", () => {
    const assets_dir = join(dist, "public/assets");
    const js_files = existsSync(assets_dir)
      ? readdirSync(assets_dir).filter((f) => f.endsWith(".js"))
      : [];
    expect(js_files.length).toBeGreaterThan(0);
  });

  it("server responds with HTML", async () => {
    const html = await fetch_text(`http://localhost:${PORT}/`);
    expect(html).toBeTruthy();
  });

  it("server renders the page title", async () => {
    const html = await fetch_text(`http://localhost:${PORT}/`);
    expect(html).toContain("Marko Run + tsrx");
  });

  it("server SSR-renders Counter components with correct initial values", async () => {
    const html = await fetch_text(`http://localhost:${PORT}/`);
    // Apples starts at 3, Oranges at 0 (default), Bananas at 7
    expect(html).toContain("Apples");
    expect(html).toContain(">3<");
    expect(html).toContain("Oranges");
    expect(html).toContain(">0<");
    expect(html).toContain("Bananas");
    expect(html).toContain(">7<");
  });

  it("server renders decrement and increment buttons", async () => {
    const html = await fetch_text(`http://localhost:${PORT}/`);
    expect(html).toContain("−");
    expect(html).toContain("+");
  });
});
