#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { chromium, type Browser, type Page } from "playwright-core";

// ─── Browser ─────────────────────────────────────────────────────────────────

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;
  const cdpUrl = process.env.BROWSERBASE_CDP_URL;
  if (!cdpUrl) {
    throw new Error("BROWSERBASE_CDP_URL environment variable is required");
  }
  _browser = await chromium.connectOverCDP(cdpUrl);
  return _browser;
}

async function newPage(): Promise<Page> {
  const browser = await getBrowser();
  const ctx =
    browser.contexts()[0] ??
    (await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }));
  return ctx.newPage();
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
        "Search CarMax, Carvana and CarGurus at once with the same filters. Returns each site's results side by side, sorted by price. A site that fails is reported without failing the others.",
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
        "Get full details for a specific CarMax vehicle by stock number, including specs, features, photos, Carfax history, and store location.",
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
    // CarGurus
    {
      name: "cargurus_search_listings",
      description:
        "Search CarGurus used car listings from dealers near a ZIP code. Filter by make, model, year range and price range. Returns listing IDs, prices, mileage, CarGurus deal ratings, dealers, and links.",
      inputSchema: {
        type: "object",
        properties: searchProps,
        required: ["zip", "make"],
      },
    },
    {
      name: "cargurus_get_listing_details",
      description:
        "Get full details for a CarGurus listing by listing ID, including deal rating, price analysis, days on market, dealer, VIN, specs, and photos.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: {
            type: "string",
            description: "CarGurus listing ID (e.g., '391234567'). Obtain from cargurus_search_listings results.",
          },
        },
        required: ["listing_id"],
      },
    },
    {
      name: "cargurus_contact_dealer",
      description:
        "Send a message to the dealer for a CarGurus listing (e.g., to check availability). This sends a real inquiry with your contact info. Requires confirm:true to actually send; otherwise returns a preview only.",
      inputSchema: {
        type: "object",
        properties: {
          listing_id: { type: "string", description: "CarGurus listing ID" },
          confirm: confirmProp("send the message to the dealer"),
          ...contactProps,
          message: {
            type: "string",
            description: "Message to the dealer (default: asks whether the vehicle is still available)",
          },
        },
        required: ["listing_id", "first_name", "last_name", "email"],
      },
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

      case "cargurus_search_listings":
        return formatSearch("CarGurus", await cargurusSearch(a));
      case "cargurus_get_listing_details":
        return await handleCargurusDetails(a.listing_id as string);
      case "cargurus_contact_dealer":
        if (a.confirm !== true) {
          return ok(
            `PREVIEW ONLY. This WOULD send a message to the dealer for CarGurus listing ${a.listing_id}.\n` +
              contactPreview(a) +
              `  Message: ${a.message ?? DEFAULT_DEALER_MESSAGE}\n` +
              `Nothing has been sent. Re-run with confirm:true to actually send.`
          );
        }
        return await handleCargurusContact(a);

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
  dealRating?: string;
}

interface SearchResult {
  searchUrl: string;
  vehicles: Vehicle[];
  totalText?: string;
}

const DEFAULT_DEALER_MESSAGE = "Hi, is this vehicle still available? I'd like to learn more.";

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
  return true;
}

// Card text is split into lines; pick out the title, price, mileage and location
function parseCardText(text: string) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const title = lines.find((l) => /\b(19|20)\d{2}\b/.test(l) && /[a-z]/i.test(l) && !/\$/.test(l)) ?? "";
  const price = lines.find((l) => /^\$\s?[\d,]+$/.test(l)) ?? text.match(/\$\s?[\d,]{4,}/)?.[0] ?? "";
  const mileage = text.match(/[\d,.]+k?\s*(mi\b|miles)/i)?.[0] ?? "";
  const dealRating = text.match(/\b(Great|Good|Fair|High|Overpriced)\s+(Deal|Price)\b/i)?.[0];
  return { title, price, mileage, dealRating };
}

async function scrapeCards(page: Page, cardSelector: string, linkSelector: string, maxResults: number) {
  return page.evaluate(
    ({ cardSelector, linkSelector, maxResults }) => {
      let cards = Array.from(document.querySelectorAll(cardSelector));
      // Fall back to the closest container of each vehicle link
      if (cards.length === 0) {
        cards = Array.from(document.querySelectorAll(linkSelector))
          .map((a) => a.closest("article, li, [class*='card'], [class*='tile'], [class*='Tile']") ?? a)
          .filter((el, i, arr) => arr.indexOf(el) === i);
      }
      return cards.slice(0, maxResults * 3).map((card) => {
        const link = (card.matches(linkSelector) ? card : card.querySelector(linkSelector)) as HTMLAnchorElement | null;
        return { text: (card as HTMLElement).innerText ?? "", href: link?.href ?? "" };
      });
    },
    { cardSelector, linkSelector, maxResults }
  );
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
    v.dealRating ? `  Deal Rating: ${v.dealRating}` : "",
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
  const title = await page.title().catch(() => "");
  if ((res && res.status() === 403) || /access denied|just a moment|attention required/i.test(title)) {
    throw new Error(`${new URL(url).hostname} blocked the request (bot protection). Use a Browserbase session with stealth/proxies enabled.`);
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
      const title = getText(titleSel) || getText("h1");
      const price = getText(priceSel) || (body.match(/\$\s?[\d,]{4,}/)?.[0] ?? "");
      const mileage = getText(mileageSel) || (body.match(/[\d,]+k?\s*(mi\b|miles)/i)?.[0] ?? "");
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
    ["CarGurus", cargurusSearch],
  ];
  const settled = await Promise.allSettled(sites.map(([, search]) => search(args)));

  const lines = ["**Used Car Search — CarMax, Carvana, CarGurus**\n"];
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

async function carmaxSearch(a: Record<string, unknown>): Promise<SearchResult> {
  return withPage(async (page) => {
    const params = new URLSearchParams();
    if (a.zip) params.set("zip", String(a.zip));
    if (a.make) params.set("makes", String(a.make).toLowerCase());
    if (a.model) params.set("models", String(a.model).toLowerCase());
    if (a.year_min) params.set("year-min", String(a.year_min));
    if (a.year_max) params.set("year-max", String(a.year_max));
    if (a.price_min) params.set("price-min", String(a.price_min));
    if (a.price_max) params.set("price-max", String(a.price_max));
    const limit = searchLimit(a);

    const searchUrl = `https://www.carmax.com/cars?${params.toString()}`;
    await goto(page, searchUrl);
    await page
      .waitForSelector('[data-qa="vehicle-card"], .car-card, [class*="vehicle-card"]', { timeout: 15000 })
      .catch(() => null);

    const vehicles = await page.evaluate((maxResults) => {
      const results: Vehicle[] = [];
      const cards = Array.from(
        document.querySelectorAll('[data-qa="vehicle-card"], .vehicle-card, [class*="VehicleCard"], [class*="vehicle-card"]')
      ).slice(0, maxResults);

      for (const card of cards) {
        const titleEl =
          card.querySelector('[data-qa="vehicle-title"], [class*="title"], h2, h3') ||
          card.querySelector("a[href*='/car/']");
        const priceEl = card.querySelector('[data-qa="price"], [class*="price"], [class*="Price"]');
        const mileageEl = card.querySelector('[data-qa="mileage"], [class*="mileage"], [class*="Mileage"]');
        const locationEl = card.querySelector('[data-qa="store"], [class*="store"], [class*="location"]');
        const linkEl = card.querySelector("a[href*='/car/']") as HTMLAnchorElement | null;
        const href = linkEl?.href ?? "";
        const stockNumber = href.match(/\/car\/(\d+)/)?.[1] ?? "";

        results.push({
          title: titleEl?.textContent?.trim() ?? "Unknown Vehicle",
          price: priceEl?.textContent?.trim() ?? "N/A",
          mileage: mileageEl?.textContent?.trim() ?? "N/A",
          id: stockNumber,
          location: locationEl?.textContent?.trim() ?? "",
          url: href || (stockNumber ? `https://www.carmax.com/car/${stockNumber}` : ""),
        });
      }
      return results;
    }, limit);

    const totalText = await page
      .evaluate(
        () =>
          document
            .querySelector('[data-qa="results-count"], [class*="results-count"], [class*="ResultsCount"]')
            ?.textContent?.trim() ?? ""
      )
      .catch(() => "");

    return { searchUrl, vehicles, totalText };
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
      '[data-qa="vehicle-title"], [class*="vehicle-title"]',
      '[data-qa="price"], [class*="asking-price"], [class*="vehicle-price"]',
      '[data-qa="mileage"], [class*="mileage"], [class*="Mileage"]'
    );
    const location = await page
      .evaluate(
        () =>
          document
            .querySelector('[data-qa="store-location"], [class*="store-name"], [class*="StoreInfo"]')
            ?.textContent?.trim() ?? ""
      )
      .catch(() => "");
    const carfax = /carfax/i.test(d.body)
      ? (d.body.match(/[^\n]*(accident|owner)[^\n]*/gi) ?? []).slice(0, 3).map((l) => `  • ${l.trim()}`)
      : [];

    return formatDetails(
      `CarMax Vehicle #${stockNumber}`,
      d,
      [location ? `Location: ${location}` : "", carfax.length ? "\n**Carfax:**" : "", ...carfax],
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
    const offerText = await runSellFlow(page, a);
    return formatOffer("CarMax", a, offerText, page.url() || "https://www.carmax.com/sell-my-car", [
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
    const params = new URLSearchParams();
    if (a.zip) params.set("zip", String(a.zip));
    const searchUrl = `https://www.carvana.com${path}${params.toString() ? `?${params}` : ""}`;

    await goto(page, searchUrl);
    await page
      .waitForSelector('[data-qa="result-tile"], [data-testid="result-tile"], a[href*="/vehicle/"]', { timeout: 15000 })
      .catch(() => null);

    const cards = await scrapeCards(page, '[data-qa="result-tile"], [data-testid="result-tile"]', 'a[href*="/vehicle/"]', limit);
    const vehicles = cards
      .map(({ text, href }) => {
        const id = href.match(/\/vehicle\/(\d+)/)?.[1] ?? "";
        return { ...parseCardText(text), id, location: "", url: id ? `https://www.carvana.com/vehicle/${id}` : href };
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
    await page.waitForSelector("h1", { timeout: 15000 }).catch(() => null);

    const d = await scrapeDetails(
      page,
      '[data-qa="vehicle-title"], [data-testid="vehicle-title"]',
      '[data-qa="price"], [data-testid="price"], [class*="price"]',
      '[data-qa="mileage"], [data-testid="mileage"], [class*="mileage"]'
    );
    return formatDetails(`Carvana Vehicle #${vehicleId}`, d, [], `**View on Carvana:** ${url}`);
  });
}

async function handleCarvanaOffer(a: Record<string, unknown>) {
  if (!a.vin && !a.license_plate) return err("Either vin or license_plate (+ state) is required");

  return withPage(async (page) => {
    await goto(page, "https://www.carvana.com/sell-my-car");
    const offerText = await runSellFlow(page, a);
    return formatOffer("Carvana", a, offerText, page.url() || "https://www.carvana.com/sell-my-car", [
      "\n**Sell or Trade at Carvana:** https://www.carvana.com/sell-my-car",
      "Carvana offers are typically valid for 7 days, with pickup or drop-off.",
    ]);
  });
}

// ─── CarGurus ────────────────────────────────────────────────────────────────

async function cargurusSearch(a: Record<string, unknown>): Promise<SearchResult> {
  if (!a.zip || !a.make) throw new Error("CarGurus search requires zip and make");

  return withPage(async (page) => {
    const limit = searchLimit(a);
    // CarGurus search URLs use internal make/model IDs, so drive the homepage search form instead
    await goto(page, "https://www.cargurus.com/");
    await page.waitForSelector("select", { timeout: 15000 }).catch(() => null);

    const selectByLabel = async (label: string) => {
      for (const select of await page.$$("select")) {
        const options = await select.$$eval("option", (opts) => opts.map((o) => o.textContent?.trim() ?? ""));
        const match = options.find((o) => o.toLowerCase() === label.toLowerCase());
        if (match) {
          await select.selectOption({ label: match });
          await page.waitForTimeout(1000);
          return true;
        }
      }
      return false;
    };

    if (!(await selectByLabel(String(a.make)))) {
      throw new Error(`Could not find make '${a.make}' in the CarGurus search form`);
    }
    if (a.model && !(await selectByLabel(String(a.model)))) {
      throw new Error(`Could not find model '${a.model}' for ${a.make} in the CarGurus search form`);
    }
    await fillField(page, ['input[name="zip"]', 'input[id*="zip" i]', 'input[placeholder*="ZIP" i]'], String(a.zip));
    await clickFirst(page, ['button[type="submit"]:has-text("Search")', 'button:has-text("Search")', 'input[type="submit"]']);

    await page
      .waitForSelector('[data-testid="srp-listing-tile"], [data-cg-ft="car-blade"], a[href*="listingId="], a[href*="#listing="]', {
        timeout: 20000,
      })
      .catch(() => null);

    const cards = await scrapeCards(
      page,
      '[data-testid="srp-listing-tile"], [data-cg-ft="car-blade"]',
      'a[href*="listingId="], a[href*="#listing="], a[href*="/details/"]',
      limit
    );
    const vehicles = cards
      .map(({ text, href }) => {
        const id = href.match(/(?:listingId=|#listing=|\/details\/)(\d+)/)?.[1] ?? "";
        const location = text.match(/[A-Z][a-zA-Z .]+,\s*[A-Z]{2}\b/)?.[0] ?? "";
        return { ...parseCardText(text), id, location, url: id ? cargurusListingUrl(id) : href };
      })
      .filter((v) => v.id && matchesFilters(v, a))
      .slice(0, limit);

    return { searchUrl: page.url(), vehicles };
  });
}

function cargurusListingUrl(listingId: string) {
  return `https://www.cargurus.com/Cars/inventorylisting/vdp.action?listingId=${listingId}`;
}

async function handleCargurusDetails(listingId: string) {
  if (!listingId) return err("listing_id is required");
  return withPage(async (page) => {
    const url = cargurusListingUrl(listingId);
    await goto(page, url);
    await page.waitForSelector("h1", { timeout: 15000 }).catch(() => null);

    const d = await scrapeDetails(
      page,
      '[data-cg-ft="vdp-listing-title"], [data-testid="vdp-title"]',
      '[data-cg-ft="vdp-price"], [data-testid="vdp-price"], [class*="price"]',
      '[data-cg-ft="vdp-mileage"], [class*="mileage"]'
    );
    const dealRating = d.body.match(/\b(Great|Good|Fair|High|Overpriced)\s+(Deal|Price)\b/i)?.[0];
    const priceAnalysis = d.body.match(/\$[\d,]+\s+(below|above)\s+(?:CarGurus\s+)?(?:IMV|market|instant market value)[^\n]*/i)?.[0];
    const daysOnMarket = d.body.match(/(\d+)\s+days?\s+(?:on|at)\s+(?:CarGurus|this dealership|market)/i)?.[0];
    const dealer = await page
      .evaluate(() => document.querySelector('[data-cg-ft="dealer-name"], [class*="dealerName"], [class*="DealerName"]')?.textContent?.trim() ?? "")
      .catch(() => "");

    return formatDetails(
      `CarGurus Listing #${listingId}`,
      d,
      [
        dealRating ? `Deal Rating: ${dealRating}` : "",
        priceAnalysis ? `Price Analysis: ${priceAnalysis.trim()}` : "",
        daysOnMarket ? `Days on Market: ${daysOnMarket}` : "",
        dealer ? `Dealer: ${dealer}` : "",
      ],
      `**View on CarGurus:** ${url}`
    );
  });
}

async function handleCargurusContact(a: Record<string, unknown>) {
  const listingId = a.listing_id as string;
  if (!listingId) return err("listing_id is required");
  if (!a.first_name || !a.last_name || !a.email) return err("first_name, last_name, and email are required");

  return withPage(async (page) => {
    const url = cargurusListingUrl(listingId);
    await goto(page, url);
    await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 15000 }).catch(() => null);

    await fillContactForm(page, a);
    await fillField(page, ['textarea[name="message"]', "textarea"], String(a.message ?? DEFAULT_DEALER_MESSAGE));

    const submitted = await clickFirst(page, [
      'button:has-text("Send message")',
      'button:has-text("Check availability")',
      'button:has-text("Send")',
      'button[type="submit"]',
    ]);
    if (!submitted) {
      return err(`Could not find the send button for CarGurus listing ${listingId}. No message was sent. Contact the dealer at ${url}`);
    }

    await page.waitForTimeout(4000);
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
    if (/(message|inquiry|request) (has been |was )?sent|thank you|we've sent|dealer will (contact|reach)/i.test(bodyText)) {
      return ok(`**Message Sent to Dealer**\nCarGurus listing: ${listingId}\nName: ${a.first_name} ${a.last_name}\nPage: ${url}`);
    }
    return err(
      `Message for CarGurus listing ${listingId} could not be verified — no confirmation was found on the page. It may or may NOT have been sent. Check your email or ${url}`
    );
  });
}

// ─── Forms ───────────────────────────────────────────────────────────────────

async function fillContactForm(page: Page, a: Record<string, unknown>) {
  await fillField(page, ['input[name="firstName"]', 'input[name*="first" i]', 'input[placeholder*="First"]'], String(a.first_name));
  await fillField(page, ['input[name="lastName"]', 'input[name*="last" i]', 'input[placeholder*="Last"]'], String(a.last_name));
  await fillField(page, ['input[name="email"]', 'input[type="email"]'], String(a.email));
  if (a.phone) await fillField(page, ['input[name="phone"]', 'input[name*="phone" i]', 'input[type="tel"]'], String(a.phone));
}

// Fills the first step of a sell-my-car flow (VIN or plate, mileage, ZIP) and reads back any offer amount
async function runSellFlow(page: Page, a: Record<string, unknown>) {
  await page
    .waitForSelector('input[placeholder*="VIN" i], input[placeholder*="plate" i], input[name*="vin" i], input[name*="plate" i]', {
      timeout: 10000,
    })
    .catch(() => null);

  let inputFilled = false;
  if (a.vin) {
    await clickFirst(page, ['button:has-text("VIN")', '[role="tab"]:has-text("VIN")']);
    inputFilled = await fillField(page, ['input[name="vin"]', 'input[name*="vin" i]', 'input[placeholder*="VIN" i]'], String(a.vin));
  } else if (a.license_plate) {
    await clickFirst(page, ['button:has-text("License Plate")', '[role="tab"]:has-text("Plate")', 'a:has-text("License")']);
    inputFilled = await fillField(
      page,
      ['input[name="licensePlate"]', 'input[name*="plate" i]', 'input[placeholder*="plate" i]'],
      String(a.license_plate)
    );
    const stateSelect = await page.$('select[name="state"], select[name*="state" i]');
    if (stateSelect && a.state) await stateSelect.selectOption(String(a.state).toUpperCase()).catch(() => null);
  }
  if (!inputFilled) return "";

  if (a.mileage) await fillField(page, ['input[name="mileage"]', 'input[name*="mileage" i]', 'input[placeholder*="mileage" i]'], String(a.mileage));
  if (a.zip) await fillField(page, ['input[name="zip"]', 'input[name*="zip" i]', 'input[placeholder*="ZIP" i]'], String(a.zip));

  const clicked = await clickFirst(page, [
    'button:has-text("Get Offer")',
    'button:has-text("Get My Offer")',
    'button:has-text("Continue")',
    'button[type="submit"]',
  ]);
  if (!clicked) return "";

  await page.waitForTimeout(4000);
  await page
    .waitForSelector('[data-qa*="offer"], [class*="offer-amount"], [class*="OfferAmount"], [class*="instant-offer"]', { timeout: 10000 })
    .catch(() => null);

  return page.evaluate(() => {
    const offerEl = document.querySelector('[data-qa*="offer-amount"], [class*="offer-amount"], [class*="OfferAmount"]');
    if (offerEl) return offerEl.textContent?.trim() ?? "";
    // Only trust a dollar amount that the page labels as an offer
    return document.body.innerText.match(/offer[^$\n]{0,40}(\$[\d,]+(\s*[-–]\s*\$[\d,]+)?)/i)?.[1] ?? "";
  });
}

function formatOffer(site: string, a: Record<string, unknown>, offerText: string, currentUrl: string, footer: string[]) {
  const identifier = a.vin ? `VIN: ${a.vin}` : `License Plate: ${a.license_plate} (${a.state})`;
  const lines = [
    `**${site} Offer**\n`,
    `Vehicle: ${identifier}`,
    a.mileage ? `Mileage: ${Number(a.mileage).toLocaleString()} miles` : "",
    a.zip ? `ZIP: ${a.zip}` : "",
  ];
  if (offerText) {
    lines.push(`\n**Offer Amount: ${offerText}**`);
  } else {
    lines.push(
      `\n${site} did not show an offer yet. It usually asks condition questions and an email before revealing it.`,
      `  Continue here: ${currentUrl}`
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
