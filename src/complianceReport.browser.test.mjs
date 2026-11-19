import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import test from "node:test";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function findBrowserExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  return candidates.find((candidate) => {
    try {
      require("node:fs").accessSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
}

test("restored reports render, scope correctly and export Excel in the browser", async (context) => {
  const browserExecutable = findBrowserExecutable();
  if (!browserExecutable) {
    context.skip("Chrome or Edge is required for this browser component test.");
    return;
  }

  const port = await getFreePort();
  const fixtureUrl = `http://127.0.0.1:${port}/test/compliance-report.fixture.html`;
  const browserDataDir = await mkdtemp(path.join(os.tmpdir(), "visaflow-request-select-"));
  const { createServer } = await import("vite");
  const viteServer = await createServer({
    cacheDir: path.join(browserDataDir, "vite-cache"),
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
    },
  });

  try {
    await viteServer.listen();
    await waitForServer(fixtureUrl);
    const { stdout } = await execFileAsync(browserExecutable, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-extensions",
      `--user-data-dir=${browserDataDir}`,
      "--virtual-time-budget=15000",
      "--dump-dom",
      fixtureUrl,
    ], { maxBuffer: 5 * 1024 * 1024, windowsHide: true });

    const errorMatch = stdout.match(/data-test-error="([^"]+)"/);
    if (errorMatch) {
      assert.fail(Buffer.from(errorMatch[1], "base64").toString("utf8"));
    }

    const resultMatch = stdout.match(/data-test-result="([^"]+)"/);
    assert.ok(resultMatch, "The browser fixture did not produce a test result.");
    const result = JSON.parse(Buffer.from(resultMatch[1], "base64").toString("utf8"));

    assert.equal(result.preview, true);
    assert.deepEqual(result.downloads, ['Tawteen_Occupation_Localization_Report.xlsx','Saudi_Workforce_Nitaqat_Report.xlsx']);
  } finally {
    await viteServer.close();
    await rm(browserDataDir, { recursive: true, force: true });
  }
});
