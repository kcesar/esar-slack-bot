import { readFile } from 'fs/promises';
import { join as pathJoin } from 'path';
import axios, { Axios } from 'axios';
import { equalsInsensitive } from '../lib/util';

export const OPERATIONAL_STATUS_GROUP_ID = -1;

interface ExpectationSetting {
  course: string;
  type: 'simple';
}

export interface D4HSettings {
  expectations: Record<string, ExpectationSetting[]>;
}

export interface D4HMember {
  id: number;
  ref: string;
  name: string;
  status: string;
  teamEmail?: string;
  emails: string[];
  photo?: string;
  groups: D4HGroup[];
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

interface D4HQualification {
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

interface D4HAward {
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

export interface D4HExpectation {
  qualification: { id: number, title: string };
  type: 'simple';
}

interface D4HGroup {
  id: number;
  title: string;
  expectations: D4HExpectation[];
}

export class D4HClient {
  private readonly web: Axios;
  private readonly web2: Axios;
  private settings: D4HSettings = {} as D4HSettings;

  private cacheTime: number = 0;
  private membersCache: Record<number, D4HMember>;
  private qualificationsCache: Record<number, D4HQualification>;
  private groupsCache: Record<number, D4HGroup>;
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
    await this.reload();
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

  async getMemberByEmail(email: string) {
    await this.reload();
    return Object.values(this.membersCache).find(f => f.emails.includes(email));
  }

  async getMemberQualifications(memberId: number) {
    const list: D4HAward[] = [];

    for (const award of await this.getChunkedList<D4HAward>(`member-qualification-awards?member_id=${memberId}`)) {
      if (!award.qualification) {
        console.log('no qualification', award);
        continue;
      }
      const qual = this.qualificationsCache[award.qualification.id];
      list.push({ qualification: qual, startsAt: award.startsAt, endsAt: award.endsAt } as any);
    }
    return list;
  }

  async reload() {
    const now = new Date().getTime();
    if (now - this.cacheTime < 5 * 60 * 1000) {
      return;
    }

    this.settings = JSON.parse(await readFile(pathJoin(__dirname, '../data/d4h-config.json'), 'utf-8'));


    this.qualificationsCache = {};
    const qualList: D4HQualification[] = [];
    for (const qual of await this.getChunkedList<D4HQualification>('member-qualifications')) {
      this.qualificationsCache[qual.id] = qual;
      qualList.push(qual);
    }

    this.groupsCache = {};
    const groupsList = [
      ...await this.getChunkedList<{ id: number, title: string }>('member-groups'),
      { id: OPERATIONAL_STATUS_GROUP_ID, title: "OPERATIONAL" },
    ];

    for (const group of groupsList) {
      this.groupsCache[group.id] = {
        ...group,
        expectations: this.settings.expectations[group.title]
          ?.map(e => ({ ...e, q: qualList.find(f => equalsInsensitive(f.title, e.course)) }))
          .filter(e => {
            if (!e.q) console.log(`Cant find qualification matching ${e.course}`);
            return !!e.q;
          })
          .map(({ q, ...e }) => ({ ...e, qualification: { id: q!.id, title: q!.title } }))
          ?? []
      };
    }

    // =========== MEMBERS
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
        groups: (member.group_ids ?? []).map(groupId => this.groupsCache[groupId]).filter(g => !!g)
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

  async getGroups(): Promise<Record<number, D4HGroup>> {
    await this.reload();
    return this.groupsCache;
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