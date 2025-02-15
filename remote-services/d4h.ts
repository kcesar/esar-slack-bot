import axios, { Axios } from 'axios';

export interface D4HMember {
  id: number;
  ref: string;
  name: string;
  status: string;
  teamEmail?: string;
  emails: string[];
  photo?: string;
}

interface v3Member {
  id: number;
  email: { value: string, verified: boolean };
  name: string;
  ref: string;
  status: string;
}

interface D4HMembership {
  id: number;
  owner: { id: number };
  member: { id: number };
  group: { id: number };
  createdAt: string;
  updatedAt: string;
}

interface v2CustomField {
  title: string;
}

interface v2Member {
  id: number;
  ref: string,
  name: string;
  email: string;
  urls: { image: string },
  status: { type: string, value: string },
  custom_fields: any[];
  group_ids: number[];
}

export class D4HClient {
  private readonly web: Axios;
  private readonly web2: Axios;
  private cacheTime: number = 0;
  private membersCache: Record<string, D4HMember>;
  private readonly teamDomain: string;

  constructor(teamId: string, teamDomain: string, v3Token: string, v2Token: string) {
    this.teamDomain = teamDomain.toLowerCase();
    this.web = axios.create({
      baseURL: `https://api.team-manager.us.d4h.com/v3/team/${teamId}/`,
      headers: {
        common: {
          Authorization: `Bearer ${v3Token}`
        }
      },
      //proxy: config.proxy || undefined,
    });
    this.web2 = axios.create({
      baseURL: 'https://api.d4h.org/v2/',
      headers: {
        common: {
          Authorization: `Bearer ${v2Token}`
        }
      }
    });
  }

  async getGroupMembers(groupId: number, options?: { includeRetired?: boolean }) {
    await this.loadMembers();
    const membership = await this.getChunkedList<D4HMembership>(`member-group-memberships?group_id=${groupId}`);
    let members = membership.map(m => {
      const member = this.membersCache[m.member.id];
      // if (!member) { console.log(`D4H group ${groupId} has unknown member ${m.member.id}`); }
      return member;
    }).filter(f => f);
    if (options?.includeRetired ?? false == false) {
      members = members.filter(f => f.status !== 'RETIRED');
    }
    return members;
  }

  private async loadMembers() {
    const now = new Date().getTime();
    if (now - this.cacheTime < 5 * 60 * 1000) {
      return;
    }
    const secondaryEmailField = (await this.getChunkedList2<v2CustomField>('fields', `team/custom-fields`)).find(f => f.title === 'Secondary Email');
    if (!secondaryEmailField) {
      console.log('Can\'t find Secondary Email field');
      return;
    }

    const v2Members = (await this.getChunkedList2<v2Member>('members', `team/members?include_details=true&include_custom_fields=true`));
    const members: Record<string, D4HMember> = {};
    for (const member of v2Members) {
      members[member.id] = {
        id: member.id,
        ref: member.ref,
        name: member.name,
        emails: [],
        status: member.status.value.toUpperCase(),
      };

      if (member.email) {
        members[member.id].emails = [member.email];
      }

      const secondaryEmailText = member.custom_fields.filter(f => f.label === 'Secondary Email')[0].value;
      if (secondaryEmailText) {
        const memberEmails: Record<string, true> = { [member.email]: true };
        for (const second of secondaryEmailText?.split(';').map(e => e.trim()) ?? []) {
          memberEmails[second] = true;
        }
        members[member.id].emails = Object.keys(memberEmails);
      }
      members[member.id].teamEmail = members[member.id].emails.find(e => e.toLowerCase().endsWith(`@${this.teamDomain}`))?.toLowerCase();
    }
    this.membersCache = members;
  }

  private async getChunkedList<T>(url: string): Promise<T[]> {
    let list: T[] = [];
    let chunk: T[] = [];
    do {
      chunk = (await this.web.get(`${url}${url.includes('?') ? '&' : '?'}size=250&page=${Math.floor(list.length / 250)}`)).data.results as T[];
      list = [...list, ...chunk];
    } while (chunk.length >= 250);

    return list;
  }

  private async getChunkedList2<T>(name, url): Promise<T[]> {
    let list: T[] = [];
    let chunk: T[] = [];
    do {
      chunk = (await this.web2.get(`${url}${url.includes('?') ? '&' : '?'}limit=250&offset=${list.length}`)).data.data as T[];
      list = [...list, ...chunk];
    } while (chunk.length >= 250);

    return list;
  }
}