import * as fs from 'fs/promises';
import { google } from 'googleapis';
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

export interface GoogleCache extends PlatformCache {
  data: {
    users: GoogleUser[]
  }
}

export interface GoogleSecrets {
  customer: string;
  credentials: string;
  adminEmail: string;
}

export interface GooglePlatformSettings {
}

export default class GooglePlatform extends BasePlatform<GoogleCache> {
  private readonly settings: GooglePlatformSettings;
  private readonly secrets: GoogleSecrets;

  constructor(settings: GooglePlatformSettings, secrets: GoogleSecrets, logger?: Logger) {
    super('Google', { timestamp: 0, data: { users: [] } }, logger ?? getLogger('Google'));
    this.secrets = secrets;
  }

  getAllUsers() {
    return this.cache.data.users;
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

    Object.assign(this.cache, {
      timestamp: new Date().getTime(),
      data: {
        users,
      },
    });
    await this.saveCache();
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