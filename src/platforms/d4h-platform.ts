import Axios, { AxiosInstance } from "axios";
import { BasePlatform, PlatformCache } from "./base-platform";
import { Logger } from "winston";
import getLogger from "../lib/logging";
import { D4HPlatformSettings, D4HSecrets, v2Member, v3Award, v3Group, v3Member, v3Qualification } from "./d4h-types";
import { MemberTrainingAward, TeamMember } from "../model/types";

export const OPERATIONAL_STATUS_API_GROUP = { id: -1, title: 'OPERATIONAL', _virtual: true };


export interface D4HCache extends PlatformCache {
  data: {
    groups: v3Group[];
    members: v2Member[];
    qualifications: v3Qualification[];
  }
}

export default class D4HPlatform extends BasePlatform<D4HCache> {
  static readonly NAME = 'D4H';
  private readonly settings: D4HPlatformSettings;
  private readonly web: AxiosInstance;
  private readonly web2: AxiosInstance;

  constructor(settings: D4HPlatformSettings, secrets: D4HSecrets, logger?: Logger) {
    super(D4HPlatform.NAME, { timestamp: 0, data: { members: [], groups: [], qualifications: [] } }, logger ?? getLogger('D4H'));
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

  async updateMember(memberId: number, properties: Partial<v3Member>) {
    await this.web.patch(`members/${memberId}`, properties);
  }

  async addToGroup(memberId: number, groupId: number) {
    if (isNaN(memberId) || isNaN(groupId)) {
      throw new Error("ids must be integers");
    }
    let membershipId: string|undefined;
    try {
      const data = (await this.web.get(`member-group-memberships?member_id=${memberId}`)).data;
      membershipId = data.results.filter(g => g.group.id === groupId)?.[0].id;
    } catch (err) {
      // fall through to return false
    }

    if (!membershipId) {
      await this.web.post('member-group-memberships', {
        groupId,
        memberId,
      });
    }
  }

  async removeFromGroup(memberId: number, groupId: number) {
    if (isNaN(memberId) || isNaN(groupId)) {
      throw new Error("ids must be integers");
    }
    let membershipId: string|undefined;
    try {
      const data = (await this.web.get(`member-group-memberships?member_id=${memberId}`)).data;
      membershipId = data.results.filter(g => g.group.id === groupId)?.[0].id;
    } catch (err) {
      // fall through to return false
    }

    if (membershipId) {
      const result = await this.web.delete(`member-group-memberships/${membershipId}`);
      return true;
    }
    return false;
  }

  async addAwardForMember(member: TeamMember, awardTitle: string, completed: Date): Promise<void> {
    const apiMember = member.platforms[D4HPlatform.NAME] as v2Member;
    if (!apiMember) {
      return;
    }

    const qualificationId = this.getAllQualifications().find(f => f.title === awardTitle)?.id;
    if (!qualificationId) {
      throw new Error(`Can't find qualification with title "${awardTitle}"`);
    }

    await this.web.post(`member-qualification-awards`, {
      memberId: apiMember.id,
      qualificationId,
      startsAt: completed.toISOString(),
    });
  }

  async getAwardsForMember(member: TeamMember): Promise<MemberTrainingAward[]> {
    const apiMember = member.platforms[D4HPlatform.NAME] as v2Member;
    if (!apiMember) {
      return [];
    }
    
    const apiAwards = await this.getChunkedList<v3Award>(`member-qualification-awards?member_id=${apiMember.id}`);

    return apiAwards
      .map(v3 => [v3, this.getAllQualifications().find(q => q.id === v3.qualification.id)] as [v3Award, v3Qualification])
      .filter(f => f[1])
      .map(([v3, qual]) => ({
        qualification: { title: qual!.title },
        completed: new Date(v3.startsAt).getTime(),
        expires: v3.endsAt == null ? null : new Date(v3.endsAt).getTime(),
      }));
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