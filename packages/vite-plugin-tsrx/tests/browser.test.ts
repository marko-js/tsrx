/**
 * Browser integration tests.
 *
 * Each example app is built once, served with a preview/Node server, and then
 * exercised with a headless Chromium browser via playwright-core.  The tests
 * verify that reactive behaviour (counter increments/decrements, todo list
 * add/remove/enter/empty-state) actually works end-to-end in a real browser
 * rather than just asserting on static HTML.
 *
 * basic-spa   – pure client-side SPA, served by `vite preview`
 * marko-run   – SSR + client hydration, served by `node dist/index.mjs`
 */

import { rmSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repo_root = resolve(here, "../../..");
const examples = {
  basic_spa: join(repo_root, "examples/basic-spa"),
  marko_run: join(repo_root, "examples/marko-run"),
};

// ── helpers ────────────────────────────────────────────────────────────────────

function build(dir: string): void {
  execSync("npm run build", { cwd: dir, stdio: "pipe", timeout: 60_000 });
}

/** Poll until something accepts connections on `port` or the timeout expires. */
function wait_for_port(port: number, timeout_ms = 15_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const req = http.get(`http://localhost:${port}/`, (res) => {
        res.destroy();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeout_ms) {
          reject(new Error(`Port ${port} never became ready within ${timeout_ms}ms`));
        } else {
          setTimeout(attempt, 150);
        }
      });
      req.end();
    }
    attempt();
  });
}

// ── basic-spa browser tests ────────────────────────────────────────────────────

describe("browser: basic-spa", () => {
  // Use a non-default port to avoid conflicts with other processes / parallel
  // test runs. Vite's default preview port is 4173.
  const PREVIEW_PORT = 4174;
  let preview_proc: ReturnType<typeof spawn> | null = null;
  let browser: Browser;
  // ctx holds the page so beforeAll can mutate it before any test reads it.
  const ctx: { page: Page } = {} as { page: Page };

  beforeAll(async () => {
    const dist = join(examples.basic_spa, "dist");
    rmSync(dist, { recursive: true, force: true });
    build(examples.basic_spa);

    preview_proc = spawn(
      "npx",
      ["vite", "preview", "--port", String(PREVIEW_PORT), "--strictPort"],
      { cwd: examples.basic_spa, stdio: "pipe" },
    );

    await wait_for_port(PREVIEW_PORT);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PREVIEW_PORT}/`, {
      waitUntil: "networkidle",
    });
    ctx.page = page;
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    preview_proc?.kill();
  });

  // ── page structure ───────────────────────────────────────────────────────────

  it("renders the app heading", async () => {
    await expect(ctx.page.textContent("h1")).resolves.toBe("tsrx demo");
  });

  // ── Counter component ────────────────────────────────────────────────────────

  it("renders Apples counter with initial value 3", async () => {
    const counter = ctx.page.locator(".counter").filter({ hasText: "Apples" });
    await expect(counter.locator(".value").textContent()).resolves.toBe("3");
  });

  it("renders Oranges counter with default initial value 0", async () => {
    const counter = ctx.page.locator(".counter").filter({ hasText: "Oranges" });
    await expect(counter.locator(".value").textContent()).resolves.toBe("0");
  });

  it("increments Apples counter on + click", async () => {
    const counter = ctx.page.locator(".counter").filter({ hasText: "Apples" });
    await counter.locator("button", { hasText: "+" }).click();
    await expect(counter.locator(".value").textContent()).resolves.toBe("4");
  });

  it("decrements Apples counter on − click", async () => {
    // Value is currently 4 after the previous test incremented it.
    const counter = ctx.page.locator(".counter").filter({ hasText: "Apples" });
    await counter.locator("button", { hasText: "−" }).click();
    await expect(counter.locator(".value").textContent()).resolves.toBe("3");
  });

  it("each counter is independent — Oranges unaffected by Apples clicks", async () => {
    const oranges = ctx.page.locator(".counter").filter({ hasText: "Oranges" });
    await expect(oranges.locator(".value").textContent()).resolves.toBe("0");
  });

  // ── TodoList component ───────────────────────────────────────────────────────

  it("renders two initial todo items", async () => {
    await expect(ctx.page.locator(".todo-item").count()).resolves.toBe(2);
  });

  it("removes an item when its × button is clicked", async () => {
    await ctx.page.locator(".todo-item").nth(0).locator("button.remove").click();
    await expect(ctx.page.locator(".todo-item").count()).resolves.toBe(1);
  });

  it("adds a new item via the Add button", async () => {
    await ctx.page.locator("input[type='text']").fill("Buy milk");
    await ctx.page.locator(".add-row button").click();
    await expect(ctx.page.locator(".todo-item").count()).resolves.toBe(2);
    const texts = await ctx.page.locator(".todo-item").allTextContents();
    expect(texts.some((t) => t.includes("Buy milk"))).toBe(true);
  });

  it("adds a new item via the Enter key", async () => {
    // Use pressSequentially so each keystroke fires its own input event,
    // ensuring Marko's valueChange handler updates `draft` before Enter fires.
    await ctx.page.locator("input[type='text']").pressSequentially("Read a book");
    await ctx.page.locator("input[type='text']").press("Enter");
    await ctx.page.waitForFunction(() => document.querySelectorAll(".todo-item").length === 3);
    await expect(ctx.page.locator(".todo-item").count()).resolves.toBe(3);
    const texts = await ctx.page.locator(".todo-item").allTextContents();
    expect(texts.some((t) => t.includes("Read a book"))).toBe(true);
  });

  it("does not add an empty or whitespace-only item", async () => {
    const before = await ctx.page.locator(".todo-item").count();
    await ctx.page.locator("input[type='text']").fill("   ");
    await ctx.page.locator(".add-row button").click();
    await expect(ctx.page.locator(".todo-item").count()).resolves.toBe(before);
  });

  it("clears the input after adding an item", async () => {
    await ctx.page.locator("input[type='text']").fill("Temporary");
    await ctx.page.locator(".add-row button").click();
    await expect(
      ctx.page.locator("input[type='text']").inputValue(),
    ).resolves.toBe("");
  });

  it("shows the empty-state message when all items are removed", async () => {
    const items = ctx.page.locator(".todo-item");
    // Remove items back-to-front so indices stay stable.
    for (let i = (await items.count()) - 1; i >= 0; i--) {
      await items.nth(i).locator("button.remove").click();
    }
    await expect(ctx.page.locator(".empty").textContent()).resolves.toBe(
      "Nothing to do!",
    );
  });
});

// ── marko-run browser tests ────────────────────────────────────────────────────

describe("browser: marko-run", () => {
  const PORT = 3098; // keep clear of the port used in examples.test.ts (3099)
  let server_proc: ReturnType<typeof spawn> | null = null;
  let browser: Browser;
  const ctx: { page: Page } = {} as { page: Page };

  beforeAll(async () => {
    const dist = join(examples.marko_run, "dist");
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

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    ctx.page = page;
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    server_proc?.kill();
  });

  // ── SSR content ──────────────────────────────────────────────────────────────

  it("renders the page heading", async () => {
    await expect(ctx.page.textContent("h1")).resolves.toBe("Marko Run + tsrx");
  });

  it("SSR-renders Apples counter at initial value 3", async () => {
    const counter = ctx.page.locator(".counter").filter({ hasText: "Apples" });
    await expect(counter.locator(".value").textContent()).resolves.toBe("3");
  });

  it("SSR-renders Oranges counter at default value 0", async () => {
    const counter = ctx.page.locator(".counter").filter({ hasText: "Oranges" });
    await expect(counter.locator(".value").textContent()).resolves.toBe("0");
  });

  it("SSR-renders Bananas counter at initial value 7", async () => {
    const counter = ctx.page.locator(".counter").filter({ hasText: "Bananas" });
    await expect(counter.locator(".value").textContent()).resolves.toBe("7");
  });

  // ── client hydration ─────────────────────────────────────────────────────────

  it("increments Apples counter after hydration", async () => {
    const counter = ctx.page.locator(".counter").filter({ hasText: "Apples" });
    await counter.locator("button", { hasText: "+" }).click();
    await expect(counter.locator(".value").textContent()).resolves.toBe("4");
  });

  it("decrements Apples counter after hydration", async () => {
    // Value is 4 after the increment above.
    const counter = ctx.page.locator(".counter").filter({ hasText: "Apples" });
    await counter.locator("button", { hasText: "−" }).click();
    await expect(counter.locator(".value").textContent()).resolves.toBe("3");
  });

  it("counters are independent — Bananas unaffected by Apples clicks", async () => {
    const bananas = ctx.page.locator(".counter").filter({ hasText: "Bananas" });
    await expect(bananas.locator(".value").textContent()).resolves.toBe("7");
  });

  it("can decrement below the initial SSR value", async () => {
    const counter = ctx.page.locator(".counter").filter({ hasText: "Oranges" });
    await counter.locator("button", { hasText: "−" }).click();
    await expect(counter.locator(".value").textContent()).resolves.toBe("-1");
  });
});
