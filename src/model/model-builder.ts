import { Logger } from "winston";
import getLogger, { LogFactory } from "../lib/logging";
import TeamModelContainer, { ModelAgent, PrimaryModelAgent } from "./team-model";
import { TeamGroup, TeamMember } from "./types";

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
}