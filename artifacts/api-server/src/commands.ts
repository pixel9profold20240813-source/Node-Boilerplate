import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import {
  adjustXp,
  getLeaderboard,
  getUserRank,
  getUserXp,
  levelForXp,
  progressForXp,
} from "./lib/xp";

function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  const member = interaction.member;
  if (!(member instanceof GuildMember)) return false;
  return member.roles.cache.some(
    (r) => r.name.toLowerCase() === "admin",
  );
}

export interface BotCommand {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const levelCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("level")
    .setDescription("Show XP and level for yourself or another user")
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
      await interaction.reply({
        content: `${target.username} has not earned any XP yet.`,
        ephemeral: true,
      });
      return;
    }

    const { level, xpIntoLevel, xpNeededForNext } = progressForXp(record.xp);
    const rank = getUserRank(target.id);

    const embed = new EmbedBuilder()
      .setTitle(`${target.username}'s level`)
      .setThumbnail(target.displayAvatarURL())
      .setColor(0x5865f2)
      .addFields(
        { name: "Level", value: String(level), inline: true },
        { name: "Total XP", value: String(record.xp), inline: true },
        {
          name: "Rank",
          value: rank ? `#${rank}` : "Unranked",
          inline: true,
        },
        {
          name: "Progress",
          value: renderProgressBar(xpIntoLevel, xpNeededForNext),
        },
      );

    await interaction.reply({ embeds: [embed] });
  },
};

const rankCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Show your rank on the server"),
  async execute(interaction) {
    const record = getUserXp(interaction.user.id);
    if (!record) {
      await interaction.reply({
        content: "You have not earned any XP yet. Send a message to get started!",
        ephemeral: true,
      });
      return;
    }
    const rank = getUserRank(interaction.user.id);
    const level = levelForXp(record.xp);
    await interaction.reply(
      `You are rank **#${rank ?? "?"}** with **${record.xp} XP** (level **${level}**).`,
    );
  },
};

const leaderboardCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the top XP earners"),
  async execute(interaction) {
    const top = getLeaderboard(10);
    if (top.length === 0) {
      await interaction.reply("No XP has been earned yet. Be the first!");
      return;
    }

    const lines = top.map((u) => {
      const medal =
        u.rank === 1
          ? "🥇"
          : u.rank === 2
            ? "🥈"
            : u.rank === 3
              ? "🥉"
              : `\`#${u.rank}\``;
      return `${medal} **${u.username}** — Level ${u.level} (${u.xp} XP)`;
    });

    const embed = new EmbedBuilder()
      .setTitle("XP Leaderboard")
      .setColor(0xfee75c)
      .setDescription(lines.join("\n"));

    await interaction.reply({ embeds: [embed] });
  },
};

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

    const embed = new EmbedBuilder()
      .setTitle("XP Added")
      .setColor(0x57f287)
      .setDescription(
        `Added **+${amount} XP** to ${target.toString()}.\n` +
          `New total: **${result.totalXp} XP** (Level **${result.newLevel}**)` +
          (result.leveledUp ? ` 🎉 Level up!` : ""),
      );

    await interaction.reply({ embeds: [embed] });
  },
};

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

    const actualRemoved = amount - Math.max(0, amount - (result.totalXp + amount));

    const embed = new EmbedBuilder()
      .setTitle("XP Removed")
      .setColor(0xed4245)
      .setDescription(
        `Removed **-${actualRemoved} XP** from ${target.toString()}.\n` +
          `New total: **${result.totalXp} XP** (Level **${result.newLevel}**)` +
          (result.leveledDown ? ` ⬇️ Level down.` : ""),
      );

    await interaction.reply({ embeds: [embed] });
  },
};

function renderProgressBar(current: number, total: number, width = 20): string {
  if (total <= 0) return `${current} XP`;
  const ratio = Math.max(0, Math.min(1, current / total));
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `\`${bar}\` ${current} / ${total} XP`;
}

export const commands: BotCommand[] = [
  levelCommand,
  rankCommand,
  leaderboardCommand,
  addXpCommand,
  removeXpCommand,
];
