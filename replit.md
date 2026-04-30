# Workspace

## Overview

pnpm workspace monorepo using TypeScript. The primary artifact is a Discord bot
(`@workspace/api-server`) with a simple XP leveling system.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Bot framework**: discord.js v14
- **Logging**: pino + pino-pretty
- **Persistence**: local JSON file at `data/xp.json` (relative to bot CWD)
- **Build**: esbuild (ESM bundle)

## Discord Bot

Located at `artifacts/api-server/`.

- Entry point: `src/index.ts` — boots the bot and a tiny HTTP `/api/healthz`
  health endpoint on `PORT` (default 8080).
- `src/bot.ts` — discord.js client setup, slash command registration, message
  XP awarding, level-up announcements.
- `src/commands.ts` — slash command definitions: `/level`, `/rank`,
  `/leaderboard`.
- `src/lib/xp.ts` — XP store, level math, persistence to `data/xp.json`.
- `src/lib/logger.ts` — pino logger.

### XP rules

- Awards 15–25 XP per message, with a 60s per-user cooldown.
- Level formula: `level = floor(sqrt(xp / 100))`.
- XP needed for level `n` is `100 * n^2` total.

### Required secrets

- `DISCORD_BOT_TOKEN` — token from the Discord Developer Portal.

### Required Discord setup

1. Create an application at https://discord.com/developers/applications.
2. Add a Bot to the application; copy the token into `DISCORD_BOT_TOKEN`.
3. Enable the **Message Content Intent** in the Bot settings (required to
   read message content for XP awarding).
4. Invite the bot with the `bot` and `applications.commands` scopes and at
   least `Send Messages` + `Read Message History` permissions.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-server run dev` — run the bot locally
- `pnpm --filter @workspace/api-server run build` — build the bot bundle

See the `pnpm-workspace` skill for workspace structure and package details.
