import { Block, ConversationsOpenArguments, MessageAttachment, RichTextBlock, SectionBlock, WebClient } from '@slack/web-api';
import { type Channel } from '@slack/web-api/dist/types/response/ConversationsListResponse';
import { type Member } from '@slack/web-api/dist/types/response/UsersListResponse';
import { Logger } from 'winston';
import { BasePlatform, PlatformCache } from "./base-platform"
import getLogger from '../lib/logging';
import { asLookup } from '../lib/util';

export type SlackUser = Member;
export interface UserAndChannels extends SlackUser {
  channels: string[],
}

export interface SlackMembership {
  channelId: string;
  userId: string;
}

export interface SlackCache extends PlatformCache {
  data: {
    users: SlackUser[],
    channels: Channel[],
    memberships: SlackMembership[],
  }
}

export interface SlackChannelSetting {
  slack: string;
  groups: string[];
  sync: boolean;
}

export interface SlackSettings {
  channels: SlackChannelSetting[],
}

export interface SlackSecrets {
  botToken: string;
}

export interface SlashCommandLite {
  command: string;
  text: string;
  channel_id: string;
  user_id: string;
}

export default class SlackPlatform extends BasePlatform<SlackCache> {
  static name = 'Slack';

  private readonly settings: SlackSettings;
  private readonly web: WebClient;

  constructor(settings: SlackSettings, secrets: SlackSecrets, logger?: Logger) {
    super(SlackPlatform.name, { timestamp: 0, data: { users: [], channels: [], memberships: [] } }, logger ?? getLogger('Slack'));
    this.settings = settings;
    this.web = new WebClient(secrets.botToken);
  }

  async post(channel: string, text: string, extra?: { blocks?: Block[], attachments?: MessageAttachment[], replaceTs?: string }) {
    if (extra?.replaceTs) {
      this.web.chat.delete({ channel, ts: extra.replaceTs });
    }
    return await this.web.chat.postMessage({ channel, text, blocks: extra?.blocks, attachments: extra?.attachments });
  }

  async send(rcpt: string, message: string|{ text: string, blocks?: Block[], attachments?: {text: string }[]  }) {
    const rcptId = await this.findChannel(rcpt);
    if (rcptId) {
      const args: ConversationsOpenArguments = rcpt.startsWith('@') ? { users: rcptId } : { channel: rcptId };
      const channel = (await this.web.conversations.open(args)).channel?.id;
      if (channel) {
        await this.web.chat.postMessage(typeof message === 'string' ? {channel, text: message } : { channel, ...message });
      }
    }
  }

  async refreshCache(force?: boolean): Promise<void> {
    this.logger.info('refreshcache %s', this.cache);
    if (this.cache.timestamp === 0) {
      await this.loadSavedCache();
    }

    if (new Date().getTime() - this.cache.timestamp < 15 * 60 * 1000 && !force) {
      return;
    }

    this.logger.debug('getting data from Slack...');

    const [users, channels] = await Promise.all([
      this.web.users.list({}).then(r => r.members ?? []),
      this.web.conversations.list({ types: 'private_channel,public_channel' }).then(r => r.channels ?? []),
    ]);

    Object.assign(this.cache, {
      timestamp: new Date().getTime(),
      data: {
        users,
        channels,
        memberships: await this.loadMemberships(channels)
      },
    });
    await this.saveCache();
  }

  private async loadMemberships(channels: Channel[]) {
    const lookup = asLookup(channels, c => c.name_normalized ?? c.name ?? 'no-name');
    return Promise.all(
      this.settings.channels
        .map(name => lookup[name.slack]?.id)
        .filter(id => id)
        .map(id => this.web.conversations.members({ channel: id! }).then(r => ({ id, userIds: r.members ?? [] })))
    ).then(usersByChannel => usersByChannel.flatMap(channelAndUsers => channelAndUsers.userIds.map(userId => ({ channelId: channelAndUsers.id, userId }))))
  }

  getAllChannels() {
    return this.cache.data.channels;
  }

  getAllUsers() {
    return this.cache.data.users;
  }

  getUsersAndChannels(): UserAndChannels[] {
    return this.cache.data.users.map(u => ({
      ...u,
      channels: this.cache.data.memberships.filter(m => m.userId === u.id).map(m => m.channelId)
    }))
  }

  getChannelByName(name: string) {
    return this.cache.data.channels.find(f => f.name_normalized === name);
  }

  getChannel(id: string) {
    return this.cache.data.channels.find(f => f.id === id);
  }

  findChannel(key: string) {
    return key.startsWith('#')
    ? this.cache.data.channels.find(c => c.name === key.substring(1))?.id
    : key.startsWith('@')
    ? this.cache.data.users.find(m => m.real_name?.localeCompare(key.substring(1), undefined, { sensitivity: 'accent' }) === 0)?.id
    : key;
  }

  static markdownToBlock(markdown: string): Block {
    return {
      "type": "markdown",
      "text": markdown,
    } as Block;
  }

  static listToListBlock(list: string[]): RichTextBlock {
    return {
      type: "rich_text",
      elements: [{
        type: "rich_text_list",
        style: "bullet",
        indent: 0,
        elements: list.map(l => ({
          type: "rich_text_section",
          elements: [
            {
              type: "text",
              text: l
            }
          ]
        }))
      }]
    };
  }

  static textToBlock(text: string): SectionBlock {
    return {
      type: "section",
      text: {
        type: "plain_text",
        text,
        emoji: true
      }
    }
  }
}