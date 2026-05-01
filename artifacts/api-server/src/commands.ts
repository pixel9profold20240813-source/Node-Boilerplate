import {
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import { generateLeaderboardCard, generateProfileCard } from "./lib/card";
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

export interface BotCommand {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
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
    await interaction.deferReply();

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

    const cardBuffer = await generateProfileCard({
      username: target.username,
      avatarUrl,
      level,
      rank,
      currentXp: record.xp,
      xpIntoLevel,
      xpNeededForNext,
    });

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
    await interaction.deferReply();

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

    const cardBuffer = await generateProfileCard({
      username: interaction.user.username,
      avatarUrl,
      level,
      rank,
      currentXp: record.xp,
      xpIntoLevel,
      xpNeededForNext,
    });

    const attachment = new AttachmentBuilder(cardBuffer, {
      name: "rank-card.png",
    });

    await interaction.editReply({ files: [attachment] });
  },
};

// ── /leaderboard ──────────────────────────────────────────────────────────────

const leaderboardCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the top XP earners with a visual leaderboard"),
  async execute(interaction) {
    await interaction.deferReply();

    const top = getLeaderboard(10);
    if (top.length === 0) {
      await interaction.editReply(
        "No XP has been earned yet. Be the first!",
      );
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

    const cardBuffer = await generateLeaderboardCard({ entries });
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
      await interaction.reply({
        content: "You need the **Admin** role to use this command.",
        ephemeral: true,
      });
      return;
    }

    const target = interaction.options.getUser("user") ?? interaction.user;
    const amount = interaction.options.getInteger("amount", true);
    const result = await adjustXp(target.id, target.username, amount);

    if (interaction.guild) {
      const member = await fetchMember(interaction.guild, target.id);
      if (member) await updateRoles(member, result.newLevel);
    }

    const embed = new EmbedBuilder()
      .setTitle("XP Added")
      .setColor(0x57f287)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `Added **+${amount} XP** to ${target.toString()}.\n` +
          `New total: **${result.totalXp.toLocaleString()} XP** — Level **${result.newLevel}**` +
          (result.leveledUp ? `\n🎉 They leveled up!` : ""),
      );

    await interaction.reply({ embeds: [embed] });
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
      await interaction.reply({
        content: "You need the **Admin** role to use this command.",
        ephemeral: true,
      });
      return;
    }

    const target = interaction.options.getUser("user") ?? interaction.user;
    const amount = interaction.options.getInteger("amount", true);
    const result = await adjustXp(target.id, target.username, -amount);
    const actualRemoved = amount - Math.max(0, -result.delta + result.totalXp);

    if (interaction.guild) {
      const member = await fetchMember(interaction.guild, target.id);
      if (member) await updateRoles(member, result.newLevel);
    }

    const embed = new EmbedBuilder()
      .setTitle("XP Removed")
      .setColor(0xed4245)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `Removed **-${actualRemoved} XP** from ${target.toString()}.\n` +
          `New total: **${result.totalXp.toLocaleString()} XP** — Level **${result.newLevel}**` +
          (result.leveledDown ? `\n⬇️ They lost a level.` : ""),
      );

    await interaction.reply({ embeds: [embed] });
  },
};

// ── /xpreset ──────────────────────────────────────────────────────────────────

const xpResetCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("xpreset")
    .setDescription("[Admin] Reset a user's XP to 0")
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("The user to reset")
        .setRequired(true),
    ),
  async execute(interaction) {
    if (!isAdmin(interaction)) {
      await interaction.reply({
        content: "You need the **Admin** role to use this command.",
        ephemeral: true,
      });
      return;
    }

    const target = interaction.options.getUser("user", true);
    const prevRecord = getUserXp(target.id);
    const prevXp = prevRecord?.xp ?? 0;
    const prevLevel = levelForXp(prevXp);

    await adjustXp(target.id, target.username, -prevXp);

    if (interaction.guild) {
      const member = await fetchMember(interaction.guild, target.id);
      if (member) await updateRoles(member, 0);
    }

    const embed = new EmbedBuilder()
      .setTitle("XP Reset")
      .setColor(0xfaa61a)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `Reset **${target.toString()}** from **${prevXp.toLocaleString()} XP** (Level ${prevLevel}) back to **0 XP** (Level 0).\nTheir role has been set to **Beginner**.`,
      );

    await interaction.reply({ embeds: [embed] });
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
      await interaction.reply({
        content: "You need the **Admin** role to use this command.",
        ephemeral: true,
      });
      return;
    }

    const target = interaction.options.getUser("user", true);
    const targetLevel = interaction.options.getInteger("level", true);
    const targetXp = xpForLevel(targetLevel);

    const prevRecord = getUserXp(target.id);
    const prevXp = prevRecord?.xp ?? 0;
    const delta = targetXp - prevXp;

    await adjustXp(target.id, target.username, delta);

    if (interaction.guild) {
      const member = await fetchMember(interaction.guild, target.id);
      if (member) await updateRoles(member, targetLevel);
    }

    const embed = new EmbedBuilder()
      .setTitle("Level Set")
      .setColor(0x5865f2)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `Set **${target.toString()}** to **Level ${targetLevel}** (**${targetXp.toLocaleString()} XP**).` +
          `\nPrevious: ${prevXp.toLocaleString()} XP (Level ${levelForXp(prevXp)}).`,
      );

    await interaction.reply({ embeds: [embed] });
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
];
