import { TeamGroup, TeamMember } from "./types";
import { Logger } from 'winston';
import { equalsInsensitive } from '../../src-x/lib/util';
import getLogger, { LogFactory } from '../lib/logging';
import { groupsmigration } from "googleapis/build/src/apis/groupsmigration";


export const TEMPLATE_MEMBER: TeamMember = {
  name: { first: 'Unknown', last: 'User', lastFirst: 'User, Unknown', preferred: 'Unknown', preferredFull: 'Unknown User' },
  groups: [],
  teamStatus: { title: 'empty', current: false, trainee: false, field: false },
  emails: [],
  platforms: {},
} as const;

export interface PrimaryModelAgent extends ModelAgent {
  initializeDirectory(): [ TeamGroup[], TeamMember[] ];
}

export interface ModelAgent {
  readonly name: string;
  populateMembers(members: TeamMember[]): void;
}

export default class TeamModelContainer {
  private readonly logger: Logger;

  private members: TeamMember[];
  private groups: TeamGroup[];
  
  constructor(members: TeamMember[], groups: TeamGroup[], logFactory: LogFactory = getLogger) {
    this.members = members;
    this.groups = groups;
    this.logger = logFactory('team-model');
  }

  searchForMember(key: string) {
    return this.members.filter(m => equalsInsensitive(m.teamEmail, key) || equalsInsensitive(m.name.preferredFull, key));
  }
}