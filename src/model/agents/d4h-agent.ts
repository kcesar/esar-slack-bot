import { Logger } from "winston";
import getLogger, { LogFactory } from "../../lib/logging";
import { ModelAgent, TEMPLATE_MEMBER } from "../team-model";
import { CheckConcern, GroupExpectation, TeamGroup, TeamMember, TeamStatus } from "../types";
import D4HPlatform, { OPERATIONAL_STATUS_API_GROUP } from "../../platforms/d4h-platform";
import { asLookup, equalsInsensitive, split } from "../../lib/util";
import { D4HPlatformSettings, v2Member, v3Group, v3Qualification } from "../../platforms/d4h-types";
import { getConcernList } from "./agent-utils";

function cleanEmail(email: string | null | undefined) {
  if (email == null) return undefined;
  return email.trim();
}

const TEAM_JOIN_REGEX = /^((?<unit>[A-Za-z0-9]+) +)?(?<date>[\d/-]+)$/;
const JOIN_DATE_REGEX = /^\d\d\d\d[/-]\d\d[/-]\d\d$/;

interface D4HModelSettings extends D4HPlatformSettings {
  teamGroupId: number;
  teamEmailDomain: string;
  teamName: string;
  statusGroups: TeamStatus[];
  expectations: Record<string, { course: string, type: 'simple' }[]>;
  addGroupMembers: Record<string, string[]>;
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

  getMemberConcerns(member: TeamMember): CheckConcern[] {
    return (member.teamStatus.current ? this.checkActiveMember(member) : this.checkNonMember(member)) ?? [];
  }

  private checkActiveMember(member: TeamMember) {
    const [concerns, add] = getConcernList(this.name);
    const d4hMember = member.platforms[this.name] as v2Member;
    if (d4hMember.status.value !== 'Operational') {
      add(`Has unexpected status: ${d4hMember.status.value}`);
    }
    const platformEmail = this.getD4HEmails(d4hMember).find(f => equalsInsensitive(member.teamEmail, f));
    if (member.teamEmail && platformEmail !== member.teamEmail) {
      add(`${platformEmail} is not lowercase`, 'warn');
    }
    this.checkMemberJoinDate(d4hMember, add);
    const unitStatus = d4hMember.custom_fields.find(f => f.label === 'Unit Status')?.value;
    if (member.teamStatus.field && !unitStatus?.includes(this.settings.teamName)) {
      add(`Unit status does not include "${this.settings.teamName}" in unit status: "${unitStatus ?? ''}"`);
    }
    return concerns;
  }

  private checkMemberJoinDate(d4hMember: v2Member, add: (text: string, level?: "warn" | "fix" | "error") => void) {
    const unitJoinDateField = d4hMember.custom_fields.find(f => f.label === 'Joined Unit Date')?.value;
    const unitJoinDate = unitJoinDateField?.split(/[;\,]/g).map(f => f.trim()).filter(f => f) ?? [];
    if (unitJoinDate.length == 0) {
      add(`Has no "Unit Join Date"`);
    } else {
      const matches = unitJoinDate.map(f => TEAM_JOIN_REGEX.exec(f));
      if (matches.some(f => f?.groups == null)) {
        add(`Can't parse Unit Join Date of "${unitJoinDateField}"`);
      } else {
        const thisTeamJoins = matches.filter(f => f && (f.groups?.unit === this.settings.teamName || !f.groups?.unit));
        if (thisTeamJoins.length == 0) {
          add(`Can't find Unit Join Date for ${this.settings.teamName}`);
        } else if (thisTeamJoins.length > 1) {
          add(`Multiple Unit Join Dates. Can't identify only one as applicable to ${this.settings.teamName}: "${unitJoinDateField}"`);
        } else if (!JOIN_DATE_REGEX.test(thisTeamJoins[0]!.groups!.date)) {
          //add(`Unit Join Date is in wrong format: ${thisTeamJoins[0]![0]}`, 'warn');
        }
      }
    }
  }

  private checkNonMember(member: TeamMember) {
    const [concerns, add] = getConcernList(this.name);
    const d4hMember = member.platforms[this.name] as v2Member;
    if (d4hMember.position.includes(this.settings.teamName)) {
      add(`Non-member has "${this.settings.teamName}" in position text: ${d4hMember.position}`);
    }
    const unitStatus = d4hMember.custom_fields.find(f => f.label === 'Unit Status')?.value;
    if (unitStatus?.includes(this.settings.teamName)) {
      add(`Non-member has "${this.settings.teamName}" in unit status: ${unitStatus ?? ''}`);
    }
    return concerns;
  }

  getMembershipConcerns(member: TeamMember, groups: TeamGroup[]): CheckConcern[] {
    const [ concerns, add ] = getConcernList(this.name);
    
    if (member.teamStatus.current) {
      const statusGroups = this.settings.statusGroups.filter(sg => sg.title !== this.settings.teamName && member.groups.some(mg => mg.title === sg.title));
      if (statusGroups.length > 1) {
        add(`Member belongs to multiple status groups: ${statusGroups.map(g => g.title)}`);
      }
    } else if (member.teamStatus.trainee) {

    } else {
      const teamGroups = member.groups
        .map(g => ({ ...g, settingsAllow: this.settings.addGroupMembers[g.title]?.some(email => member.emails.includes(email))}))
        .filter(g => !g.settingsAllow && g.title.startsWith(`${this.settings.teamName} `));
      if (teamGroups.length > 0) {
        add(`Non-Member belongs to group(s) ${teamGroups.map(g => g.title)}`);
      }
    }

    return concerns;
  }


  private memberFromD4HMember(apiMember: v2Member, apiGroups: Record<number, TeamGroup>) {
    const lastFirst = apiMember.name;
    const [last, first] = split(lastFirst, /,/g, 2).map(f => f.trim());
    const preferred = first ? first : last;
    const preferredFull = first ? `${first} ${last}` : last;

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