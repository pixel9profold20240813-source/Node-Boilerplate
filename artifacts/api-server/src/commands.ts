import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import {
  getLeaderboard,
  getUserRank,
  getUserXp,
  levelForXp,
  progressForXp,
} from "./lib/xp";

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
];
