import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from 'winston';

const CACHE_DIR = path.join(__dirname, '../../data/platform-cache');

interface PlatformCache {
  timestamp: number;
  data: unknown;
}

export abstract class BaseModelAgent<TCache extends PlatformCache> {
  protected readonly logger: Logger;
  protected readonly cache: TCache;

  readonly name: string;

  constructor(name: string, logger: Logger) {
    this.name = name;
    this.logger = logger;
  }

  abstract refreshCache(): Promise<void>;

  async loadSavedCache<TCache>() {
    let json: TCache;
    try {
      const contents = await fs.readFile(path.join(CACHE_DIR, `${this.name}.json`), 'utf-8');
      Object.assign(this.cache, JSON.parse(contents) as TCache);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.logger.info(`Cache for %s not found. Will need to refresh before init finished.`)
      } throw err;
    }
  }
}