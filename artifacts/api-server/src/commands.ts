import {
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
  type SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import { generateLeaderboardCard, generateProfileCard } from "./lib/card";
import {
  EVENT_MULTIPLIER,
  isEventActive,
  startEvent,
  stopEvent,
} from "./lib/multiplier";
import { fetchMember, updateRoles } from "./lib/roles";
import {
  adjustXp,
  getLeaderboard,
  getUserRank,
  getUserXp,
  levelForXp,
  progressForXp,
  xpForLevel,
} from "./lib/xp";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms),
    ),
  ]);
}

export interface BotCommand {
  data:
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  const member = interaction.member;
  if (!(member instanceof GuildMember)) return false;
  return member.roles.cache.some((r) => r.name.toLowerCase() === "admin");
}

function defaultAvatarUrl(userId: string): string {
  const index = (BigInt(userId) >> 22n) % 6n;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function fireRoleUpdate(
  interaction: ChatInputCommandInteraction,
  userId: string,
  level: number,
): void {
  if (!interaction.guild) return;
  const guild = interaction.guild;
  setImmediate(() => {
    fetchMember(guild, userId)
      .then((member) => member && updateRoles(member, level))
      .catch(() => {});
  });
}

// ── /level ────────────────────────────────────────────────────────────────────

const levelCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("level")
    .setDescription("Show XP and level card for yourself or another user")
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("The user to look up (defaults to you)")
        .setRequired(false),
    ),
  async execute(interaction) {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const record = getUserXp(target.id);

    if (!record) {
      await interaction.editReply({
        content: `**${target.username}** hasn't earned any XP yet.`,
      });
      return;
    }

    const { level, xpIntoLevel, xpNeededForNext } = progressForXp(record.xp);
    const rank = getUserRank(target.id) ?? 0;
    const avatarUrl =
      target.displayAvatarURL({ extension: "png", size: 256 }) ??
      defaultAvatarUrl(target.id);

    const cardBuffer = await withTimeout(
      generateProfileCard({
        username: target.username,
        avatarUrl,
        level,
        rank,
        currentXp: record.xp,
        xpIntoLevel,
        xpNeededForNext,
      }),
      8000,
      "generateProfileCard",
    );

    const attachment = new AttachmentBuilder(cardBuffer, {
      name: "level-card.png",
    });

    await interaction.editReply({ files: [attachment] });
  },
};

// ── /rank ─────────────────────────────────────────────────────────────────────

const rankCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Show your rank card"),
  async execute(interaction) {
    const record = getUserXp(interaction.user.id);
    if (!record) {
      await interaction.editReply({
        content:
          "You haven't earned any XP yet. Send a message to get started!",
      });
      return;
    }

    const { level, xpIntoLevel, xpNeededForNext } = progressForXp(record.xp);
    const rank = getUserRank(interaction.user.id) ?? 0;
    const avatarUrl =
      interaction.user.displayAvatarURL({ extension: "png", size: 256 }) ??
      defaultAvatarUrl(interaction.user.id);

    const cardBuffer = await withTimeout(
      generateProfileCard({
        username: interaction.user.username,
        avatarUrl,
        level,
        rank,
        currentXp: record.xp,
        xpIntoLevel,
        xpNeededForNext,
      }),
      8000,
      "generateProfileCard/rank",
    );

    const attachment = new AttachmentBuilder(cardBuffer, {
      name: "rank-card.png",
    });

    const eventBanner = isEventActive()
      ? `🔥 **XP Event Active: ${EVENT_MULTIPLIER}x Boost!**`
      : undefined;

    await interaction.editReply({ content: eventBanner, files: [attachment] });
  },
};

// ── /leaderboard ──────────────────────────────────────────────────────────────

const leaderboardCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the top XP earners with a visual leaderboard"),
  async execute(interaction) {
    const top = getLeaderboard(10);
    if (top.length === 0) {
      await interaction.editReply("No XP has been earned yet. Be the first!");
      return;
    }

    const entries = await Promise.all(
      top.map(async (u) => {
        let avatarUrl = defaultAvatarUrl(u.userId);
        try {
          const discordUser = await interaction.client.users.fetch(u.userId);
          avatarUrl =
            discordUser.displayAvatarURL({ extension: "png", size: 64 }) ??
            avatarUrl;
        } catch {
          /* use default */
        }
        return {
          rank: u.rank,
          username: u.username,
          avatarUrl,
          level: u.level,
          xp: u.xp,
        };
      }),
    );

    const cardBuffer = await withTimeout(
      generateLeaderboardCard({ entries }),
      10000,
      "generateLeaderboardCard",
    );
    const attachment = new AttachmentBuilder(cardBuffer, {
      name: "leaderboard.png",
    });

    await interaction.editReply({ files: [attachment] });
  },
};

// ── /addxp ────────────────────────────────────────────────────────────────────

const addXpCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("addxp")
    .setDescription("[Admin] Add XP to yourself or another user")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Amount of XP to add (1–100000)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100_000),
    )
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("Target user (defaults to you)")
        .setRequired(false),
    ),
  async execute(interaction) {
    if (!isAdmin(interaction)) {
      await interaction.editReply(
        "You need the **Admin** role to use this command.",
      );
      return;
    }

    const target = interaction.options.getUser("user") ?? interaction.user;
    const amount = interaction.options.getInteger("amount", true);
    const result = await adjustXp(target.id, target.username, amount);

    fireRoleUpdate(interaction, target.id, result.newLevel);

    const embed = new EmbedBuilder()
      .setTitle("XP Added")
      .setColor(0x57f287)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `Added **+${amount.toLocaleString()} XP** to ${target.toString()}.\n` +
          `New total: **${result.totalXp.toLocaleString()} XP** — Level **${result.newLevel}**` +
          (result.leveledUp ? `\n🎉 They leveled up!` : ""),
      );

    await interaction.editReply({ embeds: [embed] });
  },
};

// ── /removexp ─────────────────────────────────────────────────────────────────

const removeXpCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("removexp")
    .setDescription("[Admin] Remove XP from yourself or another user")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Amount of XP to remove (1–100000)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100_000),
    )
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("Target user (defaults to you)")
        .setRequired(false),
    ),
  async execute(interaction) {
    if (!isAdmin(interaction)) {
      await interaction.editReply(
        "You need the **Admin** role to use this command.",
      );
      return;
    }

    const target = interaction.options.getUser("user") ?? interaction.user;
    const amount = interaction.options.getInteger("amount", true);
    const prevXp = getUserXp(target.id)?.xp ?? 0;
    const actualRemoved = Math.min(amount, prevXp);
    const result = await adjustXp(target.id, target.username, -amount);

    fireRoleUpdate(interaction, target.id, result.newLevel);

    const embed = new EmbedBuilder()
      .setTitle("XP Removed")
      .setColor(0xed4245)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `Removed **-${actualRemoved.toLocaleString()} XP** from ${target.toString()}.\n` +
          `New total: **${result.totalXp.toLocaleString()} XP** — Level **${result.newLevel}**` +
          (result.leveledDown ? `\n⬇️ They lost a level.` : ""),
      );

    await interaction.editReply({ embeds: [embed] });
  },
};

// ── /xpreset ──────────────────────────────────────────────────────────────────

const xpResetCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("xpreset")
    .setDescription("[Admin] Reset a user's XP to 0")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The user to reset").setRequired(true),
    ),
  async execute(interaction) {
    if (!isAdmin(interaction)) {
      await interaction.editReply(
        "You need the **Admin** role to use this command.",
      );
      return;
    }

    const target = interaction.options.getUser("user", true);
    const prevRecord = getUserXp(target.id);
    const prevXp = prevRecord?.xp ?? 0;
    const prevLevel = levelForXp(prevXp);

    await adjustXp(target.id, target.username, -prevXp);
    fireRoleUpdate(interaction, target.id, 0);

    const embed = new EmbedBuilder()
      .setTitle("XP Reset")
      .setColor(0xfaa61a)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `Reset **${target.toString()}** from **${prevXp.toLocaleString()} XP** ` +
          `(Level ${prevLevel}) back to **0 XP** (Level 0).\n` +
          `Their role has been set to **Beginner**.`,
      );

    await interaction.editReply({ embeds: [embed] });
  },
};

// ── /setlevel ─────────────────────────────────────────────────────────────────

const setLevelCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("setlevel")
    .setDescription("[Admin] Set a user's level directly")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The user to update").setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("level")
        .setDescription("Target level (0–100)")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100),
    ),
  async execute(interaction) {
    if (!isAdmin(interaction)) {
      await interaction.editReply(
        "You need the **Admin** role to use this command.",
      );
      return;
    }

    const target = interaction.options.getUser("user", true);
    const targetLevel = interaction.options.getInteger("level", true);
    const targetXp = xpForLevel(targetLevel);
    const prevRecord = getUserXp(target.id);
    const prevXp = prevRecord?.xp ?? 0;
    const delta = targetXp - prevXp;

    await adjustXp(target.id, target.username, delta);
    fireRoleUpdate(interaction, target.id, targetLevel);

    const embed = new EmbedBuilder()
      .setTitle("Level Set")
      .setColor(0x5865f2)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `Set **${target.toString()}** to **Level ${targetLevel}** (**${targetXp.toLocaleString()} XP**).\n` +
          `Previous: ${prevXp.toLocaleString()} XP (Level ${levelForXp(prevXp)}).`,
      );

    await interaction.editReply({ embeds: [embed] });
  },
};

// ── /eventxp ──────────────────────────────────────────────────────────────────

const eventXpCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("eventxp")
    .setDescription("[Admin] Manage XP multiplier events")
    .addSubcommand((sub) =>
      sub.setName("start").setDescription(`Start a ${EVENT_MULTIPLIER}x XP event`),
    )
    .addSubcommand((sub) =>
      sub.setName("stop").setDescription("Stop the current XP event"),
    ),
  async execute(interaction) {
    if (!isAdmin(interaction)) {
      await interaction.editReply(
        "You need the **Admin** role to use this command.",
      );
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "start") {
      if (isEventActive()) {
        await interaction.editReply(
          `🔥 An XP event is already active (**${EVENT_MULTIPLIER}x** multiplier).`,
        );
        return;
      }
      startEvent();
      const embed = new EmbedBuilder()
        .setTitle("🔥 XP Event Started!")
        .setColor(0xff7700)
        .setDescription(
          `All XP gains are now **${EVENT_MULTIPLIER}x** the normal amount!\n\n` +
            `Chat away to earn boosted XP. Use \`/eventxp stop\` to end the event.`,
        );
      await interaction.editReply({ embeds: [embed] });
    } else {
      if (!isEventActive()) {
        await interaction.editReply("There is no active XP event to stop.");
        return;
      }
      stopEvent();
      const embed = new EmbedBuilder()
        .setTitle("XP Event Ended")
        .setColor(0x99aab5)
        .setDescription(
          "The XP event has ended. XP is back to **1x** normal.",
        );
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

export const commands: BotCommand[] = [
  levelCommand,
  rankCommand,
  leaderboardCommand,
  addXpCommand,
  removeXpCommand,
  xpResetCommand,
  setLevelCommand,
  eventXpCommand,
];
