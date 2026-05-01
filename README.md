# Iridium MCP Server

An MCP (Model Context Protocol) server that connects AI agents like Claude and ChatGPT to your Iridium fitness data. Query your workouts, nutrition, body measurements, and training volume — and log food entries directly into your Iridium diary while chatting — from Claude Code, Claude Desktop, ChatGPT, or any MCP-compatible client.

## Prerequisites

- **Node.js 18+**
- **Iridium app** with AI Data Sync enabled (Settings > AI Data Sync)

## Setup

### 1. Enable AI Data Sync in Iridium

1. Open the Iridium app on your iPhone
2. Go to **Settings > AI Data Sync**
3. Toggle **Enable AI Data Sync** on
4. Copy your **Sync ID** and **Sync Key**

### 2. Install the MCP Server

```bash
npm install -g iridium-mcp-server
```

Or clone and build from source:

```bash
git clone https://github.com/iridium-fitness/iridium-mcp-server.git
cd iridium-mcp-server
npm install
npm run build
```

### 3. Configure Claude Code

Add the following to your Claude Code MCP settings (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "iridium": {
      "command": "npx",
      "args": ["iridium-mcp-server"],
      "env": {
        "IRIDIUM_SYNC_ID": "your-sync-id-here",
        "IRIDIUM_SYNC_KEY": "your-sync-key-here"
      }
    }
  }
}
```

### Timezone (optional but recommended)

The user's timezone is used in two places:

- **Read tools** like `get_nutrition_log` use it to pick day boundaries — otherwise food logged late at night can spill into the next day's results.
- **Write tools** like `log_food_entry` use it to anchor relative dates: `"yesterday"`, `"today T14:00"`, or `"2026-04-29"` are interpreted in the user's local timezone, not UTC. Without this, an MDT user logging `"yesterday"` would land their food two days earlier in the iOS app (because UTC midnight is the previous evening locally).

By default the server auto-detects the timezone of the machine it runs on. **The Iridium iOS app does not push the user's timezone to the server.** If the MCP server runs somewhere other than the user's own machine — a cloud-hosted agent, a VM, a server with a different system TZ — set `IRIDIUM_USER_TZ` to the user's IANA timezone:

```json
{
  "mcpServers": {
    "iridium": {
      "command": "npx",
      "args": ["iridium-mcp-server"],
      "env": {
        "IRIDIUM_SYNC_ID": "your-sync-id-here",
        "IRIDIUM_SYNC_KEY": "your-sync-key-here",
        "IRIDIUM_USER_TZ": "America/Denver"
      }
    }
  }
}
```

Leave it unset if the MCP server and the user are in the same timezone (the typical Claude-Desktop-on-your-laptop setup).

---

If you installed from source, use the absolute path instead:

```json
{
  "mcpServers": {
    "iridium": {
      "command": "node",
      "args": ["/path/to/iridium-mcp-server/build/index.js"],
      "env": {
        "IRIDIUM_SYNC_ID": "your-sync-id-here",
        "IRIDIUM_SYNC_KEY": "your-sync-key-here"
      }
    }
  }
}
```

## Available Tools

### Read tools

| Tool | Description |
|------|-------------|
| `get_workout_history` | Get recent workout history with optional date range and category filtering |
| `get_workout_detail` | Get full details of a specific workout (exercises, sets, weights, reps, RPE) |
| `get_nutrition_log` | Get daily nutrition summaries (totals + goals + day notes) over a date range — use for trends and goal tracking |
| `get_food_entries` | Get full individual food entries (name + every nutrient) for a day or date range up to 90 days — use when the question is about what was actually eaten |
| `get_nutrition_goals` | Get the user's current nutrition intent — goal type (lose / maintain / gain), target weekly rate, and daily calorie / protein / carb / fat targets. Use when coaching or giving recommendations that depend on whether they are cutting, bulking, or maintaining |
| `search_exercises` | Search the exercise database by name or muscle group |
| `get_exercise_progress` | Get performance history and 1RM trends for a specific exercise |
| `get_body_measurements` | Get body measurement history (weight, body fat, etc.) |
| `get_profile` | Get user profile including training goals, methodology, and experience level |
| `get_training_summary` | Get aggregate training statistics (total workouts, streaks, patterns) |
| `get_training_volume` | Get volume adaptation records per muscle group with fatigue and recovery data |
| `get_trainer_analysis` | Get weekly AI trainer analysis logs with recommendations and insights |
| `get_weekly_schedule` | Get the planned weekly training schedule |
| `get_workout_templates` | Get saved workout templates with exercise configurations |
| `list_my_foods` | List the user's saved reusable foods ("My Foods") — their homemade shakes, go-to bars, custom meals. Call this first when the user refers to a food by name as if it were already known |

### Write tools

| Tool | Description |
|------|-------------|
| `log_food_entry` | Log a single food entry (name + macros) to the user's Iridium food diary |
| `update_food_entry` | Update a food entry previously logged via `log_food_entry` — adjust servings, fix a macro, change the meal type, etc. Only works on chat-logged entries |

#### `log_food_entry` notes

When the agent calls this tool, the entry lands on Iridium's backend immediately and is pulled into the iOS app on its next sync — typically within seconds when the app is foregrounded, otherwise on the next foreground or 5-minute polling tick. Entries that come from MCP are tagged with a "Chat" badge in the food log so the user can tell at a glance which entries were logged by an external chatbot.

**Required:** `name`, `calories`, `protein`, `carbs`, `fat` (grams).

**Important — totals, not per-serving:** calories and macros must be the totals for the amount actually consumed. If the user ate 2 servings of a 200-cal item, send `calories: 400`, not `calories: 200` with `numberOfServings: 2`. Iridium stores the values as-is and does not multiply.

**Optional:** `date`, `mealType` (`breakfast | lunch | dinner | snacks | preWorkout | postWorkout | other`, defaults to `snacks`), `numberOfServings`, `brand`, `notes`, plus any micros the agent is confident about — `fiber`, `sugar`, `sodium`, `cholesterol`, `saturatedFat`, `transFat`, `monounsaturatedFat`, `polyunsaturatedFat`, `potassium`, `calcium`, `iron`, `magnesium`, `zinc`, `vitaminA`, `vitaminB6`, `vitaminB12`, `vitaminC`, `vitaminD`, `vitaminE`, `vitaminK`, `folate`, `niacin`, `riboflavin`, `thiamin`, `caffeine`, `water`. Omit values the agent does not know rather than guessing.

**Date forms accepted by `date` (defaults to now):**

| Form | Stored as |
|------|-----------|
| `"today"` | noon local today |
| `"yesterday"` | noon local yesterday |
| `"today T14:00"` / `"yesterday 14:30:00"` | that wall time, local that day |
| `"2026-04-29"` | noon local on that date |
| `"2026-04-29T14:00:00"` (no offset) | wall time, user's local TZ |
| `"2026-04-29T14:00:00-06:00"` / `"…Z"` | passed through unchanged |

All bare and relative forms are anchored in the user's local timezone (see [Timezone](#timezone-optional-but-recommended) above) — agents do not need to know the user's timezone to log food correctly. Bare dates anchor to noon to avoid drift across DST transitions.

**Limits:** the endpoint accepts at most 10 writes/min and 200 writes/day per user; values beyond `calories ≤ 50000`, `protein/carbs/fat ≤ 5000`, `numberOfServings ≤ 100`, or strings beyond `name ≤ 200`/`brand ≤ 100`/`notes ≤ 1000` chars are rejected with HTTP 400.

## Example Usage

Once configured, you can ask Claude or ChatGPT things like:

**Querying:**
- "Show me my workouts from last week"
- "How has my bench press progressed over the last 3 months?"
- "What did I eat yesterday?" / "Everything I logged the past 7 days" / "What's my Tuesday dinner this week?"
- "Am I hitting my protein goals?" / "How did my calories trend this month?"
- "Where was most of my sugar coming from last week?"
- "What does my training volume look like for chest?"
- "What's my weekly training schedule?"

**Coaching loops:**
An agent checking in on the user throughout the day can build a live picture with three calls:
1. `get_nutrition_goals` — what the user is targeting (cut / bulk / maintain + daily macro numbers)
2. `get_food_entries(date: today)` — what has already been consumed
3. `get_body_measurements` (as needed) — recent weight trend

Then coach from there: "you have ~40 g of protein left and a calorie headroom of ~600, which fits a normal dinner given your slow-cut target of -1 lb/week."

**Logging food:**
- "Log a cheeseburger for lunch"
- "Add a Snickers bar to my snacks"
- "I just ate two scrambled eggs and a slice of toast — log that"
- "Log my blueberry shake" — the chatbot calls `list_my_foods` first, finds your saved MyFood, and reuses its macros
- "Log another Nuun" — same path: recognized by name from your saved foods

**Editing after the fact:**
- "Wait, that was 2 cheeseburgers, not 1" — chatbot calls `update_food_entry` with the id from the prior log
- "Actually make that a snack, not lunch"
- "Drop the cheese on that burger"

Edits only work on entries logged via chat. Entries you added directly in the Iridium app can only be edited in the app.

The chatbot fills in macros from its own knowledge (or from your `list_my_foods` lookups), calls the relevant tool, and the change shows up in your Iridium food log on the next sync (within seconds when the app is open).

## Troubleshooting

### "Missing IRIDIUM_SYNC_ID or IRIDIUM_SYNC_KEY"

Make sure both environment variables are set in your MCP server configuration. You can find these values in the Iridium app under Settings > AI Data Sync.

### "API request failed (401)"

Your Sync Key may have been regenerated. Open Iridium, go to Settings > AI Data Sync, and copy the current Sync Key. Update your MCP configuration with the new key.

### "API request failed (404)"

The data endpoint may not be available yet. Make sure you have synced your data at least once by opening Iridium and tapping Sync Now in Settings > AI Data Sync.

### Stale data warnings

If you see a warning that data was synced a long time ago, open the Iridium app and tap Sync Now to push the latest data. The server will show staleness warnings when data is older than 24 hours.

### Server not appearing in Claude Code

1. Make sure the configuration JSON is valid
2. Restart Claude Code after making configuration changes
3. Check that Node.js 18+ is installed: `node --version`

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode (rebuild on changes)
npm run dev

# Run directly
IRIDIUM_SYNC_ID=xxx IRIDIUM_SYNC_KEY=yyy npm start
```

## License

MIT
