import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "./logger";

export interface UserXp {
  userId: string;
  username: string;
  xp: number;
  lastAwardedAt: number;
}

interface XpStoreShape {
  users: Record<string, UserXp>;
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "xp.json");

const MIN_AWARD = 15;
const MAX_AWARD = 25;

let store: XpStoreShape = { users: {} };
let writeQueue: Promise<void> = Promise.resolve();

export async function loadXpStore(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<XpStoreShape>;
    store = { users: parsed.users ?? {} };
    logger.info(
      { users: Object.keys(store.users).length },
      "Loaded XP store",
    );
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.info("No existing XP store found; starting fresh");
      store = { users: {} };
      await persist();
    } else {
      logger.error({ err }, "Failed to load XP store");
      throw err;
    }
  }
}

function persist(): Promise<void> {
  writeQueue = writeQueue
    .then(async () => {
      const tmp = `${DATA_FILE}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
      await fs.rename(tmp, DATA_FILE);
    })
    .catch((err) => {
      logger.error({ err }, "Failed to persist XP store");
    });
  return writeQueue;
}

export function levelForXp(xp: number): number {
  if (xp <= 0) return 0;
  return Math.floor(Math.sqrt(xp / 100));
}

export function xpForLevel(level: number): number {
  return level * level * 100;
}

export function progressForXp(xp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpNeededForNext: number;
} {
  const level = levelForXp(xp);
  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  return {
    level,
    currentLevelXp,
    nextLevelXp,
    xpIntoLevel: xp - currentLevelXp,
    xpNeededForNext: nextLevelXp - currentLevelXp,
  };
}

export interface AwardResult {
  awarded: number;
  totalXp: number;
  previousLevel: number;
  newLevel: number;
  leveledUp: boolean;
}

export async function awardXp(
  userId: string,
  username: string,
): Promise<AwardResult> {
  const now = Date.now();
  const existing = store.users[userId];
  const previousXp = existing?.xp ?? 0;
  const previousLevel = levelForXp(previousXp);
  const awarded =
    Math.floor(Math.random() * (MAX_AWARD - MIN_AWARD + 1)) + MIN_AWARD;
  const totalXp = previousXp + awarded;
  const newLevel = levelForXp(totalXp);

  store.users[userId] = {
    userId,
    username,
    xp: totalXp,
    lastAwardedAt: now,
  };

  await persist();

  return {
    awarded,
    totalXp,
    previousLevel,
    newLevel,
    leveledUp: newLevel > previousLevel,
  };
}

export interface AdjustResult {
  delta: number;
  totalXp: number;
  previousLevel: number;
  newLevel: number;
  leveledUp: boolean;
  leveledDown: boolean;
}

export async function adjustXp(
  userId: string,
  username: string,
  delta: number,
): Promise<AdjustResult> {
  const existing = store.users[userId];
  const previousXp = existing?.xp ?? 0;
  const previousLevel = levelForXp(previousXp);
  const totalXp = Math.max(0, previousXp + delta);
  const newLevel = levelForXp(totalXp);

  store.users[userId] = {
    userId,
    username,
    xp: totalXp,
    lastAwardedAt: existing?.lastAwardedAt ?? Date.now(),
  };

  await persist();

  return {
    delta,
    totalXp,
    previousLevel,
    newLevel,
    leveledUp: newLevel > previousLevel,
    leveledDown: newLevel < previousLevel,
  };
}

export function getUserXp(userId: string): UserXp | null {
  return store.users[userId] ?? null;
}

export interface RankedUser extends UserXp {
  rank: number;
  level: number;
}

export function getLeaderboard(limit = 10): RankedUser[] {
  return Object.values(store.users)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit)
    .map((u, idx) => ({
      ...u,
      rank: idx + 1,
      level: levelForXp(u.xp),
    }));
}

export function getUserRank(userId: string): number | null {
  const sorted = Object.values(store.users).sort((a, b) => b.xp - a.xp);
  const idx = sorted.findIndex((u) => u.userId === userId);
  return idx === -1 ? null : idx + 1;
}

export function getTotalUsers(): number {
  return Object.keys(store.users).length;
}
