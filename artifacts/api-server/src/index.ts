import http from "node:http";
import { startBot } from "./bot";
import { logger } from "./lib/logger";
import { getTotalUsers } from "./lib/xp";

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
  logger.error({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
  logger.error({ err }, "Uncaught exception");
});

const token = process.env["DISCORD_BOT_TOKEN"];

if (!token) {
  throw new Error(
    "DISCORD_BOT_TOKEN environment variable is required but was not provided.",
  );
}

const rawPort = process.env["PORT"];
const port = rawPort ? Number(rawPort) : 8080;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const healthServer = http.createServer((req, res) => {
  if (req.url === "/api/healthz" || req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", users: getTotalUsers() }));
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

healthServer.listen(port, () => {
  logger.info({ port }, "Health server listening");
});

startBot(token).catch((err) => {
  logger.error({ err }, "Failed to start Discord bot");
  process.exit(1);
});

const shutdown = (signal: string) => {
  logger.info({ signal }, "Shutting down");
  healthServer.close(() => process.exit(0));
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
