import { logger } from "./logger";
import { getMultiplier } from "./multiplier";
import pg from "pg";

const { Pool } = pg;

export interface UserXp {
  userId: string;
  username: string;
  xp: number;
  lastAwardedAt: number;
}

interface XpStoreShape {
  users: Record<string, UserXp>;
}

const MIN_AWARD = 15;
const MAX_AWARD = 25;

const FLUSH_INTERVAL_MS = 5_000;
const WATCHDOG_MS = 15_000;

let store: XpStoreShape = { users: {} };
let dirty = false;
let flushing = false;
let flushStartedAt = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// 建立資料庫連線池
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function flushNow(): Promise<void> {
  if (flushing) {
    const elapsed = Date.now() - flushStartedAt;
    if (elapsed > WATCHDOG_MS) {
      logger.warn({ elapsed }, "XP 儲存監視器：正在重設卡住的程序");
      flushing = false;
    } else {
      return;
    }
  }
  if (!dirty) return;

  if (!process.env.DATABASE_URL) {
    logger.warn("未偵測到 DATABASE_URL，XP 將無法永久儲存");
    dirty = false;
    return;
  }

  flushing = true;
  flushStartedAt = Date.now();
  dirty = false;

  try {
    const users = Object.values(store.users);
    for (const u of users) {
      // 將資料寫入 Neon 資料庫，如果 ID 重複則更新數據
      await pool.query(
        `INSERT INTO users_xp (user_id, username, xp, last_awarded_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE
         SET username = EXCLUDED.username, xp = EXCLUDED.xp, last_awarded_at = EXCLUDED.last_awarded_at`,
        [u.userId, u.username, u.xp, u.lastAwardedAt]
      );
    }
  } catch (err) {
    dirty = true;
    logger.error({ err }, "寫入資料庫失敗");
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
      logger.error({ err }, "定時存檔發生錯誤");
    });
  }, FLUSH_INTERVAL_MS);
}

export async function loadXpStore(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    logger.warn("找不到 DATABASE_URL，機器人將使用臨時記憶啟動");
    store = { users: {} };
    return;
  }

  try {
    // 啟動時自動建立資料表（如果還不存在的話）
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users_xp (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0,
        last_awarded_at BIGINT NOT NULL
      )
    `);

    // 從資料庫載入所有 XP 數據
    const res = await pool.query('SELECT * FROM users_xp');
    store = { users: {} };
    for (const row of res.rows) {
      store.users[row.user_id] = {
        userId: row.user_id,
        username: row.username,
        xp: row.xp,
        lastAwardedAt: parseInt(row.last_awarded_at, 10)
      };
    }
    logger.info({ users: Object.keys(store.users).length }, "成功從雲端資料庫載入 XP 資料");
  } catch (err) {
    logger.error({ err }, "讀取資料庫失敗，將使用全新狀態啟動");
    store = { users: {} };
  }

  setInterval(() => {
    if (dirty && !flushing) {
      flushNow().catch((err) => {
        logger.error({ err }, "週期性存檔錯誤");
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
