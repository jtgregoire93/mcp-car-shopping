# @jtgregoire93/mcp-car-shopping

MCP server connector for the major used car marketplaces: [CarMax](https://www.carmax.com), [Carvana](https://www.carvana.com) and [CarGurus](https://www.cargurus.com). Automates their flows via Playwright + Browserbase.

## Tools

| Tool | Description |
|------|-------------|
| `search_all` | Search CarMax, Carvana and CarGurus at once with the same filters |
| `carmax_search_inventory` | Search CarMax inventory by make, model, year, price, and ZIP code |
| `carmax_get_vehicle_details` | Get full details (specs, features, photos, Carfax) for a CarMax vehicle |
| `carmax_schedule_test_drive` | Schedule a test drive appointment at CarMax |
| `carmax_get_instant_offer` | Get an instant offer for selling your car by VIN or license plate |
| `carvana_search_inventory` | Search Carvana inventory by make, model, year, price, and ZIP code |
| `carvana_get_vehicle_details` | Get full details (specs, features, photos) for a Carvana vehicle |
| `carvana_get_offer` | Get a Carvana sell/trade-in offer by VIN or license plate |
| `cargurus_search_listings` | Search CarGurus dealer listings, including deal ratings |
| `cargurus_get_listing_details` | Get full details for a CarGurus listing (deal rating, price analysis, days on market, dealer) |
| `cargurus_contact_dealer` | Send a message to the dealer for a CarGurus listing |

## Requirements

- Node.js ≥ 18
- [Browserbase](https://browserbase.com) account with a CDP URL

## Setup

### Environment Variables

```bash
export BROWSERBASE_CDP_URL="wss://connect.browserbase.com?apiKey=YOUR_KEY"
```

CarMax and Carvana block plain datacenter browsers, so use a Browserbase session with stealth mode / proxies enabled.

## Usage with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "car-shopping": {
      "command": "npx",
      "args": ["-y", "@jtgregoire93/mcp-car-shopping"],
      "env": {
        "BROWSERBASE_CDP_URL": "wss://connect.browserbase.com?apiKey=YOUR_KEY"
      }
    }
  }
}
```

## Tool Details

### `search_all`

Runs the CarMax, Carvana and CarGurus searches in parallel. A site that fails is reported without failing the others.

```
search_all({ zip: "90210", make: "Toyota", model: "Camry", year_min: 2019, price_max: 30000, limit: 5 })
```

### Search (per site)

All three take the same filters: `zip`, `make`, `model`, `year_min`, `year_max`, `price_min`, `price_max`, `limit`. CarGurus requires `zip` and `make`.

```
carmax_search_inventory({ zip: "90210", make: "Toyota", model: "Camry", year_min: 2019, year_max: 2023, price_max: 30000, limit: 10 })
carvana_search_inventory({ make: "Honda", model: "Civic", price_max: 25000 })
cargurus_search_listings({ zip: "60601", make: "Ford", model: "F-150", year_min: 2020 })
```

### Vehicle details

Use the ID from the search results:

```
carmax_get_vehicle_details({ stock_number: "25123456" })
carvana_get_vehicle_details({ vehicle_id: "3012345" })
cargurus_get_listing_details({ listing_id: "391234567" })
```

Returns title, price, mileage, VIN, specs, features and photo URLs, plus site-specific info: store location and Carfax for CarMax; deal rating, price analysis, days on market and dealer for CarGurus.

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

If the site asks condition questions or an email before showing the offer, the tool returns the link to continue.

### `cargurus_contact_dealer`

Sends a real inquiry with your contact info, so it only runs with `confirm: true`.

```
cargurus_contact_dealer({
  listing_id: "391234567",
  first_name: "Jane",
  last_name: "Smith",
  email: "jane@example.com",
  message: "Is this still available? Can I see it Saturday?",
  confirm: true
})
```

## Development

```bash
npm install
npm run typecheck
npm run build   # bundles src/index.ts to dist/index.js
```

## How It Works

This connector uses [Playwright](https://playwright.dev) over a [Browserbase](https://browserbase.com) remote browser session (via CDP) to automate each site's website. No unofficial APIs — all data comes directly from CarMax.com, Carvana.com and CarGurus.com.

## License

MIT
