import Axios, { AxiosResponse } from 'axios';
import crypto from 'crypto';
import { Logger } from 'winston';
import { BasePlatform, PlatformCache } from "./base-platform"
import getLogger from '../lib/logging';

export interface CalTopoCache extends PlatformCache {
  data: {
    users: CalTopoUser[],
  }
}

export interface CalTopoUser {
  id: string;
  fullName: string;
  email: string;
  groups: Record<string, number>;
}

export interface CalTopoSettings {
  teams: {
    id: string,
    name: string,
    allowMembers: boolean,
    allowExternal?: boolean,
    expectGroups?: string[],
    minPermission?: number,
  }[];
  extraMembers?: string[];
  aliasEmails?: Record<string, string>;
}

export interface CalTopoMembershipApi {
  provider: string;
  created: number;
  direct: boolean;
  fullName: string;
  permission: number;
  id: string;
  email: string;
};

interface Secrets {
  accountId: string;
  authId: string;
  authSecret: string;
}


export default class CalTopoPlatform extends BasePlatform<CalTopoCache> {
  static name = 'CalTopo';

  private readonly settings: CalTopoSettings;
  private readonly secrets: Secrets;
  private readonly axios = Axios.create({ baseURL: 'https://caltopo.com' });

  constructor(settings: CalTopoSettings, secrets: Secrets, logger?: Logger) {
    super(CalTopoPlatform.name, { timestamp: 0, data: { users: [] } }, logger ?? getLogger(CalTopoPlatform.name));
    this.settings = settings;
    this.secrets = secrets;
  }

  async refreshCache(force?: boolean): Promise<void> {
    this.logger.info('refreshcache %s', this.cache);
    if (this.cache.timestamp === 0) {
      await this.loadSavedCache();
    }

    if (new Date().getTime() - this.cache.timestamp < 15 * 60 * 1000 && !force) {
      return;
    }

    this.logger.debug('getting data from CalTopo...');

    const apiTeams = await Promise.all(
      this.settings.teams.map(teamSetting => {
        return this.get(`/api/v0/group/${teamSetting.id}/members`).then(result => ({ teamSetting, list: result.list as CalTopoMembershipApi[] }));
      })
    );

    const userMap: Record<string, CalTopoUser> = {};
    for (const team of apiTeams) {
      for (const membership of team.list) {
        let user = userMap[membership.id];
        if (user) {
          user.groups[team.teamSetting.id] = membership.permission;
        } else {
          userMap[membership.id] = {
            id: membership.id,
            fullName: membership.fullName,
            email: membership.email,
            groups: { [team.teamSetting.id]: membership.permission }
          };
        }
      }
    }

    Object.assign(this.cache, {
      timestamp: new Date().getTime(),
      data: {
        users: Object.values(userMap),
      },
    });
    await this.saveCache();
  }

  getAllUsers() {
    return this.cache.data.users;
  }

  async get(url: string) {
    return this.getResult(this.axios.get(this.generateGetUrl(url)));
  }

  async getResult(request: Promise<AxiosResponse>) {
    const result = await request;
    const json = result.data;
    if (json.status !== 'ok') {
      throw Error('request failed');
    }
    return json.result;
  }

  post(url: string, json: object) {
    const absUrl = `${this.axios.defaults.baseURL}${url}`;
    const payload = this.signUrl('POST', url, json);
    return this.getResult(this.axios({
      method: 'POST',
      url: `${this.axios.defaults.baseURL}${url}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: payload
    }));
  }

  private sign(method: string, url: string, expires: number, payloadString: string) {
    const message = `${method} ${url}\n${expires}\n${payloadString}`;
    const secret = Buffer.from(this.secrets.authSecret, 'base64');
    let test = crypto.createHmac('sha256', secret).update(message).digest("base64");
    return test;
  }

  private signUrl(method: string, url: string, payload?: object) {
    const payloadString = payload ? JSON.stringify(payload) : '';
    const expires = new Date().getTime() + 300 * 1000;
    const signature = this.sign(method, url, expires, payloadString);
    const parameters = {
      id: this.secrets.authId,
      expires: expires,
      signature,
      json: payloadString
    };
    let queryString = Object.entries(parameters).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
    return queryString;
  }

  private generateGetUrl(relativeUrl: string, payload?: object) {
    return `${this.axios.defaults.baseURL}${relativeUrl}?${this.signUrl('GET', relativeUrl, payload)}`;
  }
}