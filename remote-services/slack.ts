import * as fs from 'fs/promises';
import * as path from 'path';
import { Block, MessageAttachment, RichTextBlock, SectionBlock, WebClient, type Channel, type Member } from '@slack/web-api';

export interface SlashCommandLite {
  command: string;
  text: string;
  channel_id: string;
  user_id: string;
}

export interface SlashCommand extends SlashCommandLite {
  token: string;
  team_id: string;
  team_domain: string;
  channel_name: string;
  user_name: string;
  api_app_id: string;
  is_enterprise_install: string;
  response_url: string;
  trigger_id: string;
}

interface SlackCache {
  timestamp: number,
  members: Member[],
  channels: Channel[],
}

export default class SlackClient {
  private readonly web: WebClient;
  private initted = false;

  private memberCache: Member[] = [];
  private readonly memberLookup: Record<string, Member> = {};
  private readonly channelLookup: Record<string, Channel> = {};

  constructor(botToken: string) {
    this.web = new WebClient(botToken);
  }

  async getRegularMembers(): Promise<Member[]> {
    await this.init();
    return this.memberCache.filter(m => !m.is_deleted && !m.is_bot && m.id !== 'USLACKBOT');
  }

  async getMemberById(id: string) {
    await this.init();
    return this.memberLookup[id];
  }

  async getMemberByEmail(email: string) {
    await this.init();
    return this.memberCache.find(f => email.localeCompare(f.profile.email, undefined, { sensitivity: 'accent' }) === 0)
  }

  async getChannel(channel: string) {
    await this.init();
    return channel.startsWith('#')
      ? Object.values(this.channelLookup).find(c => c.name === channel.substring(1))
      : channel.startsWith('@')
      ? this.memberCache.find(m => m.real_name.localeCompare(channel.substring(1), undefined, { sensitivity: 'accent' }) === 0)?.id
      : this.channelLookup[channel];
  }

  async send(rcpt: string, message: string|Block[]) {
    const rcptId = await this.getChannel(rcpt);
    const channel = (await this.web.conversations.open(rcpt.startsWith('@') ? { users: rcptId } : { channel: rcptId })).channel?.id;
    if (channel) {
      await this.web.chat.postMessage(typeof message === 'string' ? {channel, text: message } : { channel, blocks: message });
    }
  }

  post(channel: string, text: string, extra?: { blocks?: Block[], attachments?: MessageAttachment[] }) {
    return this.web.chat.postMessage({ channel, text, blocks: extra?.blocks, attachments: extra?.attachments });
  }

  async inviteToChannel(channel: string, userIds: string[]) {
    await this.init();
    if (channel.startsWith('#')) {
      channel = Object.values(this.channelLookup).find(c => c.name === channel.substring(1))?.id;
    }
    await this.web.conversations.invite({
      channel,
      users: userIds.join()
    });
  }

  async getChannelMembers(channel: string) {
    await this.init();
    if (channel.startsWith('#')) {
      channel = Object.values(this.channelLookup).find(c => c.name === channel.substring(1))?.id;
    }
    return ((await this.web.conversations.members({ channel })).members ?? []).map(id => this.memberLookup[id] ?? id);
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

  private async init() {
    if (this.initted) {
      return;
    }

    const cacheFile = path.join(__dirname, '../data/slack-cache.json');
    let cache: SlackCache | undefined;
    try {
      const cacheJson = await fs.readFile(cacheFile, 'utf-8');
      cache = JSON.parse(cacheJson);
    }
    catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    if (new Date().getTime() - (cache?.timestamp ?? 0) > 60 * 60 * 3600) {
      cache = await this.refreshCache();
      await fs.writeFile(cacheFile, JSON.stringify(cache, null, 2));
    }

    this.memberCache = cache!.members;
    this.memberCache.sort((a, b) => (a.profile.last_name ?? '').localeCompare(b.profile.last_name) || (a.profile.first_name ?? '').localeCompare(b.profile.first_name));
    for (const m of this.memberCache) {
      this.memberLookup[m.id] = m;
    }
    for (const c of cache!.channels) {
      this.channelLookup[c.id] = c;
    }
    this.initted = true;
  }

  private async refreshCache() {
    console.log('Refreshing Slack cache...');
    const cache = {
      timestamp: 0,
      members: (await this.web.users.list({})).members ?? [],
      channels: (await this.web.conversations.list({ types: 'private_channel,public_channel' })).channels ?? [],
    }
    cache.timestamp = new Date().getTime();
    return cache;
  }

}