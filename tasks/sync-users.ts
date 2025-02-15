import { loadSyncSettings } from "../lib/sync";
import { D4HClient, D4HMember } from "../remote-services/d4h";
import WorkspaceClient, { GoogleUser } from "../remote-services/googleWorkspace";

interface SARMember {
  emails: string[];
  name: { fullName: string },
}

export class SyncUsersTask {
  private readonly d4h: D4HClient;
  private readonly google: WorkspaceClient;

  constructor(d4h: D4HClient, google: WorkspaceClient) {
    this.d4h = d4h;
    this.google = google;
  }

  async run() {
    const settings = await loadSyncSettings();
    const unitMembers = (await this.d4h.getGroupMembers(settings.users.d4h.membersGroup));
    const googleMembers: Record<string, GoogleUser> = {};
    for (const gUser of await this.google.getUsers()) {
      googleMembers[gUser.primaryEmail.toLowerCase()] = gUser;
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

      let result = this.checkGoogle(d4hMember, googleMembers[d4hMember.teamEmail]);
      if (result.problem) {
        problems.push(result.problem);
      }
      delete googleMembers[d4hMember.teamEmail];
    }

    for (const extraGoogle of Object.values(googleMembers).filter(u => u.orgUnitPath === '/Members' && !u.suspended && !u.archived)) {
      console.log(extraGoogle);
      problems.push(`Google member "${extraGoogle.name.fullName}" (${extraGoogle.primaryEmail}) is not in ESAR D4H group`);
    }
    console.log(problems);
  }

  private checkGoogle(d4hMember: D4HMember, gUser?: GoogleUser): { problem?: string } {
    if (!gUser) {
      return { problem: `D4H user "${d4hMember.name}" (${d4hMember.teamEmail}) does not have a Google account` };
    }

    if (gUser.orgUnitPath !== '/Members') {
      return { problem: `Google user ${gUser.primaryEmail} is not in /Members OU` };
    }

    console.log(`D4H member ${d4hMember.id} ${d4hMember.name} ${d4hMember.teamEmail} matches Google user`);
    return {};
  }
}