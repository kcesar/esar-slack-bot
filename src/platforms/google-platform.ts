import * as fs from 'fs/promises';
import { JWT } from 'google-auth-library';
import { admin_directory_v1, google } from 'googleapis';
import { Logger } from "winston";
import { BasePlatform, PlatformCache } from "./base-platform";
import getLogger from "../lib/logging";

export interface GoogleUser {
  primaryEmail: string,
  name: {
    givenName: string,
    familyName: string,
    fullName: string,
  };
  emails: { address: string, type?: string }[];
  phones?: { value: string, type: string }[];
  orgUnitPath: string;
  isMailboxSetup: boolean;
  archived: boolean;
  suspended: boolean;
  suspensionReason: string;
}

interface GoogleMembership {
  email: string; // Member email
  group: string;
  role: string;
  type: 'USER'|'GROUP';
  status: 'ACTIVE'|'SUSPENDED';
}

export interface GoogleCache extends PlatformCache {
  data: {
    users: GoogleUser[],
    memberships: (GoogleMembership)[],
  }
}

export interface GoogleSecrets {
  customer: string;
  credentials: string;
  adminEmail: string;
}

export interface GooglePlatformSettings {
  groups: {
    title: string,
    email: string,
  }[];
}

export default class GooglePlatform extends BasePlatform<GoogleCache> {
  private readonly settings: GooglePlatformSettings;
  private readonly secrets: GoogleSecrets;

  constructor(settings: GooglePlatformSettings, secrets: GoogleSecrets, logger?: Logger) {
    super('Google', { timestamp: 0, data: { users: [], memberships: [] } }, logger ?? getLogger('Google'));
    this.settings = settings;
    this.secrets = secrets;
  }

  getAllUsers() {
    return this.cache.data.users;
  }

  getUserMemberships(userEmail: string): GoogleMembership[] {
    return this.cache.data.memberships.filter(m => m.email === userEmail && m.status === 'ACTIVE');
  }

  async updateUser(email: string, properties: Partial<GoogleUser>) {
    const jwtClient = await this.getJwtClient();
    const dir = google.admin('directory_v1');
    await dir.users.update({
      auth: jwtClient,
      userKey: email,
      requestBody: properties,
    });
  }

  async addToGroup(email: string, group: string) {
    const jwtClient = await this.getJwtClient();
    const dir = google.admin('directory_v1');
    await dir.members.insert({
      auth: jwtClient,
      groupKey: group,
      requestBody: {
        email,
        role: 'MEMBER'
      },
    });
  }

  async refreshCache(force?: boolean): Promise<void> {
    this.logger.info('refreshcache %s', this.cache);
    if (this.cache.timestamp === 0) {
      await this.loadSavedCache();
    }

    if (new Date().getTime() - this.cache.timestamp < 15 * 60 * 1000 && !force) {
      return;
    }

    this.logger.debug('getting data from Google...');

    const jwtClient = await this.getJwtClient();

    const PAGE_SIZE = 500;
    const dir = google.admin('directory_v1');
    let nextPage: string | undefined = undefined;
    let lastLength: number;
    let users: GoogleUser[] = [];

    do {
      const data = (await dir.users.list({
        customer: this.secrets.customer,
        auth: jwtClient,
        maxResults: PAGE_SIZE,
        pageToken: nextPage
      })).data;

      lastLength = data.users.length;
      nextPage = data.nextPageToken;
      users = users.concat(data.users as GoogleUser[]);
      this.logger.debug(`Loaded ${lastLength} users`);
    } while (lastLength >= PAGE_SIZE);

    const groupGetter: (id: string) => Promise<Omit<GoogleMembership, 'group'>[]> = this.getGroupMembers.bind(this, jwtClient, dir);
    const memberships = (await Promise.all(this.settings.groups.flatMap(groupSetting => {
      return groupGetter(groupSetting.email).then(list => {
        const m = list.map(membership => ({ ...membership, group: groupSetting.email }));
        return m;
      });
    }))).flatMap(m => m);


    Object.assign(this.cache, {
      timestamp: new Date().getTime(),
      data: {
        users,
        memberships,
      },
    });
    await this.saveCache();
  }

  private async getGroupMembers(jwtClient: JWT, directory: admin_directory_v1.Admin, groupId: string) {
    let nextPage: string | undefined = undefined;
    let members: Omit<GoogleMembership, 'group'>[] = [];

    do {
      const data = (await directory.members.list({
        groupKey: `${groupId}@kcesar.org`,
        auth: jwtClient,
        maxResults: 200,
        pageToken: nextPage
      })).data;
      nextPage = data.nextPageToken;
      members = members.concat(data.members as Omit<GoogleMembership, 'group'>[]);
    } while (nextPage);
    return members;
  }

  
  private async getJwtClient() {
    const creds = JSON.parse(this.secrets.credentials);
    const jwtClient = new google.auth.JWT(
      creds.client_email,
      undefined,
      creds.private_key,
      [
        'https://www.googleapis.com/auth/admin.directory.user',
        'https://www.googleapis.com/auth/admin.directory.group',
      ],
      this.secrets.adminEmail,
    );
    return jwtClient;
  }
}