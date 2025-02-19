import { Block, MessageAttachment } from "@slack/web-api";
import { asLookup, equalsInsensitive } from "../lib/util";
import { D4HClient } from "../lib/remote-services/d4h";
import WorkspaceClient from "../lib/remote-services/googleWorkspace";
import SlackClient, { SlashCommandLite } from "../lib/remote-services/slack";

/**
 * 
 * @param email 
 * @param d4h 
 * @returns 
 */
async function getTrainingMessage(email: string, d4h: D4HClient): Promise<[string,MessageAttachment[]?]> {
  const d4hMember = await d4h.getMemberByEmail(email);
  if (!d4hMember) {
    return [`Don't have a D4H user with email ${email}`];
  }

  const quals = asLookup(await d4h.getMemberQualifications(d4hMember.id), a => a.qualification.id);
  const lines: string[] = [];
  const now = new Date().getTime();
  for (const group of [await d4h.getOperationalGroup(), ...d4hMember.groups]) {
    if (!group.expectations?.length) continue;

    lines.push(`*${group.title}*`);
    for (const e of group.expectations) {
      const qual = quals[e.qualification.id];
      let status = '❌';
      if (qual) {
        const expires = qual.endsAt == null ? null : new Date(qual.endsAt).getTime();
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

  return [`WACS and other required training for ${email}`, [{ text: `${lines.join('\n')}` }]];
}

/**
 * 
 * @param d4h 
 * @returns 
 */
async function getExpectations(d4h: D4HClient): Promise<[string, MessageAttachment]> {
  const groupsWithExpectations = Object.values(await d4h.getGroups()).filter(g => g.expectations.length > 0);

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
 * @param d4h 
 * @param google 
 * @param body 
 * @returns 
 */
export default async function doWacsCommand(slack: SlackClient, d4h: D4HClient, google: WorkspaceClient, body: SlashCommandLite) {
  if (body.text === 'expectations') {
    const [t, a] = await getExpectations(d4h);
    slack.post(body.channel_id, t, { attachments: [a]});
    return;
  }

  let email: string|undefined;
  if (!body.text || equalsInsensitive(body.text, 'me') || equalsInsensitive(body.text, 'mine') || equalsInsensitive(body.text, 'self')) {
    email = (await slack.getMemberById(body.user_id))?.profile.email;
  } else if (body.text.startsWith('<mailto:')) {
    email = (await google.getUserFromEmail(body.text.split(/[:|]/)[1]))?.primaryEmail;
  } else if (body.text.includes('@')) {
    email = body.text
  } else {
    const emails = ((await google.getUsersByName(body.text)).filter(f => f.orgUnitPath === '/Members'));
    if (emails.length == 1) {
      email = emails[0].primaryEmail;
    }
  }

  let attachments: MessageAttachment[]|undefined = undefined;
  let text: string;
  if (!email) {
    text = `I don't know "${body.text}".`;
  } else {
    [ text, attachments ] = await getTrainingMessage(email, d4h);
  }

  await slack.post(body.channel_id, text, { attachments });
}