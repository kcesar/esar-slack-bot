import { config } from '@dotenvx/dotenvx';
import express from 'express';
import WorkspaceClient from './remote-services/googleWorkspace';
import { D4HClient } from './remote-services/d4h';
import { SyncUsersTask } from './tasks/sync-users';

config({ path: ['.env.local', '.env'], ignore: ['MISSING_ENV_FILE'] });

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    const app = express();
    const port = process.env.PORT || 3000;

    app.listen(port, () => {
      console.log('Local server started on port ', port);
      resolve();
    });
  });
}

const google = new WorkspaceClient(
  process.env.GOOGLE_CUSTOMER ?? '',
  process.env.GOOGLE_ADMIN_ACCOUNT ?? '',
  process.env.GOOGLE_CREDENTIALS ?? ''
);
const d4h = new D4HClient(
  process.env.D4H_TEAM ?? '',
  process.env.TEAM_DOMAIN ?? '',
  process.env.D4H_TOKEN ?? '',
  process.env.D4H_V2_TOKEN ?? '',
);

if (process.argv.length == 2) {
  startServer();
} else if (process.argv[2] === 'sync-users') {
  new SyncUsersTask(d4h, google).run();
}
