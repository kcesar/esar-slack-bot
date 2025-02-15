import * as fs from 'fs/promises';
import { google } from 'googleapis';

export interface GoogleUser {
  primaryEmail: string,
  name: {
    givenName: string,
    familyName: string,
    fullName: string,
  };
  phones?: { value: string, type: string }[];
  orgUnitPath: string;
  isMailboxSetup: boolean;
  archived: boolean;
  suspended: boolean;
  suspensionReason: string;
}

const REFRESH_MILLIS = 1000 * 60 * 5;

class WorkspaceClient {
  private readonly customer: string;
  private readonly adminAccount: string;
  private readonly credentialsJson: string;

  private cacheUsers: {
    users: GoogleUser[],
    lookup: { [email: string]: GoogleUser },
  } = {
      users: [],
      lookup: {}
    };
  private cacheTime: number = 0;
  private loading: boolean = false;

  constructor(customer: string, adminAccount: string, credentialsJson: string) {
    this.customer = customer;
    this.adminAccount = adminAccount;
    this.credentialsJson = credentialsJson;
  }

  private async init() {
    await this.loadUsers();
    return this;
  }

  forceReload() {
    this.cacheTime = 0;
    this.loading = false;
    this.init();
  }

  async getUsers(options?: { ou?: string }) {
    await this.init();
    let users = this.cacheUsers.users;
    if (options?.ou) {
      users = users.filter(f => f.orgUnitPath === `/${options.ou}`);
    }
    return users;
  }

  async getUserFromEmail(email: string) {
    await this.init();
    return this.cacheUsers.lookup[email];
  }

  async getGroupMembers(groupKey: string) {
    const jwtClient = await this.getJwtClient();
    const dir = google.admin('directory_v1');
    const result = (await dir.members.list({
      auth: jwtClient,
      groupKey
    }));
    return result.data.members ?? [];
  }

  private async loadUsers() {
    const isRecent = (new Date().getTime() - REFRESH_MILLIS < this.cacheTime);
    if (this.loading || isRecent) return;
    this.loading = true;

    const jwtClient = await this.getJwtClient();

    const PAGE_SIZE = 500;
    const dir = google.admin('directory_v1');
    let nextPage: string | undefined = undefined;
    let lastLength: number;
    let users: GoogleUser[] = [];

    do {
      const data = (await dir.users.list({
        customer: this.customer,
        auth: jwtClient,
        maxResults: PAGE_SIZE,
        pageToken: nextPage
      })).data;

      lastLength = data.users.length;
      nextPage = data.nextPageToken;
      users = users.concat(data.users as GoogleUser[]);
      console.log(`Loaded ${lastLength} users`)
    } while (lastLength >= PAGE_SIZE);

    this.cacheTime = new Date().getTime();
    this.cacheUsers = {
      lookup: users.reduce((accum, cur) => ({ ...accum, [cur.primaryEmail]: cur }), {}),
      users,
    };
    this.loading = false;
  }

  private async getJwtClient() {
    let creds: any;
    if (this.credentialsJson) {
      console.log('Reading creds from the environment');
      creds = JSON.parse(this.credentialsJson);
    } else {
      let credsFile = "google-credentials.json";
      try {
        await fs.access(credsFile)
      } catch {
        credsFile = `../${credsFile}`;
      }

      const credsContent = await fs.readFile(credsFile);
      creds = JSON.parse(credsContent.toString());
    }
    const jwtClient = new google.auth.JWT(
      creds.client_email,
      undefined,
      creds.private_key,
      [
        'https://www.googleapis.com/auth/admin.directory.user',
        'https://www.googleapis.com/auth/admin.directory.group',
      ],
      this.adminAccount
    );
    return jwtClient;
  }
}

export default WorkspaceClient;