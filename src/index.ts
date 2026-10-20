#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";

// ─── Browser ─────────────────────────────────────────────────────────────────

let _context: Promise<BrowserContext> | null = null;

// Browserbase when BROWSERBASE_CDP_URL is set, otherwise the locally installed Google Chrome
async function launchContext(): Promise<BrowserContext> {
  const cdpUrl = process.env.BROWSERBASE_CDP_URL;
  if (cdpUrl) {
    const browser = await chromium.connectOverCDP(cdpUrl);
    return browser.contexts()[0] ?? browser.newContext();
  }
  // A persistent profile keeps the sites' bot-check clearance cookies between runs
  const profileDir = process.env.CHROME_PROFILE_DIR ?? join(homedir(), ".cache", "mcp-car-shopping", "chrome-profile");
  return chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    // Headless Chrome trips the sites' bot protection, so run a real window parked off-screen
    headless: process.env.HEADLESS === "1",
    args: ["--window-position=-2400,-2400"],
    viewport: { width: 1280, height: 900 },
  });
}

async function newPage(): Promise<Page> {
  if (!_context) {
    _context = launchContext();
    _context.then((ctx) => ctx.on("close", () => (_context = null))).catch(() => (_context = null));
  }
  return (await _context).newPage();
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "car-shopping", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const searchProps = {
  zip: { type: "string", description: "ZIP code to search near (e.g., '90210')" },
  make: { type: "string", description: "Vehicle make/brand (e.g., 'Toyota', 'Ford', 'Honda')" },
  model: { type: "string", description: "Vehicle model (e.g., 'Camry', 'F-150', 'Civic')" },
  year_min: { type: "number", description: "Minimum model year (e.g., 2018)" },
  year_max: { type: "number", description: "Maximum model year (e.g., 2023)" },
  mileage_max: { type: "number", description: "Maximum mileage" },
  price_min: { type: "number", description: "Minimum price in dollars" },
  price_max: { type: "number", description: "Maximum price in dollars" },
  limit: { type: "number", description: "Number of results to return (default: 10, max: 25)" },
};

const contactProps = {
  first_name: { type: "string", description: "Customer first name" },
  last_name: { type: "string", description: "Customer last name" },
  email: { type: "string", description: "Customer email address" },
  phone: { type: "string", description: "Customer phone number (10 digits, e.g., '5551234567')" },
};

const confirmProp = (action: string) => ({
  type: "boolean",
  description: `Must be true to actually ${action}. If false or omitted, returns a preview only and does NOT submit anything.`,
  default: false,
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_all",
      description:
        "Search CarMax and Carvana at once with the same filters. Returns each site's results side by side, sorted by price. A site that fails is reported without failing the other.",
      inputSchema: {
        type: "object",
        properties: {
          ...searchProps,
          limit: { type: "number", description: "Results per site (default: 5, max: 25)" },
        },
        required: [],
      },
    },
    // CarMax
    {
      name: "carmax_search_inventory",
      description:
        "Search CarMax inventory for used vehicles. Filter by make, model, year range, price range, and location (ZIP code). Returns a list of matching vehicles with stock numbers, prices, mileage, and links.",
      inputSchema: { type: "object", properties: searchProps, required: [] },
    },
    {
      name: "carmax_get_vehicle_details",
      description:
        "Get full details for a specific CarMax vehicle by stock number, including specs, photos, vehicle history highlights, and store location.",
      inputSchema: {
        type: "object",
        properties: {
          stock_number: {
            type: "string",
            description: "CarMax stock number (8-digit number, e.g., '25123456'). Obtain from carmax_search_inventory results.",
          },
        },
        required: ["stock_number"],
      },
    },
    {
      name: "carmax_schedule_test_drive",
      description:
        "Schedule a test drive appointment at CarMax for a specific vehicle. This books a real appointment. Requires confirm:true to actually book; otherwise returns a preview only.",
      inputSchema: {
        type: "object",
        properties: {
          stock_number: { type: "string", description: "CarMax stock number for the vehicle to test drive" },
          confirm: confirmProp("book the test drive appointment"),
          ...contactProps,
          preferred_date: {
            type: "string",
            description: "Preferred date for test drive (e.g., 'tomorrow', 'Saturday', '2024-03-15')",
          },
          preferred_time: { type: "string", description: "Preferred time (e.g., 'morning', 'afternoon', '2:00 PM')" },
        },
        required: ["stock_number", "first_name", "last_name", "email", "phone"],
      },
    },
    {
      name: "carmax_get_instant_offer",
      description:
        "Get an instant cash offer from CarMax for selling your car. Provide VIN or license plate + state. Returns estimated offer range and next steps.",
      inputSchema: { type: "object", properties: sellProps("the offer"), required: [] },
    },
    // Carvana
    {
      name: "carvana_search_inventory",
      description:
        "Search Carvana inventory for used vehicles. Filter by make, model, year range, price range, and ZIP code. Returns vehicle IDs, prices, mileage, and links.",
      inputSchema: { type: "object", properties: searchProps, required: [] },
    },
    {
      name: "carvana_get_vehicle_details",
      description:
        "Get full details for a specific Carvana vehicle by vehicle ID, including price, mileage, VIN, specs, features, and photos.",
      inputSchema: {
        type: "object",
        properties: {
          vehicle_id: {
            type: "string",
            description: "Carvana vehicle ID (e.g., '3012345'). Obtain from carvana_search_inventory results.",
          },
        },
        required: ["vehicle_id"],
      },
    },
    {
      name: "carvana_get_offer",
      description:
        "Get a cash offer from Carvana for selling or trading in your car. Provide VIN or license plate + state. Returns the offer if Carvana shows one, otherwise next steps.",
      inputSchema: { type: "object", properties: sellProps("the offer"), required: [] },
    },
  ],
}));

function sellProps(what: string) {
  return {
    vin: { type: "string", description: "Vehicle Identification Number (17 characters)" },
    license_plate: { type: "string", description: "License plate number (used if VIN not provided)" },
    state: { type: "string", description: "2-letter US state code for the license plate (e.g., 'CA', 'TX')" },
    mileage: { type: "number", description: "Current odometer reading in miles" },
    zip: { type: "string", description: `ZIP code for ${what} (affects offer amount)` },
  };
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "search_all":
        return await handleSearchAll(a);

      case "carmax_search_inventory":
        return formatSearch("CarMax", await carmaxSearch(a));
      case "carmax_get_vehicle_details":
        return await handleCarmaxDetails(a.stock_number as string);
      case "carmax_schedule_test_drive":
        if (a.confirm !== true) {
          return ok(
            `PREVIEW ONLY. This WOULD book a CarMax test drive appointment.\n` +
              `  Vehicle stock #: ${a.stock_number}\n` +
              contactPreview(a) +
              (a.preferred_date ? `  Preferred Date: ${a.preferred_date}\n` : "") +
              (a.preferred_time ? `  Preferred Time: ${a.preferred_time}\n` : "") +
              `No appointment has been booked. Re-run with confirm:true to actually book.`
          );
        }
        return await handleCarmaxTestDrive(a);
      case "carmax_get_instant_offer":
        return await handleCarmaxInstantOffer(a);

      case "carvana_search_inventory":
        return formatSearch("Carvana", await carvanaSearch(a));
      case "carvana_get_vehicle_details":
        return await handleCarvanaDetails(a.vehicle_id as string);
      case "carvana_get_offer":
        return await handleCarvanaOffer(a);

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Tool '${name}' failed: ${msg}`);
  }
});

// ─── Shared helpers ──────────────────────────────────────────────────────────

interface Vehicle {
  title: string;
  price: string;
  mileage: string;
  id: string;
  location: string;
  url: string;
}

interface SearchResult {
  searchUrl: string;
  vehicles: Vehicle[];
  totalText?: string;
}

function searchLimit(a: Record<string, unknown>, fallback = 10) {
  return Math.min(Number(a.limit ?? fallback), 25);
}

function priceValue(text: string) {
  const m = text.replace(/,/g, "").match(/\$\s*(\d+)/);
  return m ? Number(m[1]) : undefined;
}

// Applies the year/price filters a site's URL could not express, against scraped card text
function matchesFilters(v: Vehicle, a: Record<string, unknown>) {
  const year = Number(v.title.match(/\b(19|20)\d{2}\b/)?.[0]);
  const price = priceValue(v.price);
  if (year && a.year_min && year < Number(a.year_min)) return false;
  if (year && a.year_max && year > Number(a.year_max)) return false;
  if (price && a.price_min && price < Number(a.price_min)) return false;
  if (price && a.price_max && price > Number(a.price_max)) return false;
  const miles = mileageValue(v.mileage);
  if (miles !== undefined && a.mileage_max && miles > Number(a.mileage_max)) return false;
  return true;
}

function mileageValue(text: string) {
  const m = text.replace(/,/g, "").match(/([\d.]+)\s*(k)?\s*mi/i);
  return m ? Math.round(Number(m[1]) * (m[2] ? 1000 : 1)) : undefined;
}

function formatSearch(site: string, r: SearchResult) {
  if (r.vehicles.length === 0) {
    return ok(
      `No ${site} vehicles found matching your search criteria. Try broadening your search or visit the site directly.\nSearch URL: ${r.searchUrl}`
    );
  }
  const lines = [`**${site} Search Results**${r.totalText ? ` — ${r.totalText}` : ""}\n`, `Search: ${r.searchUrl}\n`];
  for (const v of r.vehicles) lines.push(formatVehicle(v));
  return ok(lines.join("\n"));
}

function formatVehicle(v: Vehicle) {
  return [
    `**${v.title || "Unknown Vehicle"}**`,
    `  Price: ${v.price || "N/A"} | Miles: ${v.mileage || "N/A"}`,
    v.id ? `  ID: ${v.id}` : "",
    v.location ? `  Location: ${v.location}` : "",
    v.url ? `  ${v.url}` : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

function contactPreview(a: Record<string, unknown>) {
  return (
    `  Name: ${a.first_name} ${a.last_name}\n` +
    `  Email: ${a.email}\n` +
    (a.phone ? `  Phone: ${a.phone}\n` : "")
  );
}

async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const page = await newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => null);
  }
}

async function goto(page: Page, url: string) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  const challenged = async () =>
    /access denied|just a moment|attention required/i.test(await page.title().catch(() => "")) ||
    /performing security verification/i.test(await page.evaluate(() => document.body?.innerText ?? "").catch(() => ""));
  // Cloudflare's interstitial usually clears itself within a few seconds
  for (let i = 0; i < 15 && (await challenged()); i++) await page.waitForTimeout(1000);
  if ((await challenged()) || (res && res.status() === 403 && /access denied/i.test(await page.title().catch(() => "")))) {
    throw new Error(`${new URL(url).hostname} blocked the request (bot protection). Run without HEADLESS=1, or use a Browserbase session with stealth/proxies enabled.`);
  }
}

async function fillField(page: Page, selectors: string[], value: string) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.fill(value);
      return true;
    }
  }
  return false;
}

async function clickFirst(page: Page, selectors: string[]) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click().catch(() => null);
      return true;
    }
  }
  return false;
}

async function scrapeDetails(page: Page, titleSel: string, priceSel: string, mileageSel: string) {
  return page.evaluate(
    ({ titleSel, priceSel, mileageSel }) => {
      const getText = (sel: string) => document.querySelector(sel)?.textContent?.trim() ?? "";
      const getAll = (sel: string) =>
        Array.from(document.querySelectorAll(sel))
          .map((el) => el.textContent?.trim() ?? "")
          .filter(Boolean);

      const body = document.body.innerText;
      const titleEl = document.querySelector(titleSel) ?? document.querySelector("h1");
      const title = ((titleEl as HTMLElement | null)?.innerText ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !/\bmiles?\b/i.test(l)).join(" ");
      const price = (getText(priceSel).match(/\$\s?[\d,]{4,}/) ?? body.match(/\$\s?[\d,]{4,}/))?.[0] ?? "";
      const mileage = ((document.querySelector(mileageSel) as HTMLElement | null)?.innerText.match(/[\d,]+k?\s*(mi\b|miles)/i) ?? body.match(/[\d,]+k?\s*(mi\b|miles)/i))?.[0] ?? "";
      const vinText = body.match(/VIN[:\s#]+([A-HJ-NPR-Z0-9]{17})/i)?.[1] ?? "";

      const features = getAll(
        '[data-qa="feature-item"], [class*="feature-item"], [class*="FeatureItem"], [class*="features"] li, [class*="highlights"] li'
      ).slice(0, 20);

      const photoUrls = Array.from(document.querySelectorAll('[class*="photo"] img, [class*="gallery"] img, [class*="Gallery"] img'))
        .map((img) => (img as HTMLImageElement).src)
        .filter((src) => src && !src.includes("logo") && !src.includes("icon"))
        .slice(0, 5);

      const specs: Record<string, string> = {};
      document.querySelectorAll('[data-qa="spec-row"], [class*="spec-row"], [class*="SpecRow"], table tr, dl > div').forEach((row) => {
        const cells = row.querySelectorAll("td, th, dt, dd, [class*='label'], [class*='value']");
        if (cells.length >= 2) {
          const key = cells[0].textContent?.trim() ?? "";
          const val = cells[1].textContent?.trim() ?? "";
          if (key && val) specs[key] = val;
        }
      });
      // Spec tiles that render as a value line followed by its label line (CarMax)
      const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
      const specLabels = ["Exterior Color", "Interior Color", "Drive Type", "Engine", "Transmission", "Horsepower", "Cargo Capacity", "Fuel Type"];
      lines.forEach((line, i) => {
        if (specLabels.includes(line) && i > 0 && !specs[line] && !specLabels.includes(lines[i - 1])) specs[line] = lines[i - 1];
      });

      return { title, price, mileage, vinText, features, photoUrls, specs, body };
    },
    { titleSel, priceSel, mileageSel }
  );
}

function formatDetails(
  heading: string,
  d: Awaited<ReturnType<typeof scrapeDetails>>,
  extra: string[],
  footer: string
) {
  const lines = [`**${d.title || heading}**\n`, `Price: ${d.price || "N/A"}`, `Mileage: ${d.mileage || "N/A"}`];
  if (d.vinText) lines.push(`VIN: ${d.vinText}`);
  lines.push(...extra.filter(Boolean));
  if (Object.keys(d.specs).length > 0) {
    lines.push("\n**Specifications:**");
    for (const [k, v] of Object.entries(d.specs).slice(0, 15)) lines.push(`  ${k}: ${v}`);
  }
  if (d.features.length > 0) {
    lines.push("\n**Features & Highlights:**");
    d.features.forEach((f) => lines.push(`  • ${f}`));
  }
  if (d.photoUrls.length > 0) {
    lines.push("\n**Photos:**");
    d.photoUrls.forEach((u, i) => lines.push(`  Photo ${i + 1}: ${u}`));
  }
  lines.push(`\n${footer}`);
  return ok(lines.join("\n"));
}

// ─── search_all ──────────────────────────────────────────────────────────────

async function handleSearchAll(a: Record<string, unknown>) {
  const args = { ...a, limit: searchLimit(a, 5) };
  const sites: [string, (a: Record<string, unknown>) => Promise<SearchResult>][] = [
    ["CarMax", carmaxSearch],
    ["Carvana", carvanaSearch],
  ];
  const settled = await Promise.allSettled(sites.map(([, search]) => search(args)));

  const lines = ["**Used Car Search — CarMax, Carvana**\n"];
  settled.forEach((res, i) => {
    const site = sites[i][0];
    if (res.status === "rejected") {
      lines.push(`### ${site}\n  Search failed: ${res.reason instanceof Error ? res.reason.message : res.reason}\n`);
      return;
    }
    const vehicles = [...res.value.vehicles].sort(
      (x, y) => (priceValue(x.price) ?? Infinity) - (priceValue(y.price) ?? Infinity)
    );
    lines.push(`### ${site} (${vehicles.length} shown)`, `Search: ${res.value.searchUrl}\n`);
    if (vehicles.length === 0) lines.push("  No matching vehicles.\n");
    for (const v of vehicles) lines.push(formatVehicle(v));
  });
  return ok(lines.join("\n"));
}

// ─── CarMax ──────────────────────────────────────────────────────────────────

interface CarmaxCar {
  stockNumber: number;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  basePrice: number | null;
  mileage: number | null;
  storeName: string | null;
  stateAbbreviation: string | null;
  distance: number | null;
}

async function carmaxSearch(a: Record<string, unknown>): Promise<SearchResult> {
  return withPage(async (page) => {
    const limit = searchLimit(a);
    // /cars?makes=… is ignored by CarMax; make/model only filter as path segments
    const path = a.make ? `/cars/${slug(a.make)}${a.model ? `/${slug(a.model)}` : ""}` : "/cars";
    const params = new URLSearchParams();
    if (a.zip) params.set("zip", String(a.zip));
    const searchUrl = `https://www.carmax.com${path}${params.toString() ? `?${params}` : ""}`;
    await goto(page, searchUrl);

    // CarMax embeds every result's full record in an inline `const cars = [...]` script
    const cars = (await page.evaluate(() => {
      const script = Array.from(document.scripts).find((s) => s.textContent?.includes("const cars = "));
      const m = script?.textContent?.match(/const cars = (\[.*?\]);\s*\n/s);
      return m ? JSON.parse(m[1]) : [];
    })) as CarmaxCar[];

    const vehicles = cars
      .map((c) => ({
        title: [c.year, c.make, c.model, c.trim].filter(Boolean).join(" "),
        price: c.basePrice != null ? `$${c.basePrice.toLocaleString()}` : "N/A",
        mileage: c.mileage != null ? `${c.mileage.toLocaleString()} mi` : "N/A",
        id: String(c.stockNumber),
        location:
          [c.storeName, c.stateAbbreviation].filter(Boolean).join(", ") +
          (c.distance != null ? ` (${c.distance} mi away)` : ""),
        url: `https://www.carmax.com/car/${c.stockNumber}`,
      }))
      .filter((v) => matchesFilters(v, a))
      .slice(0, limit);

    return { searchUrl, vehicles, totalText: `${vehicles.length} of the ${cars.length} cars on the first results page match` };
  });
}

async function handleCarmaxDetails(stockNumber: string) {
  if (!stockNumber) return err("stock_number is required");
  return withPage(async (page) => {
    const url = `https://www.carmax.com/car/${stockNumber}`;
    await goto(page, url);
    await page.waitForSelector('[data-qa="vehicle-title"], h1, [class*="vehicle-title"]', { timeout: 15000 }).catch(() => null);

    const d = await scrapeDetails(
      page,
      'h1',
      '[data-testid="get-started-container"]',
      'h1'
    );
    const location = await page
      .evaluate(
        () =>
          document
            .querySelector('[data-testid="location-details-line2"]')
            ?.textContent?.trim() ?? ""
      )
      .catch(() => "");
    const history = Array.from(new Set(d.body.match(/^.*\b(single owner|no accidents?|accident reported|AutoCheck|Carfax)\b.*$/gim) ?? []))
      .slice(0, 4)
      .map((l) => `  • ${l.trim()}`);

    return formatDetails(
      `CarMax Vehicle #${stockNumber}`,
      d,
      [location ? `Location: ${location}` : "", history.length ? "\n**History:**" : "", ...history],
      `**View on CarMax:** ${url}`
    );
  });
}

async function handleCarmaxTestDrive(a: Record<string, unknown>) {
  const stockNumber = a.stock_number as string;
  if (!stockNumber) return err("stock_number is required");
  if (!a.first_name || !a.last_name || !a.email || !a.phone) {
    return err("first_name, last_name, email, and phone are required");
  }

  return withPage(async (page) => {
    const vehicleUrl = `https://www.carmax.com/car/${stockNumber}`;
    await goto(page, vehicleUrl);

    const testDriveBtn = await page
      .waitForSelector(
        'button:has-text("Test Drive"), a:has-text("Test Drive"), [data-qa*="test-drive"], [class*="test-drive"]',
        { timeout: 10000 }
      )
      .catch(() => null);

    if (!testDriveBtn) {
      return ok(
        `**Schedule Test Drive — Next Steps**\n\nVehicle: ${vehicleUrl}\n\n` +
          `Could not find the test drive button. No appointment was booked.\n` +
          `Visit the vehicle page above and click "Schedule Test Drive", or call 1-800-CAR-MAX1 (1-800-227-6291).`
      );
    }

    await testDriveBtn.click();
    await page.waitForTimeout(2000);

    await fillContactForm(page, a);

    const submitted = await clickFirst(page, [
      'button:has-text("Confirm")',
      'button:has-text("Schedule")',
      'button:has-text("Book")',
      'button:has-text("Reserve")',
      'button[type="submit"]',
    ]);
    if (!submitted) {
      return err(
        `Could not find a submit/confirm button to book the test drive for stock #${stockNumber}. No appointment was booked. Verify on CarMax.com or call 1-800-227-6291.`
      );
    }

    await page.waitForTimeout(4000);
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
    const confMatch = bodyText.match(/(?:confirmation|appointment|reference)\s*(?:#|number|no\.?|id)?\s*[:#]?\s*([A-Z0-9]{6,})/i);
    const looksConfirmed =
      /your (?:test drive|appointment) is (?:scheduled|confirmed|booked)/i.test(bodyText) ||
      /(?:appointment|test drive) (?:scheduled|confirmed|booked)/i.test(bodyText);

    if (confMatch?.[1] || looksConfirmed) {
      return ok(
        `**Test Drive Booked**\nVehicle stock #: ${stockNumber}\n` +
          (confMatch?.[1]
            ? `CarMax confirmation: ${confMatch[1]}\n`
            : `CarMax confirmed the appointment on-page (no confirmation number was displayed).\n`) +
          `Name: ${a.first_name} ${a.last_name}\nPage: ${page.url()}`
      );
    }
    return err(
      `Test drive submission for stock #${stockNumber} could not be verified — no confirmation was found on the page. The appointment may or may NOT have been booked. Verify on CarMax.com or call 1-800-227-6291.`
    );
  });
}

async function handleCarmaxInstantOffer(a: Record<string, unknown>) {
  if (!a.vin && !a.license_plate) return err("Either vin or license_plate (+ state) is required");

  return withPage(async (page) => {
    await goto(page, "https://www.carmax.com/sell-my-car");
    const result = await runSellFlow(page, a);
    return formatOffer("CarMax", a, result, page.url() || "https://www.carmax.com/sell-my-car", [
      "\n**Sell or Trade at CarMax:** https://www.carmax.com/sell-my-car",
      "Offers are valid for 7 days at any CarMax location.",
      "Questions? Call 1-800-CAR-MAX1 (1-800-227-6291)",
    ]);
  });
}

// ─── Carvana ─────────────────────────────────────────────────────────────────

function slug(s: unknown) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

async function carvanaSearch(a: Record<string, unknown>): Promise<SearchResult> {
  return withPage(async (page) => {
    const limit = searchLimit(a);
    const path = a.make ? `/cars/${slug(a.make)}${a.model ? `-${slug(a.model)}` : ""}` : "/cars";
    const searchUrl = `https://www.carvana.com${path}`;

    await goto(page, searchUrl);
    await page.waitForSelector('[data-testid="result-tile"]', { timeout: 15000 }).catch(() => null);

    const tiles = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="result-tile"]')).map((tile) => {
        const text = (tid: string) => (tile.querySelector(`[data-testid="${tid}"]`) as HTMLElement | null)?.innerText ?? "";
        return {
          makeModel: text("make-model"),
          trimMileage: text("trim-mileage"),
          price: text("price"),
          href: (tile.querySelector('a[href*="/vehicle/"]') as HTMLAnchorElement | null)?.href ?? "",
        };
      })
    );

    const vehicles = tiles
      .map((t) => {
        const id = t.href.match(/\/vehicle\/(\d+)/)?.[1] ?? "";
        const lines = t.trimMileage.split("\n").map((l) => l.trim()).filter(Boolean);
        const mileage = lines.find((l) => /miles?$/i.test(l)) ?? "";
        const trim = lines.filter((l) => l !== mileage).join(" ");
        return {
          title: [t.makeModel.replace(/\s+/g, " ").trim(), trim].filter(Boolean).join(" "),
          price: t.price.match(/\$[\d,]+/)?.[0] ?? "",
          mileage,
          id,
          location: "",
          url: id ? `https://www.carvana.com/vehicle/${id}` : t.href,
        };
      })
      .filter((v) => v.id && matchesFilters(v, a))
      .slice(0, limit);

    return { searchUrl, vehicles };
  });
}

async function handleCarvanaDetails(vehicleId: string) {
  if (!vehicleId) return err("vehicle_id is required");
  return withPage(async (page) => {
    const url = `https://www.carvana.com/vehicle/${vehicleId}`;
    await goto(page, url);
    // The price card and spec section render after the title
    await page
      .waitForFunction(() => /\$[\d,]{4,}/.test(document.querySelector('[data-testid="vehicle-info-card"]')?.textContent ?? ""), null, {
        timeout: 20000,
      })
      .catch(() => null);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    const d = await scrapeDetails(page, "h1", '[data-testid="vehicle-info-card"]', '[data-testid="vehicle-info-card"]');

    // "Vehicle Details" lists each label on one line and its value on the following line(s)
    const labels = ["MPG", "Drivetrain", "Exterior color", "Interior", "Seating", "Engine", "Transmission", "Fuel type", "Number of keys", "Prior Use:"];
    const section = d.body.slice(d.body.indexOf("Vehicle Details", 1000), d.body.indexOf("View All Features"));
    const lines = section.split("\n").map((l) => l.trim()).filter(Boolean);
    lines.forEach((line, i) => {
      if (!labels.includes(line)) return;
      const value: string[] = [];
      for (let j = i + 1; j < lines.length && !labels.includes(lines[j]); j++) value.push(lines[j]);
      if (value.length) d.specs[line.replace(/:$/, "")] = value.join(" ");
    });
    const total = d.body.match(/Total purchase price\s*\n\s*(\$[\d,]+)/)?.[1];

    return formatDetails(
      `Carvana Vehicle #${vehicleId}`,
      d,
      [total ? `Total with est. tax, title & registration: ${total}` : ""],
      `**View on Carvana:** ${url}`
    );
  });
}

async function handleCarvanaOffer(a: Record<string, unknown>) {
  if (!a.vin && !a.license_plate) return err("Either vin or license_plate (+ state) is required");

  return withPage(async (page) => {
    await goto(page, "https://www.carvana.com/sell-my-car");
    const result = await runSellFlow(page, a);
    return formatOffer("Carvana", a, result, page.url() || "https://www.carvana.com/sell-my-car", [
      "\n**Sell or Trade at Carvana:** https://www.carvana.com/sell-my-car",
      "Carvana offers are typically valid for 7 days, with pickup or drop-off.",
    ]);
  });
}

// ─── Forms ───────────────────────────────────────────────────────────────────

async function fillContactForm(page: Page, a: Record<string, unknown>) {
  await fillField(page, ['input[name="firstName"]', 'input[name*="first" i]', 'input[placeholder*="First"]'], String(a.first_name));
  await fillField(page, ['input[name="lastName"]', 'input[name*="last" i]', 'input[placeholder*="Last"]'], String(a.last_name));
  await fillField(page, ['input[name="email"]', 'input[type="email"]'], String(a.email));
  if (a.phone) await fillField(page, ['input[name="phone"]', 'input[name*="phone" i]', 'input[type="tel"]'], String(a.phone));
}

interface SellFlowResult {
  offer: string;
  // What the site showed when the flow stopped: the next questions, or an error such as an unknown VIN
  step: string;
}

// Fills the first step of a sell-my-car flow (VIN or plate, ZIP), then reports the offer or the step it stopped at
async function runSellFlow(page: Page, a: Record<string, unknown>): Promise<SellFlowResult> {
  await page.waitForTimeout(2000);
  let inputFilled = false;
  if (a.vin) {
    await page.getByRole("button", { name: "VIN", exact: true }).first().click().catch(() => null);
    await page.locator('[data-testid="Vin-tab"]').click({ timeout: 2000 }).catch(() => null);
    await page.waitForTimeout(800);
    inputFilled = await fillVisible(page, 'input[name="vin"], input#vin, input[name*="vin" i]', String(a.vin));
  } else if (a.license_plate) {
    inputFilled = await fillVisible(page, 'input[name="licensePlate"], input#license_plate, input[name*="plate" i]', String(a.license_plate));
    if (a.state) {
      await page
        .locator("select[name='state']:visible, select#state:visible")
        .first()
        .selectOption({ value: String(a.state).toUpperCase() })
        .catch(() => null);
    }
  }
  if (!inputFilled) return { offer: "", step: "Could not find the VIN / license plate field." };

  if (a.zip) await fillVisible(page, 'input[name="zipCode"], input[name*="zip" i]', String(a.zip));

  const submit = page.getByRole("button", { name: /get (my |your )?offer/i }).first();
  if (!(await submit.isVisible().catch(() => false))) return { offer: "", step: "Could not find the Get Offer button." };
  await submit.click();

  // Wait out the vehicle lookup ("Finding your car", "Finding your vehicle...")
  await page.waitForTimeout(3000);
  for (let i = 0; i < 30; i++) {
    const text = await page.evaluate(() => document.body.innerText).catch(() => "");
    if (!/finding your (car|vehicle)|gathering vehicle data|looking up/i.test(text)) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1500);

  return page.evaluate(() => {
    const body = document.body.innerText;
    const offerEl = document.querySelector('[data-qa*="offer-amount"], [class*="offer-amount"], [class*="OfferAmount"]');
    // Only trust a dollar amount that the page labels as an offer
    const offer = offerEl?.textContent?.trim() || (body.match(/offer[^$\n]{0,40}(\$[\d,]+(\s*[-–]\s*\$[\d,]+)?)/i)?.[1] ?? "");
    const error = body.match(/^.*(whoops|already own|couldn't find|could not find|not a valid|invalid|unable to).*$/im)?.[0];
    const main = (document.querySelector("main") as HTMLElement | null)?.innerText ?? body;
    const step = (error ?? main.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 15).join("\n")).trim();
    return { offer, step };
  });
}

async function fillVisible(page: Page, selector: string, value: string) {
  const el = page.locator(selector).filter({ visible: true }).first();
  if (!(await el.count())) return false;
  await el.fill(value);
  return true;
}

function formatOffer(site: string, a: Record<string, unknown>, result: SellFlowResult, currentUrl: string, footer: string[]) {
  const identifier = a.vin ? `VIN: ${a.vin}` : `License Plate: ${a.license_plate} (${a.state})`;
  const lines = [
    `**${site} Offer**\n`,
    `Vehicle: ${identifier}`,
    a.mileage ? `Mileage: ${Number(a.mileage).toLocaleString()} miles` : "",
    a.zip ? `ZIP: ${a.zip}` : "",
  ];
  if (result.offer) {
    lines.push(`\n**Offer Amount: ${result.offer}**`);
  } else {
    lines.push(
      `\n${site} has not shown an offer yet. It asks condition questions (and usually an email) before revealing it.`,
      `\n**Where the flow stopped:**\n${result.step}`,
      `\nContinue here: ${currentUrl}`
    );
  }
  lines.push(...footer);
  return ok(lines.filter(Boolean).join("\n"));
}

// ─── Response helpers ────────────────────────────────────────────────────────

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string) {
  return { content: [{ type: "text" as const, text: `Error: ${text}` }], isError: true };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("Car Shopping MCP server running on stdio\n");
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e}\n`);
  process.exit(1);
});
