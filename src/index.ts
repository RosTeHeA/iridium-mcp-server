#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./api-client.js";
import { registerWorkoutTools } from "./tools/workouts.js";
import { registerNutritionTools } from "./tools/nutrition.js";
import { registerExerciseTools } from "./tools/exercises.js";
import { registerBodyTools } from "./tools/body.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerRecoveryTools } from "./tools/recovery.js";
import { registerScheduleTools } from "./tools/schedule.js";

const syncId = process.env.IRIDIUM_SYNC_ID;
const syncKey = process.env.IRIDIUM_SYNC_KEY;

if (!syncId || !syncKey) {
    console.error("Missing IRIDIUM_SYNC_ID or IRIDIUM_SYNC_KEY environment variables.");
    console.error("Set these in your MCP server configuration.");
    process.exit(1);
}

const apiClient = new ApiClient(syncId, syncKey);

const server = new McpServer({
    name: "iridium",
    version: "1.0.0",
});

// Register all tools
registerWorkoutTools(server, apiClient);
registerNutritionTools(server, apiClient);
registerExerciseTools(server, apiClient);
registerBodyTools(server, apiClient);
registerProfileTools(server, apiClient);
registerRecoveryTools(server, apiClient);
registerScheduleTools(server, apiClient);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
