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
import { awardXp, forceFlush, loadXpStore } from "./lib/xp";

const INTERACTION_TIMEOUT_MS = 3000;

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

  client.on(Events.ShardReady, (id) => {
    console.log(`[SHARD READY] shard=${id}`);
  });

  client.on(Events.ShardDisconnect, (event, id) => {
    console.error(`[SHARD DISCONNECT] shard=${id} code=${event.code}`);
    logger.warn({ shardId: id, code: event.code }, "Shard disconnected");
  });

  client.on(Events.ShardReconnecting, (id) => {
    console.log(`[SHARD RECONNECTING] shard=${id}`);
    logger.info({ shardId: id }, "Shard reconnecting");
  });

  client.on(Events.ShardResume, (id, replayed) => {
    console.log(`[SHARD RESUME] shard=${id} replayed=${replayed}`);
    logger.info({ shardId: id, replayed }, "Shard resumed");
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    console.log(
      `INTERACTION RECEIVED: ${interaction.isChatInputCommand() ? interaction.commandName : `type=${interaction.type}`}`,
    );

    try {
      if (!interaction.isChatInputCommand()) return;

      const deferPromise = interaction.deferReply().catch((err) => {
        console.error("Defer failed:", err);
      });

      const timeout = setTimeout(() => {
        console.error(
          `⚠️ Interaction timeout fallback triggered: ${interaction.commandName}`,
        );
      }, INTERACTION_TIMEOUT_MS);

      await deferPromise;

      const command = commandMap.get(interaction.commandName);
      if (!command) {
        clearTimeout(timeout);
        logger.warn(
          { commandName: interaction.commandName },
          "Unknown command received",
        );
        await interaction.editReply("Unknown command.");
        return;
      }

      await command.execute(interaction);

      clearTimeout(timeout);

      console.log(`[COMMAND EXECUTED]: ${interaction.commandName}`);
    } catch (err) {
      console.error("INTERACTION ERROR:", err);
      logger.error(
        {
          err,
          commandName: interaction.isChatInputCommand()
            ? interaction.commandName
            : "?",
        },
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
      } catch (e) {
        console.error("FATAL REPLY FAILURE:", e);
      }
    }
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    try {
      const result = awardXp(message.author.id, message.author.username);

      if ((result.leveledUp || result.isFirstMessage) && message.member) {
        setImmediate(() => {
          updateRoles(message.member!, result.newLevel).catch((err) => {
            logger.warn({ err, userId: message.author.id }, "Role update failed");
          });
        });
      }

      if (result.leveledUp) {
        if (message.channel.isSendable()) {
          message.channel
            .send(
              `🎉 ${message.author.toString()} just reached **level ${result.newLevel}**!`,
            )
            .catch((err) => {
              logger.warn(
                { err, channelId: message.channelId },
                "Could not send level-up message",
              );
            });
        }
      }
    } catch (err) {
      logger.error({ err, userId: message.author.id }, "Message XP handler error");
    }
  });

  client.on(Events.Error, (err) => {
    logger.error({ err }, "Discord client error");
    console.error("[CLIENT ERROR]", err);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Graceful shutdown: flushing XP");
    console.log(`[SHUTDOWN] ${signal} — flushing XP store`);
    try {
      await forceFlush();
    } catch (err) {
      console.error("[SHUTDOWN] Flush failed:", err);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

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
