
export interface TeamStatus {
  title: string;
  current?: boolean;
  trainee?: boolean;
  mission?: boolean;
  field?: boolean;
}

export interface Qualification {
  title: string;
}

export interface GroupExpectation {
  qualification: Qualification;
  type: 'simple';
}

export interface TeamGroup {
  title: string;
  expectations: GroupExpectation[];
  expectationsLoaded: boolean;
  platforms: Record<string, any>;
  virtual?: true;
}

export interface TeamMember {
  teamEmail?: string;
  teamStatus: TeamStatus;
  emails: string[];
  name: { first: string; last: string; lastFirst: string, preferred: string, preferredFull: string };
  groups: TeamGroup[];
  photo?: string;
  platforms: Record<string, unknown>;
}