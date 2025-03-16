import { Logger } from "winston";
import { ModelAgent, TEMPLATE_MEMBER } from "../team-model";
import getLogger, { LogFactory } from "../../lib/logging";
import { TeamMember, CheckConcern, TeamGroup } from "../types";
import GooglePlatform, { GooglePlatformSettings, GoogleUser } from "../../platforms/google-platform";
import { getConcernList } from "./agent-utils";

interface GoogleModelSettings extends GooglePlatformSettings {
  ignoreUsers?: string[];
}

export default class GoogleAgent implements ModelAgent {
  readonly name = 'Google';
  private readonly google: GooglePlatform;
  private readonly settings:GoogleModelSettings;
  private readonly logger: Logger;

  constructor(settings: GoogleModelSettings, google: GooglePlatform, logFactory: LogFactory = getLogger) {
    this.google = google;
    this.settings = settings;
    this.logger = logFactory('google-agent');
  }

  populateMembers(members: TeamMember[]): void {
    const OUs = [ '/Members', '/Trainees' ];
    const users = this.google.getAllUsers()
                    .filter(f => OUs.includes(f.orgUnitPath) && !this.settings.ignoreUsers?.includes(f.primaryEmail));
    for (const user of users) {
      const userEmailsLowered = [user.primaryEmail.toLowerCase() ];
      const existing = members.filter(m => m.emails.some(me => userEmailsLowered.includes(me.toLowerCase())));
      if (existing.length == 1) {
        existing[0].platforms[this.name] = user;
      } else {
        const member: TeamMember = {
          ...JSON.parse(JSON.stringify(TEMPLATE_MEMBER))
        };
        member.platforms[this.name] = user;
        members.push(member);
      }
    }
  }

  getMemberConcerns(member: TeamMember): CheckConcern[] {
    const [ concerns, add ] = getConcernList(this.name);
    const gUser = member.platforms[this.name] as GoogleUser|undefined;
    if (member.teamStatus.current) {
      if (!gUser) {
        add(`Does not have a Google account`);
      } else {
        if (gUser.suspended) {
          add(`Has a suspended account`);
        }
        
        if (gUser.primaryEmail !== member.teamEmail) {
          add(`Primary email ${gUser.primaryEmail} does not match primary team email ${member.teamEmail}`);
        }
      }
    } else if (member.teamStatus.trainee) {

    } else {
      if (gUser && !gUser.suspended) {
        add(`Has an active Google account "${gUser.name.fullName}" (${gUser.primaryEmail})`);
      }
    }
    return concerns;
  }

  getMembershipConcerns(member: TeamMember, groups: TeamGroup[]): CheckConcern[] {
    return [];
  }
}