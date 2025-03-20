import { Block } from "@slack/web-api";
import ModelBuilder from "../model/model-builder";
import { CheckConcern } from "../model/types";
import SlackPlatform from "../platforms/slack-platform";

function emailToMarkdown(email?: string) {
  if (!email) return email;
  // Was trying to format as a link, but was getting pretty verbose results.
  return `${email}`;
}

function concernToMarkdown(concern: CheckConcern) {
  const platformPrefix = concern.platform ? `[${concern.platform}] ` : '';
  const emoji = concern.level === 'fix' ? ':exclamation: ' : '';
  return ` ${emoji}${platformPrefix}${concern.concern}`;
}

export async function membershipReportTask(modelBuilder: ModelBuilder) {
  const userParts = modelBuilder.getModelUserReport();
  const groupParts = modelBuilder.getModelGroupMembershipReport();

  let slack: { text: string, attachments: { text: string }[] }|undefined = undefined;
  let body: string|null = null;

  if (userParts.length || groupParts.length) {
    body = [...userParts, ...groupParts].map(user => [
      `\n${user.member.name.preferredFull} ${emailToMarkdown(user.member.teamEmail ?? user.member.emails[0]) ?? 'N/A'}`,
      user.concerns.map(concernToMarkdown).join('\n')
      ].join('\n')
    ).join('\n');
  }

  return {
    body
  };
}