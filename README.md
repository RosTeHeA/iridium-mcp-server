# Iridium MCP Server

An MCP (Model Context Protocol) server that connects AI agents like Claude to your Iridium fitness data. Query your workouts, nutrition, body measurements, training volume, and more directly from Claude Code or any MCP-compatible client.

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

| Tool | Description |
|------|-------------|
| `get_workout_history` | Get recent workout history with optional date range and category filtering |
| `get_workout_detail` | Get full details of a specific workout (exercises, sets, weights, reps, RPE) |
| `get_nutrition_log` | Get daily nutrition summaries or individual food entries for a specific date |
| `search_exercises` | Search the exercise database by name or muscle group |
| `get_exercise_progress` | Get performance history and 1RM trends for a specific exercise |
| `get_body_measurements` | Get body measurement history (weight, body fat, etc.) |
| `get_profile` | Get user profile including training goals, methodology, and experience level |
| `get_training_summary` | Get aggregate training statistics (total workouts, streaks, patterns) |
| `get_training_volume` | Get volume adaptation records per muscle group with fatigue and recovery data |
| `get_trainer_analysis` | Get weekly AI trainer analysis logs with recommendations and insights |
| `get_weekly_schedule` | Get the planned weekly training schedule |
| `get_workout_templates` | Get saved workout templates with exercise configurations |

## Example Usage

Once configured, you can ask Claude things like:

- "Show me my workouts from last week"
- "How has my bench press progressed over the last 3 months?"
- "What did I eat yesterday?"
- "Am I hitting my protein goals?"
- "What does my training volume look like for chest?"
- "What's my weekly training schedule?"

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
