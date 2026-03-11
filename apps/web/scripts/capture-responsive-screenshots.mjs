import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { config as loadEnv } from "dotenv";
import { chromium } from "playwright-core";

loadEnv({ path: path.resolve(process.cwd(), ".env.visual-qa") });

const appDir = process.cwd();
const outputDir = path.resolve(appDir, ".artifacts/screenshots");
const authProfileDir = path.resolve(appDir, ".artifacts/visual-qa-profile");
const executablePath = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const baseUrl = process.env.SCREENSHOT_BASE_URL || "http://127.0.0.1:4173";
const seededNsec = process.env.VITE_VISUAL_QA_NSEC || null;
const airlineName = process.env.VITE_VISUAL_QA_AIRLINE_NAME || "Open Skies QA";
const airlineIcao = process.env.VITE_VISUAL_QA_ICAO || "OSQ";
const airlineCallsign = process.env.VITE_VISUAL_QA_CALLSIGN || "OPEN SKIES";
const widths = [390, 768, 1024, 1440];
const guestRoutes = [
  { slug: "home-map", path: "/" },
  { slug: "home-cockpit", path: "/?panel=cockpit" },
  { slug: "planning", path: "/network?tab=active" },
  { slug: "airport-jfk", path: "/airport/JFK" },
  { slug: "aircraft-demo", path: "/aircraft/demo-aircraft" },
  { slug: "fleet", path: "/fleet" },
  { slug: "finance", path: "/corporate?section=overview" },
];
const authRoutes = [
  { slug: "auth-home-map", path: "/" },
  { slug: "auth-home-cockpit", path: "/?panel=cockpit" },
  { slug: "auth-planning", path: "/network?tab=active" },
  { slug: "auth-fleet", path: "/fleet" },
  { slug: "auth-finance", path: "/corporate?section=overview" },
  { slug: "auth-airport-jfk", path: "/airport/JFK" },
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling
    }

    await delay(500);
  }

  throw new Error(`Server at ${url} did not become ready in time.`);
}

async function openReadyPage(page, routePath) {
  await page.goto(`${baseUrl}${routePath}`, {
    waitUntil: "domcontentloaded",
  });
  await page.addStyleTag({
    content:
      "[data-sonner-toaster], [data-sonner-toast], [data-rich-colors='true'] { display: none !important; }",
  });
  await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
  await page.waitForTimeout(1200);
}

async function captureRoutes(context, routes, width) {
  for (const route of routes) {
    const page = await context.newPage();
    await openReadyPage(page, route.path);
    await page.screenshot({
      path: path.join(outputDir, `${route.slug}-${width}.png`),
      fullPage: true,
    });
    await page.close();
  }
}

async function ensureNsecLogin(page) {
  if (!seededNsec) return;

  const accessCardToggle = page
    .getByRole("button", { name: /i already have an nsec key/i })
    .first();
  if (!(await accessCardToggle.count())) return;

  await accessCardToggle.click();

  const accessCardInput = page.locator("#access-card-nsec");
  const topbarInput = page.locator("#topbar-nsec");
  const input = (await accessCardInput.count()) ? accessCardInput : topbarInput;

  await input.fill(seededNsec);
  await page
    .getByRole("button", { name: /^sign in$/i })
    .first()
    .click();
  await page.waitForTimeout(1500);
}

async function ensureHubSelected(page) {
  const launchButton = page.getByRole("button", { name: /launch airline/i });
  if (await launchButton.isEnabled().catch(() => false)) {
    return;
  }

  const openHubPicker = page.getByRole("button", {
    name: /pick a different hub|choose your hub manually/i,
  });
  if (!(await openHubPicker.count())) {
    return;
  }

  await openHubPicker.click();
  const searchInput = page.locator('input[name="airport-search"]');
  await searchInput.fill("JFK");
  await page.getByRole("button", { name: /JFK/i }).first().click();
  await page.getByRole("button", { name: /confirm hub/i }).click();
  await page.waitForTimeout(800);
}

async function ensureAirlineCreated(page) {
  const airlineNameInput = page.locator("#airline-name");
  if (!(await airlineNameInput.count())) {
    return;
  }

  await airlineNameInput.fill(airlineName);
  await page.locator("#airline-icao").fill(airlineIcao);
  await page.locator("#airline-callsign").fill(airlineCallsign);

  await ensureHubSelected(page);

  const launchButton = page.getByRole("button", { name: /launch airline/i });
  await launchButton.click();
  await page.waitForFunction(() => !document.querySelector("#airline-name"), undefined, {
    timeout: 20000,
  });
  await page.waitForTimeout(2000);
}

async function ensureAircraftPurchased(page) {
  await openReadyPage(page, "/fleet");

  const assignmentSelect = page.locator('select[aria-label^="Assign route for "]').first();
  if (await assignmentSelect.count()) {
    return;
  }

  const emptyStateDealerButton = page.getByRole("button", {
    name: /open global marketplace/i,
  });
  const toolbarDealerButton = page.getByRole("button", {
    name: /purchase aircraft/i,
  });
  const dealerButton = (await emptyStateDealerButton.count())
    ? emptyStateDealerButton.first()
    : toolbarDealerButton.first();
  await dealerButton.click();

  const buyButton = page.getByRole("button", { name: /configure\s*(?:&|and)\s*buy/i }).first();
  await buyButton.scrollIntoViewIfNeeded();
  await buyButton.click();
  await page.getByRole("button", { name: /confirm order/i }).click();

  await page.waitForFunction(
    () => document.querySelectorAll('select[aria-label^="Assign route for "]').length > 0,
    undefined,
    { timeout: 240000 },
  );
  await page.waitForTimeout(1500);
}

async function ensureRouteOpened(page) {
  await openReadyPage(page, "/network?tab=active");
  if (!(await page.getByText(/browse opportunities/i).count())) {
    return;
  }

  await openReadyPage(page, "/network?tab=opportunities");
  const openRouteButton = page.getByRole("button", { name: /open route \(/i }).first();
  await openRouteButton.click();
  await page.getByRole("button", { name: /^Open Route$/i }).click();
  await page.waitForTimeout(1500);
}

async function ensureAircraftAssigned(page) {
  await openReadyPage(page, "/fleet");
  const assignmentSelects = await page.locator('select[aria-label^="Assign route for "]').all();
  if (assignmentSelects.length === 0) {
    throw new Error("Operational visual QA bootstrap failed: no assignable aircraft found.");
  }

  for (const assignmentSelect of assignmentSelects) {
    if ((await assignmentSelect.inputValue()) !== "") {
      return;
    }

    const options = await assignmentSelect.locator("option").allTextContents();
    const targetIndex = options.findIndex((option) => option.trim() && !/unassigned/i.test(option));
    if (targetIndex > 0) {
      await assignmentSelect.selectOption({ index: targetIndex });
      await page.waitForTimeout(7000);
      return;
    }
  }

  throw new Error("Operational visual QA bootstrap failed: no route options available.");
}

async function ensureOperationalScenario(page) {
  await ensureAircraftPurchased(page);
  await ensureRouteOpened(page);
  await ensureAircraftAssigned(page);
}

async function ensureAuthenticatedState(context, width) {
  await context.addInitScript((nsec) => {
    if (!nsec) return;
    const legacyKey = "acars:ephemeral:nsec";
    const secureKey = "acars:ephemeral:nsec:secure";
    try {
      if (!localStorage.getItem(legacyKey) && !localStorage.getItem(secureKey)) {
        localStorage.setItem(legacyKey, nsec);
      }
    } catch {
      // Ignore storage bootstrapping failures and fall back to the visible UI.
    }
  }, seededNsec);

  const page = await context.newPage();
  await openReadyPage(page, "/");

  if (await page.locator("#airline-name").count()) {
    await ensureAirlineCreated(page);
  } else if (await page.getByRole("button", { name: /play free/i }).count()) {
    await ensureNsecLogin(page);
    await openReadyPage(page, "/");

    if (await page.locator("#airline-name").count()) {
      await ensureAirlineCreated(page);
    }
  }

  const pageText = await page.evaluate(() => document.body.textContent || "");
  if (pageText.includes("Create Your Airline") || pageText.includes("access locked")) {
    throw new Error(`Authenticated visual QA bootstrap failed at width ${width}.`);
  }

  await ensureOperationalScenario(page);

  await page.close();
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  await mkdir(authProfileDir, { recursive: true });
  await waitForServer(baseUrl);

  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });

  try {
    for (const width of widths) {
      const guestContext = await browser.newContext({
        viewport: { width, height: 1200 },
        deviceScaleFactor: 1,
        geolocation: { latitude: 40.6413, longitude: -73.7781 },
        permissions: ["geolocation"],
      });

      await captureRoutes(guestContext, guestRoutes, width);
      await guestContext.close();

      const authContext = await chromium.launchPersistentContext(authProfileDir, {
        executablePath,
        headless: true,
        viewport: { width, height: 1200 },
        deviceScaleFactor: 1,
        geolocation: { latitude: 40.6413, longitude: -73.7781 },
        permissions: ["geolocation"],
      });

      try {
        await ensureAuthenticatedState(authContext, width);
        await captureRoutes(authContext, authRoutes, width);
      } finally {
        await authContext.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
