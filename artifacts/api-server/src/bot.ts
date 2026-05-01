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
import { updateRoles } from "./lib/roles";
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
    console.log(`[BOT READY] Logged in as ${c.user.tag}`);
    try {
      await registerCommands(token, c.user.id);
    } catch (err) {
      logger.error({ err }, "Failed to register slash commands");
    }
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      console.log(
        `[INTERACTION] type=${interaction.type} isChatInput=${interaction.isChatInputCommand()}`,
      );

      if (!interaction.isChatInputCommand()) return;

      console.log(`INTERACTION RECEIVED: ${interaction.commandName}`);

      await interaction.deferReply();

      const command = commandMap.get(interaction.commandName);
      if (!command) {
        logger.warn(
          { commandName: interaction.commandName },
          "Unknown command received",
        );
        await interaction.editReply("Unknown command.");
        return;
      }

      await command.execute(interaction);

      console.log(`[COMMAND EXECUTED] ${interaction.commandName}`);
    } catch (err) {
      console.error("INTERACTION ERROR:", err);
      logger.error(
        { err, commandName: interaction.isChatInputCommand() ? interaction.commandName : "?" },
        "Interaction handler error",
      );
      try {
        if (interaction.isChatInputCommand()) {
          if (interaction.deferred) {
            await interaction.editReply("系統錯誤");
          } else if (!interaction.replied) {
            await interaction.reply({ content: "系統錯誤", ephemeral: true });
          }
        }
      } catch {
        /* suppress */
      }
    }
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const result = await awardXp(message.author.id, message.author.username);

    if ((result.leveledUp || result.isFirstMessage) && message.member) {
      updateRoles(message.member, result.newLevel).catch((err) => {
        logger.warn({ err, userId: message.author.id }, "Role update failed");
      });
    }

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
    console.error("[CLIENT ERROR]", err);
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
  console.log(`[COMMANDS] Registered ${body.length} global slash commands`);
}
