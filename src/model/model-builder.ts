import { Logger } from "winston";
import getLogger, { LogFactory } from "../lib/logging";
import TeamModelContainer, { ModelAgent, PrimaryModelAgent } from "./team-model";
import { CheckConcern, TeamMember } from "./types";
import { getConcernList } from "./agents/agent-utils";

export default class ModelBuilder {
  private readonly primaryAgent: PrimaryModelAgent;
  private readonly agents: ModelAgent[] = [];

  private readonly logFactory: LogFactory;
  private readonly logger: Logger;

  constructor(primaryAgent: PrimaryModelAgent, logFactory: LogFactory = getLogger) {
    this.primaryAgent = primaryAgent;
    this.logFactory = logFactory;
    this.logger = logFactory('model-builder');
  }

  addAgent(agent: ModelAgent) {
    this.agents.push(agent);
  }

  buildModel(): TeamModelContainer {
    const start = new Date().getTime();

    const [ groups, members ] = this.primaryAgent.initializeDirectory();
    for (const agent of this.agents) {
      agent.populateMembers(members);
    }
    this.logger.debug('Build model time %d', new Date().getTime() - start);
    return new TeamModelContainer(
      members,
      groups,
      this.logFactory
    )
  }

  getModelUserReport() {
    const results: { member: TeamMember, concerns: CheckConcern[] }[] = [];
    const model = this.buildModel();
    const members = model.getAllMembers().sort((a,b) => {
      let d = a.name.last.localeCompare(b.name.last);
      if (d === 0) d = a.name.first.localeCompare(b.name.first);
      if (d === 0) d = (a.teamEmail??'').localeCompare(b.teamEmail??'');
      return d;
    });
    for (const member of members) {
      const concerns: CheckConcern[] = [];
      if (member.teamStatus.current) {
        if (member.teamEmail) {
          const dupeEmailUsers = members.filter(m => m !== member && m.emails.includes(member.teamEmail!));
          if (dupeEmailUsers.length > 0) {
            concerns.push({ level: 'fix', concern: `${member.teamEmail} belongs to multiple members: ${dupeEmailUsers.map(d => d.name.lastFirst)}` });
          }
        } else {
          concerns.push({ level: 'fix', concern: `${member.name.preferredFull} has no unit email`});
        }

      } else if (member.teamStatus.trainee) {
        // not working with trainees right now.
      } else {
        if (member.teamEmail) {
          concerns.push({ concern: `Non-member has unit email ${member.teamEmail}`, level: 'fix' });
        }
      }

      for (const agent of [ this.primaryAgent, ...this.agents ]) {
        concerns.push(...agent.getMemberConcerns(member));
      }

      if (concerns.length) {
        results.push({ member, concerns });
      }
    }
    return results;
  }

  getModelGroupMembershipReport() {
    const results: { member: TeamMember, concerns: CheckConcern[] }[] = [];
    const model = this.buildModel();
    const members = model.getAllMembers().sort((a,b) => {
      let d = a.name.last.localeCompare(b.name.last);
      if (d === 0) d = a.name.first.localeCompare(b.name.first);
      if (d === 0) d = (a.teamEmail??'').localeCompare(b.teamEmail??'');
      return d;
    });
    const groups = model.getAllGroups();
    for (const member of members) {
      const [ concerns ] = getConcernList();
      for (const agent of [ this.primaryAgent, ...this.agents ]) {
        concerns.push(...agent.getMembershipConcerns(member, groups));
      }
      if (concerns.length) {
        results.push({ member, concerns });
      }
    }
    return results;
  }
}