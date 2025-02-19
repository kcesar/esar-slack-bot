import { config } from '@dotenvx/dotenvx';
import express from 'express';
import { LogLevel, SocketModeClient } from '@slack/socket-mode';
import WorkspaceClient from './lib/remote-services/googleWorkspace';
import { D4HClient } from './lib/remote-services/d4h';
import { SyncUsersTask } from './tasks/sync-users';
import CalTopoClient from './lib/remote-services/caltopo';
import SlackClient from './lib/remote-services/slack';
import CommandRouter from './commands';

config({ path: ['.env.local', '.env'], ignore: ['MISSING_ENV_FILE'] });

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    const app = express();
    const port = process.env.PORT || 3000;

    app.get('/task/sync-users', async (req, res) => {
      const to = req.query.to;
      if (!to) {
        res.status(400).json({ status: 'err', message: 'missing <to> parameter' });
        return;
      }
      const result = await new SyncUsersTask(d4h, google, slack, caltopo).run();
      if (result.problems?.length) {
        for (const target of to.split(';').map(f => f.trim())) {
          await slack.send(target, [SlackClient.textToBlock('Took at look at different ESAR platforms. Found some problems:'), SlackClient.listToListBlock(result.problems)]);
        }
      }
      res.json({ status: 'ok', result: { problemCount: result.problems?.length ?? 0 } });
    });

    app.listen(port, () => {
      console.log('Local server started on port ', port);
      resolve();
    });
  });
}

async function startBotSocket() {
  const client = new SocketModeClient({ appToken: process.env.SLACK_APP_TOKEN! });
  const commands = new CommandRouter(slack, d4h, google);

  client.on('connecting', () => console.log('connecting'));
  client.on('connected', () => console.log('connected'));
  client.on('message', async ({ event, body, ack }) => {
    if (event.bot_id && (await slack.getMemberById(event.user))?.profile.bot_id === event.bot_id) {
      await ack();
      return;
    } else if (event.text?.startsWith('cmd /')) {
      await ack();
      const parts = event.text.split(' ', 3);
      commands.handle({
        command: parts[1],
        text: parts[2],
        channel_id: event.channel,
        user_id: event.user,
      });
      return;
    }
    console.log('slack message', event);
    await ack();
  });

  client.on('slash_commands', async ({ ack, body }) => {
    try {
      await ack();
      await commands.handle(body);
    } catch (err) {
      console.log(body);
      console.error(err);
    }
  });

  await client.start();
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
  startBotSocket();
  startServer();
  google.init();
  d4h.reload();
} else if (process.argv[2] === 'sync-users') {
  (async () => console.log((await new SyncUsersTask(d4h, google, slack, caltopo).run()).problems))();
} else if (process.argv[2] === 'wacs') {
  const slack = {
    post(channel: string, text: string, blocks: unknown) { console.log('SLACK MSG', channel, text, blocks); }
  } as unknown as SlackClient;

  new CommandRouter(slack, d4h, google).handle({
    command: '/wacs',
    text: `<mailto:${process.argv[3]}|${process.argv[3]}>`,
    channel_id: 'foo',
    user_id: 'user_id',
  });
}
