import * as fs from 'fs/promises';
import { join } from 'path';

export interface SyncSettings {
  users: {
    d4h: {
      membersGroup: number;
    },
    caltopo: {
      teamId: string;
      extraMembers: string[];
      emailMap: Record<string, string>;
    },
  }
}
export async function loadSyncSettings() {
  return JSON.parse(await fs.readFile(join(__dirname, '../data/sync-settings.json'), 'utf-8')) as SyncSettings;
}