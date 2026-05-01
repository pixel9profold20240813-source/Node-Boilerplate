import { type Guild, type GuildMember } from "discord.js";
import { logger } from "./logger";

const ROLE_BEGINNER = "Beginner";
const ROLE_LV2 = "Lv2";

export async function updateRoles(
  member: GuildMember,
  level: number,
): Promise<void> {
  const guild = member.guild;

  await guild.roles.fetch();

  const beginnerRole = guild.roles.cache.find(
    (r) => r.name === ROLE_BEGINNER,
  );
  const lv2Role = guild.roles.cache.find((r) => r.name === ROLE_LV2);

  try {
    if (level < 2) {
      if (beginnerRole && !member.roles.cache.has(beginnerRole.id)) {
        await member.roles.add(beginnerRole);
        logger.debug({ userId: member.id, role: ROLE_BEGINNER }, "Added role");
      }
      if (lv2Role && member.roles.cache.has(lv2Role.id)) {
        await member.roles.remove(lv2Role);
        logger.debug({ userId: member.id, role: ROLE_LV2 }, "Removed role");
      }
    } else {
      if (beginnerRole && member.roles.cache.has(beginnerRole.id)) {
        await member.roles.remove(beginnerRole);
        logger.debug(
          { userId: member.id, role: ROLE_BEGINNER },
          "Removed role",
        );
      }
      if (lv2Role && !member.roles.cache.has(lv2Role.id)) {
        await member.roles.add(lv2Role);
        logger.debug({ userId: member.id, role: ROLE_LV2 }, "Added role");
      }
    }
  } catch (err) {
    logger.warn({ err, userId: member.id, level }, "Failed to update roles");
  }
}

export async function fetchMember(
  guild: Guild,
  userId: string,
): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}
