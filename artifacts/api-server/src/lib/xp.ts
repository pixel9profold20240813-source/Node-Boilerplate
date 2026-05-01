import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { getMultiplier } from "./multiplier";

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
const TMP_FILE = `${DATA_FILE}.tmp`;

const MIN_AWARD = 15;
const MAX_AWARD = 25;

const FLUSH_INTERVAL_MS = 5_000;
const FS_TIMEOUT_MS = 8_000;
const WATCHDOG_MS = 15_000;

let store: XpStoreShape = { users: {} };
let dirty = false;
let flushing = false;
let flushStartedAt = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function fsWithTimeout<T>(op: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    op,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`FS timeout: ${label}`)),
        FS_TIMEOUT_MS,
      ),
    ),
  ]);
}

async function flushNow(): Promise<void> {
  if (flushing) {
    const elapsed = Date.now() - flushStartedAt;
    if (elapsed > WATCHDOG_MS) {
      logger.warn({ elapsed }, "XP flush watchdog: resetting stuck flush");
      flushing = false;
    } else {
      return;
    }
  }
  if (!dirty) return;

  flushing = true;
  flushStartedAt = Date.now();
  dirty = false;

  try {
    const json = JSON.stringify(store, null, 2);
    await fsWithTimeout(fs.writeFile(TMP_FILE, json, "utf8"), "writeFile");
    await fsWithTimeout(fs.rename(TMP_FILE, DATA_FILE), "rename");
  } catch (err) {
    dirty = true;
    logger.error({ err }, "Failed to flush XP store");
  } finally {
    flushing = false;
  }
}

function schedulePersist(): void {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow().catch((err) => {
      logger.error({ err }, "schedulePersist flush error");
    });
  }, FLUSH_INTERVAL_MS);
}

export async function loadXpStore(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const raw = await fsWithTimeout(fs.readFile(DATA_FILE, "utf8"), "readFile");
    const parsed = JSON.parse(raw) as Partial<XpStoreShape>;
    store = { users: parsed.users ?? {} };
    logger.info({ users: Object.keys(store.users).length }, "Loaded XP store");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.info("No existing XP store found; starting fresh");
      store = { users: {} };
      schedulePersist();
    } else {
      logger.error({ err }, "Failed to load XP store");
      throw err;
    }
  }

  setInterval(() => {
    if (dirty && !flushing) {
      flushNow().catch((err) => {
        logger.error({ err }, "Periodic flush error");
      });
    }
  }, FLUSH_INTERVAL_MS * 2);
}

export async function forceFlush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushNow();
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
  baseAwarded: number;
  multiplier: number;
  totalXp: number;
  previousLevel: number;
  newLevel: number;
  leveledUp: boolean;
  isFirstMessage: boolean;
}

export function awardXp(userId: string, username: string): AwardResult {
  const now = Date.now();
  const existing = store.users[userId];
  const previousXp = existing?.xp ?? 0;
  const isFirstMessage = !existing;
  const previousLevel = levelForXp(previousXp);
  const multiplier = getMultiplier();
  const baseAwarded =
    Math.floor(Math.random() * (MAX_AWARD - MIN_AWARD + 1)) + MIN_AWARD;
  const awarded = baseAwarded * multiplier;
  const totalXp = previousXp + awarded;
  const newLevel = levelForXp(totalXp);

  store.users[userId] = {
    userId,
    username,
    xp: totalXp,
    lastAwardedAt: now,
  };

  schedulePersist();

  return {
    awarded,
    baseAwarded,
    multiplier,
    totalXp,
    previousLevel,
    newLevel,
    leveledUp: newLevel > previousLevel,
    isFirstMessage,
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

  await forceFlush();

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
