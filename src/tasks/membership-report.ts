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
  const platformPrefix = concern.platform ? `${concern.platform} ` : '';
  const emoji = concern.level === 'fix' ? ':exclamation: ' : '';
  return `- ${emoji}${platformPrefix}${concern.concern}`;
}

export async function membershipReportTask(modelBuilder: ModelBuilder) {
  const userParts = modelBuilder.getModelUserReport();
  const groupParts = modelBuilder.getModelGroupMembershipReport();

  let slack: { text: string, blocks: Block[] }|undefined = undefined;
  
  if (userParts.length || groupParts.length) {

    const userMarkdown = userParts.map(user => [
      `\n**${user.member.name.preferredFull}** ${emailToMarkdown(user.member.teamEmail) ?? 'N/A'}`,
      user.concerns.map(concernToMarkdown).join('\n')
      ].join('\n')
    ).join('\n');

    slack = {
      text: 'Membership report',
      blocks: [
        SlackPlatform.textToBlock('Took at look at different ESAR platforms. Found some things to check out:'),
        SlackPlatform.markdownToBlock(userMarkdown),
      ],
    };
  }

  return {
    slack
  };
}