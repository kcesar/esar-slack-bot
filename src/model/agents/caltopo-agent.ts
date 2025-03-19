import { Logger } from "winston";
import { ModelAgent, TEMPLATE_MEMBER } from "../team-model";
import { TeamMember, CheckConcern, TeamGroup } from "../types";
import getLogger, { LogFactory } from "../../lib/logging";
import { getConcernList } from "./agent-utils";
import CalTopoPlatform, { CalTopoUser, CalTopoSettings } from "../../platforms/caltopo-platform";

export default class CalTopoAgent implements ModelAgent {
  readonly name = 'CalTopo';
  private readonly caltopo: CalTopoPlatform;
  private readonly settings: CalTopoSettings;
  private readonly logger: Logger;

  constructor(settings:CalTopoSettings, caltopo: CalTopoPlatform, logFactory: LogFactory = getLogger) {
    this.settings = settings;
    this.caltopo = caltopo;
    this.logger = logFactory('caltopo-agent');
  }

  populateMembers(members: TeamMember[]): void {
    const users = this.caltopo.getAllUsers();
    const membersByEmail: Record<string, TeamMember[]> = {};
    const membersByName: Record<string, TeamMember[]> = {};
    for (const member of members) {
      const lowerName = member.name.preferredFull?.toLowerCase() ?? 'Unknown';
      membersByName[lowerName] = [ ...membersByName[lowerName] ?? [], member ];
      for (const email of member.emails) {
        const lowerEmail = email.toLowerCase();
        membersByEmail[lowerEmail] = [ ...membersByEmail[lowerEmail] ?? [], member ];
      }
    }

    for (const user of users) {
      const aliasedEmail = (this.settings.aliasEmails ?? {})[user.email] ?? user.email?.toLowerCase() ?? '';
      let existing = membersByEmail[aliasedEmail] ?? [];
      if (!existing.length) {
        existing = membersByName[user.fullName?.toLowerCase() ?? ''] ?? [];
      }

      if (existing.length == 1) {
        existing[0].platforms[this.name] = user;
      } else {
        const template = JSON.parse(JSON.stringify(TEMPLATE_MEMBER));
        const member: TeamMember = {
          ...template,
          name: { ...template.name, preferredFull: user.fullName },
          emails: [ user.email ],
        };
        member.platforms[this.name] = user;
        members.push(member);
      }
    }
  }

  getMemberConcerns(member: TeamMember): CheckConcern[] {
    const [ concerns, add ] = getConcernList(this.name);

    return concerns;
  }

  getMembershipConcerns(member: TeamMember, groups: TeamGroup[]): CheckConcern[] {
    const [ concerns, add ] = getConcernList(this.name);

    const memberGroups = new Set(member.groups.map(f => f.title));

    const caltopoUser = member.platforms[this.name] as CalTopoUser|undefined;
    const memberEmail = member.teamEmail ?? member.emails[0] ?? caltopoUser?.email ?? 'N/A';

    for (const team of this.settings.teams) {
      let shouldBeInTeam = team.expectGroups?.some(settingGroupTitle => memberGroups.has(settingGroupTitle));
      shouldBeInTeam ||= this.settings.extraMembers?.includes(memberEmail);

      const canBeInGroup = shouldBeInTeam || team.allowExternal || (member.teamStatus.current && team.allowMembers);
      
      if (shouldBeInTeam) {
        const permission = caltopoUser?.groups[team.id];
        if (!permission) {
          add(`Should be in CalTopo team "${team.name}"`);
        } else if ((permission ?? 10) < (team.minPermission ?? 10)) {
          add(`Permission ${team.minPermission ?? 10} is lower than required (${team.minPermission ?? 10})`);
        }
      } else if (caltopoUser?.groups[team.id] && !canBeInGroup) {
        add(`Should not be in CalTopo team "${team.name}"`);
      }
    }

    return concerns;
  }
}
  