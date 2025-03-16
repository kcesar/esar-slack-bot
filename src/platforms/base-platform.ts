import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from 'winston';

const CACHE_DIR = path.join(__dirname, '../../data/platform-cache');

export interface PlatformCache {
  timestamp: number;
  data: unknown;
}

export abstract class BasePlatform<TCache extends PlatformCache> {
  protected readonly logger: Logger;
  protected readonly cache: TCache;

  readonly name: string;
  private isRefreshing: boolean = false;

  constructor(name: string, emptyCache: TCache, logger: Logger) {
    this.name = name;
    this.cache = emptyCache;
    this.logger = logger;
  }

  async afterRefresh(wait?: boolean) {
    const promise = this.refresh();
    if (wait) {
      await promise;
    }
    return this;
  }

  async refresh(force?: boolean): Promise<void> {
    if (this.isRefreshing) {
      this.logger.debug(`Already refreshing cache. Skipping this trigger.`);
      return;
    }
    try {
      await this.refreshCache(force);
    } finally {
      this.isRefreshing = false;
    }
  }

  protected abstract refreshCache(force?: boolean): Promise<void>;

  async loadSavedCache() {
    let json: TCache;
    try {
      const contents = await fs.readFile(path.join(CACHE_DIR, `${this.name}.json`), 'utf-8');
      Object.assign(this.cache, JSON.parse(contents) as TCache);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.logger.info(`Cache for %s not found. Will need to refresh before init finished.`, this.name);
      } else {
        throw err;
      }
    }
  }

  async saveCache() {
    await fs.writeFile(path.join(CACHE_DIR, `${this.name}.json`), JSON.stringify(this.cache, null, 2), 'utf-8');
  }
}