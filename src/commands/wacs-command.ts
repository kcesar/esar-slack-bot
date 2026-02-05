import { MessageAttachment } from "@slack/web-api";
import { asLookup, equalsInsensitive } from "../lib/util";
import getLogger from "../lib/logging";
import { TeamMember } from "../model/types";
import ModelBuilder from "../model/model-builder";
import { TrainingPlatform } from "../platforms/types";
import SlackPlatform, { SlackUser, SlashCommandLite } from "../platforms/slack-platform";
import TeamModelContainer from "../model/team-model";

interface Platforms {
  training: TrainingPlatform,
  slack: SlackPlatform,
};

const logger = getLogger('command-wacs');
/**
 * 
 * @param email 
 * @param d4h 
 * @returns 
 */
async function getTrainingMessage(member: TeamMember, training: TrainingPlatform): Promise<[string, MessageAttachment[]?]> {
  const quals = asLookup(await training.getAwardsForMember(member), a => a.qualification.title);
  const lines: string[] = [];
  const now = new Date().getTime();
  for (const group of member.groups) {
    if (!group.expectations?.length) continue;

    lines.push(`*${group.title}*`);
    for (const e of group.expectations) {
      const qual = quals[e.qualification.title];
      let status = '❌';
      if (qual) {
        const expires = qual.expires == null ? null : new Date(qual.expires).getTime();
        const remaining = expires == null ? null : expires - now;
        if (remaining != null && remaining < 6 * 30 * 24 * 3600 * 1000) {
          status = remaining > 0 ? '⚠️' : status;
        } else {
          status = '✅';
        }
      }
      lines.push(`${status} ${e.qualification.title}`)
    }
  }

  return [`WACS and other required training for ${member.teamEmail}`, [{ text: `${lines.join('\n')}` }]];
}

/**
 * 
 * @param d4h 
 * @returns 
 */
async function getExpectationsMessage(model: TeamModelContainer): Promise<[string, MessageAttachment]> {
  const groupsWithExpectations = model.getAllGroups().filter(f => f.expectations.length > 0);

  let count = 0;
  const lines: string[] = [];
  for (const group of groupsWithExpectations) {
    lines.push(group.title);
    lines.push(...group.expectations.map(e => `- ${e.qualification.title}`))
    count++;
  }

  return [`${count} groups with expectations:`, { text: '```\n' + lines.join('\n') + '\n```\n' }];
}

/**
 * 
 * @param slack 
 * @param body 
 * @returns 
 */
export default async function doWacsCommand(buildModel: () => Promise<ModelBuilder>, platforms: Platforms, body: SlashCommandLite) {
  const { training, slack } = platforms;
  
  logger.info(`CMD: "${body.text}" from ${body.user_id}`);
  
  const start = new Date().getTime();
  const modelBuilder = await buildModel();
  const model = modelBuilder.buildModel();
  logger.debug(`model time ${new Date().getTime() - start}`);

  if (body.text === 'expectations') {
    const [t, a] = await getExpectationsMessage(model);
    slack.post(body.channel_id, t, { attachments: [a] });
    return;
  }
  const { ts } = await slack.post(body.channel_id, "Hang on a minute ...");
  logger.debug(`hang on time ${new Date().getTime() - start}`);


  const members = model.getAllMembers();

  let email: string | undefined;
  if (!body.text || equalsInsensitive(body.text, 'me') || equalsInsensitive(body.text, 'mine') || equalsInsensitive(body.text, 'self')) {
    email = members.find(m => (m.platforms[SlackPlatform.name] as SlackUser)?.id === body.user_id)?.teamEmail;
    logger.debug(`email time ${new Date().getTime() - start}`);
  } else if (body.text.startsWith('<mailto:')) {
    email = body.text.split(/[:|]/)[1];
  } else if (body.text.includes('@')) {
    email = body.text;
  } else {
    logger.debug('finding user by name');
    const emails = members.filter(f => equalsInsensitive(f.name.preferredFull, body.text));
    logger.debug(`matching emails ${emails}`);
    if (emails.length == 1) {
      email = emails[0].teamEmail;
    }
  }
  const member = email ? members.find(f => f.teamEmail === email) : undefined;
  logger.debug(`member time ${email} ${new Date().getTime() - start}`);
  let attachments: MessageAttachment[] | undefined = undefined;
  let text: string;
  if (!member) {
    text = `I don't know "${body.text}".`;
  } else {
    [text, attachments] = await getTrainingMessage(member, training);
  }

  logger.info(`/wacs time ${new Date().getTime() - start}`);
  await slack.post(body.channel_id, text, { attachments, replaceTs: ts });
}