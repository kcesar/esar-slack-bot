import Axios from 'axios';
import crypto from 'crypto';

export interface CaltopoMembership {
  provider: string;
  created: number;
  direct: boolean;
  fullName: string;
  permission: number;
  id: string;
  email: string;
};

export default class CalTopoClient {
  axios = Axios.create({
    baseURL: 'https://caltopo.com'
  });
  private readonly accountId: string;
  private readonly authId: string;
  private readonly authKey: string;

  constructor(args: { accountId: string, authId: string, authKey: string }) {
    this.accountId = args.accountId;
    this.authId = args.authId;
    this.authKey = args.authKey;
  }

  async getTeamMembers(teamId: string) {
    return (await this.get(`/api/v0/group/${teamId}/members`)).list as CaltopoMembership[];
  }

  /**
   * 
   * @returns
   */
  getObjects() {
    return this.getObjectsSince(0);
  }

  /**
   * 
   * @param time 
   * @returns 
   */
  async getObjectsSince(time) {
    return this.get(`/api/v1/acct/${this.accountId}/since/${time}`);
  }

  /**
   * 
   * @param mapId The map id
   * @returns     The full contents of the map
   */
  async getMap(mapId) {
    return this.getMapSince(mapId, 0);
  }

  /**
   * 
   * @param mapId 
   * @param time  
   * @returns     The contents of the map that have been added since {time}
   */
  async getMapSince(mapId, time) {
    return this.get(`/api/v1/map/${mapId}/since/${time}`);
  }

  async get(url) {
    return this.getResult(this.axios.get(this.generateGetUrl(url)));
  }

  async getResult(request) {
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
    console.log('payload', payload);
    return this.getResult(this.axios({
      method: 'POST',
      url: `${this.axios.defaults.baseURL}${url}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: payload
    }));
  }

  sign(method: string, url: string, expires: number, payloadString: string) {
    const message = `${method} ${url}\n${expires}\n${payloadString}`;
    const secret = Buffer.from(this.authKey, 'base64');
    let test = crypto.createHmac('sha256', secret).update(message).digest("base64");
    return test;
  }

  signUrl(method: string, url: string, payload?: object) {
    const payloadString = payload ? JSON.stringify(payload) : '';
    const expires = new Date().getTime() + 300 * 1000;
    const signature = this.sign(method, url, expires, payloadString);
    const parameters = {
      id: this.authId,
      expires: expires,
      signature,
      json: payloadString
    };
    let queryString = Object.entries(parameters).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
    // if (payload) {
    //   queryString += "&" + payloadString
    // }
    return queryString;
  }

  generateGetUrl(relativeUrl: string, payload?: object) {
    return `${this.axios.defaults.baseURL}${relativeUrl}?${this.signUrl('GET', relativeUrl, payload)}`;
  }
}

