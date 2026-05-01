import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";

export interface CardOptions {
  username: string;
  avatarUrl: string;
  level: number;
  rank: number;
  currentXp: number;
  xpIntoLevel: number;
  xpNeededForNext: number;
  accentColor?: string;
}

const W = 934;
const H = 282;
const AVATAR_SIZE = 148;
const AVATAR_X = 30;
const AVATAR_Y = (H - AVATAR_SIZE) / 2;
const BAR_X = 220;
const BAR_Y = 196;
const BAR_W = 670;
const BAR_H = 36;
const BAR_RADIUS = 18;

function levelColor(level: number): [string, string] {
  const palettes: [string, string][] = [
    ["#7289DA", "#5B6EAE"],
    ["#43B581", "#2D8A5F"],
    ["#FAA61A", "#C47E00"],
    ["#F04747", "#A02D2D"],
    ["#9B59B6", "#6D3A80"],
    ["#1ABC9C", "#118A6E"],
    ["#E91E63", "#A0134A"],
    ["#FF5722", "#B33D17"],
  ];
  return palettes[level % palettes.length];
}

function roundedRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export async function generateProfileCard(opts: CardOptions): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const [colorA, colorB] = levelColor(opts.level);

  // ── Background ────────────────────────────────────────────────────────────
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, "#1a1c20");
  bgGrad.addColorStop(1, "#23272a");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Subtle diagonal stripe texture
  ctx.save();
  ctx.globalAlpha = 0.04;
  for (let i = -H; i < W + H; i += 28) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.lineWidth = 14;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }
  ctx.restore();

  // Accent left bar
  const accentGrad = ctx.createLinearGradient(0, 0, 0, H);
  accentGrad.addColorStop(0, colorA);
  accentGrad.addColorStop(1, colorB);
  ctx.fillStyle = accentGrad;
  ctx.fillRect(0, 0, 8, H);

  // ── Avatar ────────────────────────────────────────────────────────────────
  const cx = AVATAR_X + AVATAR_SIZE / 2;
  const cy = AVATAR_Y + AVATAR_SIZE / 2;
  const radius = AVATAR_SIZE / 2;

  // Glow ring
  const glowGrad = ctx.createRadialGradient(cx, cy, radius - 4, cx, cy, radius + 10);
  glowGrad.addColorStop(0, colorA + "80");
  glowGrad.addColorStop(1, colorA + "00");
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 10, 0, Math.PI * 2);
  ctx.fill();

  // Accent ring
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = colorA;
  ctx.stroke();

  // Clip and draw avatar
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  try {
    const avatarBuf = await fetchImageBuffer(
      opts.avatarUrl.replace(".webp", ".png") + "?size=256",
    );
    const avatar = await loadImage(avatarBuf);
    ctx.drawImage(avatar, AVATAR_X, AVATAR_Y, AVATAR_SIZE, AVATAR_SIZE);
  } catch {
    ctx.fillStyle = "#36393f";
    ctx.fillRect(AVATAR_X, AVATAR_Y, AVATAR_SIZE, AVATAR_SIZE);
    ctx.fillStyle = "#72767d";
    ctx.font = "bold 60px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(opts.username[0].toUpperCase(), cx, cy);
  }
  ctx.restore();

  // ── Level badge ───────────────────────────────────────────────────────────
  const badgeText = `LEVEL ${opts.level}`;
  ctx.font = "bold 22px sans-serif";
  const badgeW = ctx.measureText(badgeText).width + 28;
  const badgeX = W - badgeW - 24;
  const badgeY = 22;
  const badgeH = 36;

  const badgeGrad = ctx.createLinearGradient(badgeX, 0, badgeX + badgeW, 0);
  badgeGrad.addColorStop(0, colorA);
  badgeGrad.addColorStop(1, colorB);
  roundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 8);
  ctx.fillStyle = badgeGrad;
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2);

  // ── Username ──────────────────────────────────────────────────────────────
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const maxUsernameW = W - BAR_X - 160;
  ctx.font = "bold 46px sans-serif";
  let username = opts.username;
  while (ctx.measureText(username).width > maxUsernameW && username.length > 1) {
    username = username.slice(0, -1);
  }
  if (username.length < opts.username.length) username += "…";

  ctx.fillStyle = "#ffffff";
  ctx.fillText(username, BAR_X, 110);

  // ── Rank ──────────────────────────────────────────────────────────────────
  const rankStr = `#${opts.rank}`;
  ctx.font = "bold 40px sans-serif";
  const rankW = ctx.measureText(rankStr).width;
  ctx.fillStyle = colorA;
  ctx.fillText(rankStr, W - rankW - 24, 110);

  // ── XP label ─────────────────────────────────────────────────────────────
  ctx.font = "22px sans-serif";
  ctx.fillStyle = "#b9bbbe";
  ctx.fillText("XP", BAR_X, 165);

  ctx.textAlign = "right";
  ctx.fillStyle = "#dcddde";
  ctx.fillText(
    `${opts.xpIntoLevel.toLocaleString()} / ${opts.xpNeededForNext.toLocaleString()} XP`,
    BAR_X + BAR_W,
    165,
  );

  // Total XP
  ctx.fillStyle = "#72767d";
  ctx.font = "19px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`Total: ${opts.currentXp.toLocaleString()} XP`, BAR_X, 260);

  // ── Progress bar track ────────────────────────────────────────────────────
  roundedRect(ctx, BAR_X, BAR_Y, BAR_W, BAR_H, BAR_RADIUS);
  ctx.fillStyle = "#484b51";
  ctx.fill();

  // Progress bar fill
  const ratio = opts.xpNeededForNext > 0
    ? Math.max(0, Math.min(1, opts.xpIntoLevel / opts.xpNeededForNext))
    : 1;
  const fillW = Math.max(BAR_RADIUS * 2, BAR_W * ratio);

  const fillGrad = ctx.createLinearGradient(BAR_X, 0, BAR_X + fillW, 0);
  fillGrad.addColorStop(0, colorB);
  fillGrad.addColorStop(1, colorA);
  roundedRect(ctx, BAR_X, BAR_Y, fillW, BAR_H, BAR_RADIUS);
  ctx.fillStyle = fillGrad;
  ctx.fill();

  // Percentage text inside bar
  if (ratio > 0.08) {
    ctx.fillStyle = "#ffffffcc";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      `${Math.floor(ratio * 100)}%`,
      BAR_X + fillW / 2,
      BAR_Y + BAR_H / 2,
    );
  }

  return canvas.encode("png");
}

export interface LeaderboardCardOptions {
  entries: Array<{
    rank: number;
    username: string;
    avatarUrl: string;
    level: number;
    xp: number;
  }>;
}

export async function generateLeaderboardCard(
  opts: LeaderboardCardOptions,
): Promise<Buffer> {
  const ROW_H = 72;
  const PADDING = 16;
  const AV = 48;
  const cardH = PADDING + opts.entries.length * (ROW_H + 4) + PADDING;
  const cardW = 700;

  const canvas = createCanvas(cardW, cardH);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#1e2124";
  ctx.fillRect(0, 0, cardW, cardH);

  // Title row
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("🏆  XP Leaderboard", cardW / 2, PADDING + 28);

  const startY = PADDING + 44;

  for (let i = 0; i < opts.entries.length; i++) {
    const entry = opts.entries[i];
    const rowY = startY + i * (ROW_H + 4);
    const [colorA] = levelColor(entry.level);

    // Row background
    const isTop3 = entry.rank <= 3;
    ctx.fillStyle = isTop3 ? "#2c2f33" : "#23272a";
    roundedRect(ctx, PADDING, rowY, cardW - PADDING * 2, ROW_H, 8);
    ctx.fill();

    // Left accent bar
    ctx.fillStyle = isTop3 ? colorA : "#4f545c";
    ctx.fillRect(PADDING, rowY, 4, ROW_H);

    // Rank
    const medals = ["🥇", "🥈", "🥉"];
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (entry.rank <= 3) {
      ctx.font = "26px sans-serif";
      ctx.fillText(medals[entry.rank - 1], PADDING + 26, rowY + ROW_H / 2);
    } else {
      ctx.fillStyle = "#72767d";
      ctx.font = "bold 20px sans-serif";
      ctx.fillText(`#${entry.rank}`, PADDING + 26, rowY + ROW_H / 2);
    }

    // Avatar circle
    const avX = PADDING + 52;
    const avY = rowY + (ROW_H - AV) / 2;
    const avCx = avX + AV / 2;
    const avCy = avY + AV / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(avCx, avCy, AV / 2, 0, Math.PI * 2);
    ctx.clip();
    try {
      const buf = await fetchImageBuffer(
        entry.avatarUrl.replace(".webp", ".png") + "?size=64",
      );
      const img = await loadImage(buf);
      ctx.drawImage(img, avX, avY, AV, AV);
    } catch {
      ctx.fillStyle = "#36393f";
      ctx.fillRect(avX, avY, AV, AV);
      ctx.fillStyle = "#72767d";
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(entry.username[0].toUpperCase(), avCx, avCy);
    }
    ctx.restore();

    // Username
    const textX = avX + AV + 12;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(entry.username, textX, rowY + ROW_H / 2 - 10);

    // Level + XP
    ctx.fillStyle = "#b9bbbe";
    ctx.font = "16px sans-serif";
    ctx.fillText(
      `Level ${entry.level}  ·  ${entry.xp.toLocaleString()} XP`,
      textX,
      rowY + ROW_H / 2 + 12,
    );

    // Mini progress bar
    const miniBarX = cardW - 180 - PADDING;
    const miniBarY = rowY + ROW_H / 2 - 6;
    const miniBarW = 160;
    const miniBarH = 12;
    const [, colorB2] = levelColor(entry.level);
    roundedRect(ctx, miniBarX, miniBarY, miniBarW, miniBarH, 6);
    ctx.fillStyle = "#484b51";
    ctx.fill();

    const { progressForXp } = await import("./xp");
    const prog = progressForXp(entry.xp);
    const fillRatio =
      prog.xpNeededForNext > 0
        ? Math.min(1, prog.xpIntoLevel / prog.xpNeededForNext)
        : 1;
    const miniGrad = ctx.createLinearGradient(
      miniBarX,
      0,
      miniBarX + miniBarW,
      0,
    );
    miniGrad.addColorStop(0, colorB2);
    miniGrad.addColorStop(1, colorA);
    roundedRect(
      ctx,
      miniBarX,
      miniBarY,
      Math.max(12, miniBarW * fillRatio),
      miniBarH,
      6,
    );
    ctx.fillStyle = miniGrad;
    ctx.fill();
  }

  return canvas.encode("png");
}
