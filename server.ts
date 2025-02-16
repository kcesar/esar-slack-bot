import { config } from '@dotenvx/dotenvx';
import express from 'express';
import WorkspaceClient from './remote-services/googleWorkspace';
import { D4HClient } from './remote-services/d4h';
import { SyncUsersTask } from './tasks/sync-users';
import CalTopoClient from './remote-services/caltopo';
import SlackClient from './remote-services/slack';

config({ path: ['.env.local', '.env'], ignore: ['MISSING_ENV_FILE'] });

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    const app = express();
    const port = process.env.PORT || 3000;

    app.get('/task/sync-users', async (req, res) => {
      const to = req.query.to;
      if (!to) {
        res.status(400).json({ status:'err', message: 'missing <to> parameter'});
        return;
      }
      const result = await new SyncUsersTask(d4h, google, slack, caltopo).run();
      if (result.problems?.length) {
        for (const target of to.split(';').map(f => f.trim())) {
          await slack.send(target, [ SlackClient.textToBlock('Took at look at different ESAR platforms. Found some problems:'), SlackClient.listToListBlock(result.problems)]);
        }
      }
      res.json({status: 'ok', result: { problemCount: result.problems?.length ?? 0 }});
    });

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
const slack = new SlackClient(
  process.env.SLACK_BOT_TOKEN ?? ''
);
const caltopo = new CalTopoClient({
  accountId: process.env.CALTOPO_ACCOUNT_ID ?? '',
  authId: process.env.CALTOPO_AUTH_ID ?? '',
  authKey: process.env.CALTOPO_AUTH_SECRET ?? '',
});

if (process.argv.length == 2) {
  startServer();
} else if (process.argv[2] === 'sync-users') {
  (async () => console.log((await new SyncUsersTask(d4h, google, slack, caltopo).run()).problems))();
}
