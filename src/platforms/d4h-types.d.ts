
// export interface v2Member {
//   id: number;
//   ref: string,
//   name: string;
//   email: string;
//   position: string;
//   urls: { image: string },
//   status: { type: string, value: string },
//   custom_fields: { label: string, value: string }[];
//   group_ids: number[];
// }

export interface v3CustomField {
  id: number;
  title: string;
}

export interface v3Member {
  id: number;
  name: string;
  position?: string;
  status: 'OPERATIONAL'|'NON_OPERATIONAL'|'OBSERVER'|'RETIRED'|'DELETED';
  email?: { value: string };
  customFieldValues: Array<{
    customField: {
      id: number;
    },
    value: string,
  }>;
}

export interface v3Group {
  id: number;
  title: string;
}

export interface v3GroupMembership {
  id: number;
  group: { id: number };
  member: { id: number };
}

export interface v3Qualification {
  id: number;
  cost: unknown | null;
  description: string;
  expiredCost: unknown | null;
  reminderDays: number;
  title: string;
  deprecatedBundle?: string;
  createdAt: string;
  updatedAt: string;
  expiresMonthsDefault: number;
}

export interface v3Award {
  id: number;
  startsAt: Date;
  endsAt: Date | null;
  qualification: {
    id: number;
    title: string;
  };
  member: {
    id: number;
  }
}


export interface D4HSecrets {
  v3Token: string;
}

export interface D4HPlatformSettings {
  teamId: number;
  excludeGroups?: string;
}