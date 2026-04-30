import {
  Client,
  Events,
  GatewayIntentBits,
  type Interaction,
  type Message,
  REST,
  Routes,
} from "discord.js";
import { commands } from "./commands";
import { logger } from "./lib/logger";
import { awardXp, loadXpStore } from "./lib/xp";

export async function startBot(token: string): Promise<Client> {
  await loadXpStore();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const commandMap = new Map(commands.map((c) => [c.data.name, c]));

  client.once(Events.ClientReady, async (c) => {
    logger.info({ user: c.user.tag, id: c.user.id }, "Discord bot ready");
    try {
      await registerCommands(token, c.user.id);
    } catch (err) {
      logger.error({ err }, "Failed to register slash commands");
    }
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = commandMap.get(interaction.commandName);
    if (!command) {
      logger.warn(
        { commandName: interaction.commandName },
        "Unknown command received",
      );
      return;
    }
    try {
      await command.execute(interaction);
    } catch (err) {
      logger.error(
        { err, commandName: interaction.commandName },
        "Command execution failed",
      );
      const errorMessage = "Something went wrong running that command.";
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const result = await awardXp(message.author.id, message.author.username);
    if (!result) return;

    if (result.leveledUp) {
      try {
        if (message.channel.isSendable()) {
          await message.channel.send(
            `🎉 ${message.author.toString()} just reached **level ${result.newLevel}**!`,
          );
        }
      } catch (err) {
        logger.warn(
          { err, channelId: message.channelId },
          "Could not send level-up message",
        );
      }
    }
  });

  client.on(Events.Error, (err) => {
    logger.error({ err }, "Discord client error");
  });

  await client.login(token);
  return client;
}

async function registerCommands(
  token: string,
  applicationId: string,
): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token);
  const body = commands.map((c) => c.data.toJSON());
  await rest.put(Routes.applicationCommands(applicationId), { body });
  logger.info({ count: body.length }, "Registered global slash commands");
}
