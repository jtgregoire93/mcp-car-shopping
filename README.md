# @jtgregoire93/mcp-car-shopping

MCP server connector for [CarMax](https://www.carmax.com) and [Carvana](https://www.carvana.com). Automates their flows with Playwright, driving your local Google Chrome or a Browserbase remote browser.

For CarGurus, use CarGurus' official connector instead (claude.ai → Settings → Connectors → CarGurus). See [CarGurus' setup guide](https://cargurus.helpscoutdocs.com/article/599-connect-ai-assistants-to-cargurus-with-the-mcp-connector).

## Tools

| Tool | Description |
|------|-------------|
| `search_all` | Search CarMax and Carvana at once with the same filters |
| `carmax_search_inventory` | Search CarMax inventory by make, model, year, price, and ZIP code |
| `carmax_get_vehicle_details` | Get full details (price, VIN, specs, history highlights, store, photos) for a CarMax vehicle |
| `carmax_schedule_test_drive` | Schedule a test drive appointment at CarMax |
| `carmax_get_instant_offer` | Get an instant offer for selling your car by VIN or license plate |
| `carvana_search_inventory` | Search Carvana inventory by make, model, year, price, and ZIP code |
| `carvana_get_vehicle_details` | Get full details (price, total with tax/title, VIN, specs) for a Carvana vehicle |
| `carvana_get_offer` | Get a Carvana sell/trade-in offer by VIN or license plate |

## Requirements

- Node.js ≥ 18
- Google Chrome installed, **or** a [Browserbase](https://browserbase.com) account

## Setup

By default the server drives your installed Google Chrome. It opens a real Chrome window parked off-screen, because both sites block headless Chrome. It keeps its own profile at `~/.cache/mcp-car-shopping/chrome-profile` so the sites' bot-check cookies carry over between runs.

### Environment Variables

| Variable | Effect |
|----------|--------|
| `BROWSERBASE_CDP_URL` | Use a Browserbase remote browser instead of local Chrome, e.g. `wss://connect.browserbase.com?apiKey=YOUR_KEY`. Enable stealth mode / proxies; both sites block plain datacenter browsers. |
| `HEADLESS=1` | Run local Chrome headless. Usually gets blocked by CarMax and Carvana. |

## Usage with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "car-shopping": {
      "command": "npx",
      "args": ["-y", "@jtgregoire93/mcp-car-shopping"]
    }
  }
}
```

Add `"env": { "BROWSERBASE_CDP_URL": "..." }` to use Browserbase instead of local Chrome.

Claude Code:

```bash
claude mcp add car-shopping -- npx -y @jtgregoire93/mcp-car-shopping
```

## Tool Details

### `search_all`

Runs the CarMax and Carvana searches in parallel. A site that fails is reported without failing the other.

```
search_all({ zip: "90210", make: "Toyota", model: "Camry", year_min: 2019, price_max: 30000, limit: 5 })
```

### Search (per site)

Both take the same filters: `zip`, `make`, `model`, `year_min`, `year_max`, `mileage_max`, `price_min`, `price_max`, `limit`. Make and model are applied by the site; the year, price and mileage filters are applied to the first page of results (about 48 cars on CarMax), so a narrow filter can return fewer than `limit`. CarMax sorts by distance from `zip`. Carvana ships nationwide and ignores `zip`.

```
carmax_search_inventory({ zip: "90210", make: "Toyota", model: "Camry", year_min: 2019, year_max: 2023, price_max: 30000, limit: 10 })
carvana_search_inventory({ make: "Honda", model: "Civic", price_max: 25000 })
```

### Vehicle details

Use the ID from the search results:

```
carmax_get_vehicle_details({ stock_number: "25123456" })
carvana_get_vehicle_details({ vehicle_id: "3012345" })
```

Returns title, price, mileage, VIN and specs, plus site-specific info: store location, vehicle history highlights and photo URLs for CarMax; total price with estimated tax, title and registration for Carvana.

### `carmax_schedule_test_drive`

Books a real appointment, so it only runs with `confirm: true`. Without it, it returns a preview.

```
carmax_schedule_test_drive({
  stock_number: "25123456",
  first_name: "Jane",
  last_name: "Smith",
  email: "jane@example.com",
  phone: "5551234567",
  preferred_date: "Saturday",
  preferred_time: "afternoon",
  confirm: true
})
```

### `carmax_get_instant_offer` / `carvana_get_offer`

```
// By VIN
carmax_get_instant_offer({ vin: "1HGCM82633A123456", mileage: 85000, zip: "90210" })

// By license plate
carvana_get_offer({ license_plate: "ABC1234", state: "CA", mileage: 85000 })
```

Both sites identify the car from the VIN or plate, then ask style and condition questions (and an email) before showing an offer. The tool enters the VIN/plate and ZIP, waits for the lookup, and returns what the site found plus the questions it stopped at, with a link to finish on the site.

## Development

```bash
npm install
npm run typecheck
npm run build   # bundles src/index.ts to dist/index.js
```

## How It Works

This connector uses [Playwright](https://playwright.dev) with your local Chrome or a [Browserbase](https://browserbase.com) remote browser session (via CDP) to automate each site. CarMax search reads the full car records CarMax embeds in its search page; everything else reads the rendered pages. No unofficial APIs — all data comes directly from CarMax.com and Carvana.com.

## License

MIT
