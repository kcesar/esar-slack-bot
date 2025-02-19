import { writeFile } from 'fs/promises';
import { config } from '@dotenvx/dotenvx';
import Axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { parse as parseHtml } from 'node-html-parser';

import { D4HClient, OPERATIONAL_STATUS_GROUP_ID } from '../src/lib/remote-services/d4h';


/**
 * npx tsx tools/scrape-expectations <d4h-domain> <d4h-email> <d4h-password>
 */

config({ path: ['.env.local', '.env'], ignore: ['MISSING_ENV_FILE'] });

const d4hApi = new D4HClient(
  process.env.D4H_TEAM ?? '',
  process.env.TEAM_DOMAIN ?? '',
  process.env.D4H_TOKEN ?? '',
  process.env.D4H_V2_TOKEN ?? '',
);

const d4hDomain = process.argv[2];
const d4hUser = process.argv[3];
const d4hPassword = process.argv[4];

class D4HWebClient {
  jar = new CookieJar();
  axios: AxiosInstance = wrapper(Axios.create({ jar: this.jar, baseURL: `https://${d4hDomain}.team-manager.us.d4h.com` }));;
  initied: boolean = false;

  async setup() {
    if (!this.initied) {
      let response = await this.axios.get(`https://team-manager.us.d4h.com/login?redirect=https%3A%2F%2F${d4hDomain}.team-manager.us.d4h.com%2Fteam%2Fdashboard`);
      const crumb = /\<meta name="csrf-token" content="([^"]+)">/.exec(response.data)?.[1] ?? '';

      let params = new URLSearchParams();
      params.append('crumb', crumb);
      params.append('email', d4hUser);
      params.append('password', d4hPassword);
      response = await this.axios.post(
        `https://accounts.us.d4h.com/password`,
        params,
        {
          headers: { 'content-type': 'application/x-www-form-urlencoded' }
        }
      );

      this.initied = true;
    }
  }

  async getGroupsExpectingQualification(qualificationId: number) {
    await this.setup();
    const response = await this.axios.get(`/team/courses/expected/${qualificationId}`);
    const root = parseHtml(response.data);
    const rows = root.querySelectorAll('tr');
    return rows.flatMap(tr => tr.querySelectorAll('input[value="required"]')
      .filter(i => i.attributes.checked !== undefined)
      .map(i => i.attributes['name'].split(/[\[\]]/)[1]))
      .map(g => g === "'s1'" ? OPERATIONAL_STATUS_GROUP_ID : Number(g));
  }
}

function groupMapToJson(byGroup: Record<number, number[]>, groups: Record<number, any>, qualifications: Record<number, any>) {
  const json: Record<string, { course: string, type: 'simple' }[]> = {};
  for (const groupId in byGroup) {
    const quals = byGroup[groupId];
    if (quals.length == 0) continue;
    json[groups[groupId].title] = byGroup[groupId].map(q => ({ course: qualifications[q].title, type: 'simple' }));
  }
  return json;
}

(async () => {
  const web = new D4HWebClient();

  const groups = await d4hApi.getGroups();
  const qualifications = await d4hApi.getQualifications();

  const groupExpectations: Record<number, number[]> = {};
  const qualCount = Object.keys(qualifications).length;
  let idx = 0;
  for (const qualId in qualifications) {
    const id = Number(qualId);
    console.log(++idx, qualCount, id, qualifications[qualId].title);
    const groupsRequiring = await web.getGroupsExpectingQualification(id);
    console.log('  ', groupsRequiring.join());
    for (const groupId of groupsRequiring) {
      groupExpectations[groupId] = [...groupExpectations[groupId] ?? [], id];
    }
    console.log(groupMapToJson(groupExpectations, groups, qualifications));
  }
  await writeFile("data/full-expectations.json", JSON.stringify(groupMapToJson(groupExpectations, groups, qualifications), undefined, 2));
})();