import { Logger } from "winston";
import getLogger, { LogFactory } from "../../lib/logging";
import { ModelAgent, TEMPLATE_MEMBER } from "../team-model";
import { GroupExpectation, TeamGroup, TeamMember, TeamStatus } from "../types";
import D4HPlatform, { D4HPlatformSettings, OPERATIONAL_STATUS_API_GROUP, v2Member, v3Group, v3Qualification } from "../../platforms/d4h-platform";
import { asLookup, split } from "../../lib/util";

function cleanEmail(email: string | null | undefined) {
  if (email == null) return undefined;
  return email.trim();
}

interface D4HModelSettings extends D4HPlatformSettings {
  teamGroupId: number;
  teamEmailDomain: string;
  statusGroups: TeamStatus[];
  expectations: Record<string, { course: string, type: 'simple' }[]>;
}

export default class D4HAgent implements ModelAgent {
  readonly name = 'D4H';
  private readonly d4h: D4HPlatform;
  private readonly settings: D4HModelSettings;
  private readonly logger: Logger;

  constructor(settings: D4HModelSettings, d4h: D4HPlatform, logFactory: LogFactory = getLogger) {
    this.d4h = d4h;
    this.settings = settings;
    this.logger = logFactory('d4h-agent');
  }

  initializeDirectory(): [TeamGroup[], TeamMember[]] {
    const groups: TeamGroup[] = [];
    const members: TeamMember[] = [];

    this.populateGroups(groups);
    this.populateMembers(members, asLookup(groups, g => g.platforms['D4H'].id as number));

    return [groups, members];
  }

  private populateGroups(groups: TeamGroup[]): void {
    let apiGroups = this.d4h.getAllGroups();
    if (this.settings.excludeGroups) {
      const regex = new RegExp(this.settings.excludeGroups);
      apiGroups = apiGroups.filter(g => !regex.exec(g.title));
    }

    const qualifications = this.d4h.getAllQualifications();

    for (const apiGroup of apiGroups) {
      const group: TeamGroup = {
        title: apiGroup.title,
        platforms: { 'D4H': apiGroup },
        expectations: this.buildGroupExpectations(apiGroup, qualifications),
        expectationsLoaded: true,
      }
      groups.push(group);
    }
  }

  populateMembers(members: TeamMember[], groups?: Record<number, TeamGroup>): void {
    const d4hMembers = this.d4h.getAllMembers();
    for (const d4hMember of d4hMembers) {
      // assumes this is the first/primary agent, and doesn't need to look for existing member in members
      const member = this.memberFromD4HMember(d4hMember, groups ?? {});
      member.platforms[this.name] = d4hMember;
      members.push(member);
    }
  }

  // setupMemberships(members: TeamMember[], groups: TeamGroup[]) {
  //   const gLookup = asLookup(groups, g => g.platforms['D4H'].id as number);
  //   for (const member of members) {
  //     const apiMember = member.platforms['D4H'] as v2Member;
  //     member.groups.push(...apiMember.group_ids.map(g => gLookup[g]).filter(g => !!g));
  //   }
  // }

  private memberFromD4HMember(apiMember: v2Member, apiGroups: Record<number, TeamGroup>) {
    const lastFirst = apiMember.name;
    const [last, first] = split(lastFirst, /,/g, 2).map(f => f.trim());
    const preferred = first ? first : last;
    const preferredFull = first ? `${first} ${last}` : last;
    //const email = apiMember.email == null ? '' : apiMember.email.trim();

    if (apiMember.status.value === 'Operational') {
      apiMember.group_ids.push(OPERATIONAL_STATUS_API_GROUP.id);
    }

    const groups = apiMember.group_ids
      .map(gid => apiGroups[gid])
      .filter(group => !!group);

    let teamStatus = { title: '', current: false, mission: false, field: false };
    for (const status of this.settings.statusGroups.filter(setting => groups.some(g => g.title === setting.title))) {
      teamStatus = { ...teamStatus, ...status };
    }
    const member: TeamMember = {
      ...TEMPLATE_MEMBER,
      name: { last, first, lastFirst, preferred, preferredFull },
      teamEmail: '',
      emails: [],
      teamStatus: teamStatus,
      platforms: {},
      groups,
    };
    member.emails = this.getD4HEmails(apiMember);
    member.teamEmail = member.emails.find(e => e.toLowerCase().endsWith(`@${this.settings.teamEmailDomain}`))?.toLowerCase() ?? '';
    return member;
  }

  private getD4HEmails(apiMember: v2Member) {
    const memberEmails = new Set<string>();
    if (cleanEmail(apiMember.email)) memberEmails.add(cleanEmail(apiMember.email)!);

    const secondaryEmailText = apiMember.custom_fields.filter(f => f.label === 'Secondary Email')[0].value;
    if (secondaryEmailText) {
      for (const second of secondaryEmailText?.split(';').map(e => e.trim()).filter(e => e) ?? []) {
        memberEmails.add(second);
      }
    }
    return [...memberEmails];
  }

  private buildGroupExpectations(apiGroup: v3Group, qualifications: v3Qualification[]): GroupExpectation[] {
    const groupSetting = this.settings.expectations[apiGroup.title] ?? [];
    return groupSetting
      .map(s => ({ ...s, q: qualifications.find(q => q.title === s.course) }))
      .filter(s => s.q)
      .map(s => ({ qualification: { title: s.q!.title }, type: s.type }));
  }
}