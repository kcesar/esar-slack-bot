import Axios, { AxiosInstance } from "axios";
import { BasePlatform, PlatformCache } from "./base-platform";
import { Logger } from "winston";
import getLogger from "../lib/logging";
import { D4HPlatformSettings, D4HSecrets, v3Award, v3CustomField, v3Group, v3GroupMembership, v3Member, v3Qualification } from "./d4h-types";
import { MemberTrainingAward, TeamMember } from "../model/types";

export const OPERATIONAL_STATUS_API_GROUP = { id: -1, title: 'OPERATIONAL', _virtual: true };

function toStr(n: number | undefined): string|undefined {
  return n == null ? n : n + '';
}

interface ApiList<T> {
  results: T[];
}

export interface D4HCache extends PlatformCache {
  data: {
    fields: v3CustomField[];
    groups: v3Group[];
    members: v3Member[];
    memberships: v3GroupMembership[];
    qualifications: v3Qualification[];
  }
}

export default class D4HPlatform extends BasePlatform<D4HCache> {
  static readonly NAME = 'D4H';
  private readonly web: AxiosInstance;

  constructor(settings: D4HPlatformSettings, secrets: D4HSecrets, logger?: Logger) {
    super(D4HPlatform.NAME, { timestamp: 0, data: { fields: [], members: [], groups: [], memberships: [], qualifications: [] } }, logger ?? getLogger('D4H'));
    this.web = Axios.create({
      baseURL: `https://api.team-manager.us.d4h.com/v3/team/${settings.teamId}/`,
      headers: {
        common: {
          Authorization: `Bearer ${secrets.v3Token}`
        }
      },
      //proxy: config.proxy || undefined,
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

  getMemberCustomField(member: v3Member|undefined, fieldTitle: string) {
    const fieldId = this.cache.data.fields.find(f => f.title === fieldTitle)?.id;
    if (fieldId == null) return undefined;
    return member?.customFieldValues.find(f => f.customField.id === fieldId)?.value;
  }

  getMemberGroups(member: v3Member): Array<v3Group> {
    const memberships = this.cache.data.memberships.filter(f => f.member.id === member.id).map(f => f.group.id);
    const groups = this.cache.data.groups.filter(f => memberships.includes(f.id));
    return groups;
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
      const data = (await this.web.get<ApiList<v3GroupMembership>>(`member-group-memberships?member_id=${memberId}`)).data;
      membershipId = toStr(data.results.filter(g => g.group.id === groupId)?.[0].id);
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
      const data = (await this.web.get<ApiList<v3GroupMembership>>(`member-group-memberships?member_id=${memberId}`)).data;
      membershipId = toStr(data.results.filter(g => g.group.id === groupId)?.[0].id);
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
    const apiMember = member.platforms[D4HPlatform.NAME] as v3Member;
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
    const apiMember = member.platforms[D4HPlatform.NAME] as v3Member;
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
    const [fields, groups, members, memberships, qualifications ] = await Promise.all([
      this.getChunkedList<v3CustomField>('custom-fields'),
      (async () => {
        return [
          ...await this.getChunkedList<v3Group>('member-groups'),
          JSON.parse(JSON.stringify(OPERATIONAL_STATUS_API_GROUP)),
        ];
      })(),
      this.getChunkedList<v3Member>(`members?status=OPERATIONAL`),
      this.getChunkedList<v3GroupMembership>(`member-group-memberships`),
      this.getChunkedList<v3Qualification>('member-qualifications'),
    ]);
    this.logger.debug('finished getting D4H data');
    Object.assign(this.cache, {
      timestamp: new Date().getTime(),
      data: {
        fields,
        members,
        groups,
        memberships,
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
}