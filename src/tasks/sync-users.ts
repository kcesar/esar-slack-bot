import { loadSyncSettings } from "../lib/sync";
import CalTopoClient, { CaltopoMembership } from "../lib/remote-services/caltopo";
import { D4HClient, D4HMember } from "../lib/remote-services/d4h";
import WorkspaceClient, { GoogleUser } from "../lib/remote-services/googleWorkspace";
import SlackClient from "../lib/remote-services/slack";
import { type Member as SlackMember } from '@slack/web-api';

interface SARMember {
  emails: string[];
  name: { fullName: string },
}

export class SyncUsersTask {
  private readonly d4h: D4HClient;
  private readonly google: WorkspaceClient;
  private readonly caltopo: CalTopoClient;
  private readonly slack: SlackClient;

  constructor(d4h: D4HClient, google: WorkspaceClient, slack: SlackClient, caltopo: CalTopoClient) {
    this.d4h = d4h;
    this.google = google;
    this.slack = slack;
    this.caltopo = caltopo;
  }

  async run(): Promise<{ problems: string[] }> {
    const settings = await loadSyncSettings();
    const unitMembers = (await this.d4h.getGroupMembers(settings.users.d4h.membersGroup));

    const caltopoUsers = await this.caltopo.getTeamMembers(settings.users.caltopo.teamId);
    const caltopoLookup: Record<string, CaltopoMembership> = {};
    for (const cUser of caltopoUsers) {
      caltopoLookup[cUser.id] = cUser;
    }

    const googleMembers: Record<string, GoogleUser> = {};
    for (const gUser of await this.google.getUsers()) {
      googleMembers[gUser.primaryEmail.toLowerCase()] = gUser;
    }

    const slackUsers: Record<string, SlackMember> = {};
    for (const sUser of await this.slack.getRegularMembers()) {
      slackUsers[sUser.profile.email.toLowerCase()] = sUser;
    }

    const duplicates: Record<string, true> = {};
    const problems: string[] = [];
    for (const d4hMember of unitMembers) {
      if (!d4hMember.teamEmail) {
        problems.push(`D4H user ${d4hMember.id} "${d4hMember.name}" does not have a unit email {${d4hMember.emails}}.`);
        continue;
      }

      const d4hMatches = unitMembers.filter(f => f.teamEmail === d4hMember.teamEmail && f.id !== d4hMember.id);
      if (d4hMatches.length) {
        if (!duplicates[d4hMember.teamEmail]) {
          problems.push(`Multiple D4H users with unit email ${d4hMember.teamEmail}`);
        }
        duplicates[d4hMember.teamEmail] = true;
        continue;
      }

      // ======== GOOGLE
      let result = this.checkGoogle(d4hMember, googleMembers[d4hMember.teamEmail]);
      if (result.problem) {
        problems.push(result.problem);
      }
      delete googleMembers[d4hMember.teamEmail];

      // ======== SLACK
      const slackUser = slackUsers[d4hMember.teamEmail];
      if (slackUser) {
        delete slackUsers[d4hMember.teamEmail];
      }

      // ======== CALTOPO
      for (const email of d4hMember.emails) {
        // Get CalTopo users where the CalTopo email matches one of the D4H member's emails
        // For older, merged, CalTopo accounts, check our map of CalTopo email -> a good ESAR email
        const cUsers = caltopoUsers.filter(f => email.localeCompare(settings.users.caltopo.emailMap[f.email] ?? f.email, undefined, { sensitivity: 'accent' }) === 0);
        if (cUsers.length) {
          for (const cUser of cUsers) {
            delete caltopoLookup[cUser.id];
          }
        } else {
          //console.log(`D4H ${d4hMember.teamEmail} is not in CalTopo team`);
        }
      }
    }

    for (const extraGoogle of Object.values(googleMembers).filter(u => u.orgUnitPath === '/Members' && !u.suspended && !u.archived)) {
      problems.push(`Google member "${extraGoogle.name.fullName}" (${extraGoogle.primaryEmail}) is not in ESAR D4H group`);
    }

    for (const extraSlack of Object.values(slackUsers)) {
      problems.push(`Slack user "${extraSlack.real_name}" (${extraSlack.profile.email}) is not in ESAR D4H Group`);
    }

    for (const extraCaltopo of Object.values(caltopoLookup).filter(c => !settings.users.caltopo.extraMembers.includes(c.email))) {
      problems.push(`CalTopo member "${extraCaltopo.fullName}" (${extraCaltopo.email} is not in ESAR D4H group`);
    }
    return { problems };
  }


  private checkGoogle(d4hMember: D4HMember, gUser?: GoogleUser): { problem?: string } {
    if (!gUser) {
      return { problem: `D4H user "${d4hMember.name}" (${d4hMember.teamEmail}) does not have a Google account` };
    }

    if (gUser.orgUnitPath !== '/Members') {
      return { problem: `Google user ${gUser.primaryEmail} is not in /Members OU` };
    }

    //console.log(`D4H member ${d4hMember.id} ${d4hMember.name} ${d4hMember.teamEmail} matches Google user`);
    return {};
  }
}