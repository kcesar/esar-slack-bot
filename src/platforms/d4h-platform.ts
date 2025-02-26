import Axios, { AxiosInstance } from "axios";
import { BasePlatform, PlatformCache } from "./base-platform";
import { Logger } from "winston";
import getLogger from "../lib/logging";

export const OPERATIONAL_STATUS_API_GROUP = { id: -1, title: 'OPERATIONAL', _virtual: true };

export interface v2Member {
  id: number;
  ref: string,
  name: string;
  email: string;
  position: string;
  urls: { image: string },
  status: { type: string, value: string },
  custom_fields: { label: string, value: string }[];
  group_ids: number[];
}

export interface v3Group {
  id: number;
  title: string;
}

export interface v3Qualification {
  id: number;
  cost: unknown | null;
  description: string;
  expiredCost: unknown | null;
  reminderDays: number;
  title: string;
  deprecatedBundle?: string;
  createdAt: string;
  updatedAt: string;
  expiresMonthsDefault: number;
}

export interface v3Award {
  id: number;
  startsAt: Date;
  endsAt: Date | null;
  qualification: {
    id: number;
    title: string;
  };
  member: {
    id: number;
  }
}


export interface D4HSecrets {
  v2Token: string;
  v3Token: string;
}

export interface D4HPlatformSettings {
  teamId: number;
  excludeGroups?: string;
}

export interface D4HCache extends PlatformCache {
  data: {
    groups: v3Group[];
    members: v2Member[];
    qualifications: v3Qualification[];
  }
}

export default class D4HPlatform extends BasePlatform<D4HCache> {
  private readonly settings: D4HPlatformSettings;
  private readonly web: AxiosInstance;
  private readonly web2: AxiosInstance;

  constructor(settings: D4HPlatformSettings, secrets: D4HSecrets, logger?: Logger) {
    super('D4H', { timestamp: 0, data: { members: [], groups: [], qualifications: [] } }, logger ?? getLogger('D4H'));
    this.web = Axios.create({
      baseURL: `https://api.team-manager.us.d4h.com/v3/team/${settings.teamId}/`,
      headers: {
        common: {
          Authorization: `Bearer ${secrets.v3Token}`
        }
      },
      //proxy: config.proxy || undefined,
    });
    this.web2 = Axios.create({
      baseURL: 'https://api.d4h.org/v2/',
      headers: {
        common: {
          Authorization: `Bearer ${secrets.v2Token}`
        }
      }
    });
  }

  getAllGroups() {
    return this.cache.data.groups;
  }

  getAllMembers() {
    return this.cache.data.members;
  }

  getAllQualifications() {
    return this.cache.data.qualifications;
  }

  async refreshCache(force?: boolean): Promise<void> {
    this.logger.info('refreshcache %s', this.cache);
    if (this.cache.timestamp === 0) {
      await this.loadSavedCache();
    }

    if (new Date().getTime() - this.cache.timestamp < 15 * 60 * 1000 && !force) {
      return;
    }

    this.logger.debug('getting data from D4H...');
    const [groups, members, qualifications ] = await Promise.all([
      (async () => {
        return [
          ...await this.getChunkedList<v3Group>('member-groups'),
          JSON.parse(JSON.stringify(OPERATIONAL_STATUS_API_GROUP)),
        ];
      })(),
      this.getChunkedList2<v2Member>(`team/members?include_details=true&include_custom_fields=true`),
      this.getChunkedList<v3Qualification>('member-qualifications'),
    ]);
    Object.assign(this.cache, {
      timestamp: new Date().getTime(),
      data: {
        members,
        groups,
        qualifications
      }
    });
    await this.saveCache();
  }

  async getChunkedList<T>(url: string): Promise<T[]> {
    let list: T[] = [];
    let chunk: T[] = [];
    do {
      chunk = (await this.web.get(`${url}${url.includes('?') ? '&' : '?'}size=250&page=${Math.floor(list.length / 250)}`)).data.results as T[];
      list = [...list, ...chunk];
    } while (chunk.length >= 250);

    return list;
  }

  async getChunkedList2<T>(url: string): Promise<T[]> {
    let list: T[] = [];
    let chunk: T[] = [];
    do {
      chunk = (await this.web2.get(`${url}${url.includes('?') ? '&' : '?'}limit=250&offset=${list.length}`)).data.data as T[];
      list = [...list, ...chunk];
    } while (chunk.length >= 250);

    return list;
  }
}