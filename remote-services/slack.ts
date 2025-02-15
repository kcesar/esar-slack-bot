import * as fs from 'fs/promises';
import * as path from 'path';
import { WebClient, type Channel, type Member } from '@slack/web-api';

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

  async getRegularMembers() {
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
      : this.channelLookup[channel];
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