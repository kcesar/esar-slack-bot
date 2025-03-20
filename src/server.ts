import { config } from '@dotenvx/dotenvx';
import * as fs from 'fs/promises';
import path from 'path';
import express from 'express';
import { LogLevel, SocketModeClient } from '@slack/socket-mode';
import { GenericMessageEvent, MessageEvent } from '@slack/types';

import getLogger from './lib/logging';
import D4HPlatform from './platforms/d4h-platform';
import GooglePlatform, { GooglePlatformSettings } from './platforms/google-platform';
import SlackPlatform, { SlackSettings } from './platforms/slack-platform';
import { Settings } from './global';
import { D4HPlatformSettings } from './platforms/d4h-types';
import CommandRouter from './commands';
import ModelBuilder from './model/model-builder';
import D4HAgent from './model/agents/d4h-agent';
import GoogleAgent from './model/agents/google-agent';
import SlackAgent from './model/agents/slack-agent';
import { split } from './lib/util';
import { setupTasks } from './tasks';
import CalTopoPlatform, { CalTopoSettings } from './platforms/caltopo-platform';
import CalTopoAgent from './model/agents/caltopo-agent';

config({ path: ['.env.local', '.env'], ignore: ['MISSING_ENV_FILE'] }) as Settings;
const logger = getLogger('server');


function isGenericMessage(msg: MessageEvent): msg is GenericMessageEvent {
  return msg.type === 'message' && (msg as any).subtype === undefined;
}

async function startBotSocket(commands: CommandRouter) {
  const client = new SocketModeClient({ appToken: process.env.SLACK_APP_TOKEN!, logLevel: LogLevel.INFO });

  client.on('connecting', () => logger.info('Slack connecting'));
  client.on('connected', () => logger.info('Slack connected'));
  client.on('message', async ({ event, ack }: { event: MessageEvent, ack: () => Promise<void> }) => {
    const start = new Date().getTime();
    try {
      if (!isGenericMessage(event)) {
        logger.debug('Non-generic message', { event });
        return;
      } else if (event.bot_id) {
        logger.silly('Ignoring bot message', { event });
        return;
      }

      if (event?.text?.startsWith('test /')) {
        const parts = split(event.text, / /g, 3);
        logger.debug(`parts ${event.text} ${JSON.stringify(parts)}`);
        commands.handle({
          command: parts[1],
          text: parts[2],
          channel_id: event.channel,
          user_id: event.user,
        }).then(() => logger.debug('handle command time %d', new Date().getTime() - start));
      } else {
        logger.info('Slack message %s', event);
      }
    } catch (err) {
      logger.error('Error handling Slack message', { event, err });
    } finally {
      ack();
    }
  });
  // client.on('message', async ({ event, body, ack }) => {
  //   if (event.bot_id && (await slack.getMemberById(event.user))?.profile.bot_id === event.bot_id) {
  //     await ack();
  //     return;
  //   } else if (event.text?.startsWith('cmd /')) {
  //     await ack();
  //     const parts = event.text.split(' ', 3);
  //     commands.handle({
  //       command: parts[1],
  //       text: parts[2],
  //       channel_id: event.channel,
  //       user_id: event.user,
  //     });
  //     return;
  //   }
  //   console.log('slack message', event);
  //   await ack();
  // });

  // client.on('slash_commands', async ({ ack, body }) => {
  //   try {
  //     await ack();
  //     await commands.handle(body);
  //   } catch (err) {
  //     console.log(body);
  //     console.error(err);
  //   }
  // });

  await client.start();
}

function startServer(buildModel: (wait: boolean) => Promise<ModelBuilder>, slack: SlackPlatform): Promise<void> {
  return new Promise((resolve) => {
    const app = express();
    const port = process.env.PORT || 3000;

    setupTasks(app, buildModel, slack);

    app.listen(port, () => {
      logger.info('Local server started on port %s', port);
      resolve();
    });
  });
}

async function setupPlatforms(settings: Settings) {
  const d4h = new D4HPlatform(settings.platforms.D4H as D4HPlatformSettings, {
    v2Token: process.env.D4H_V2_TOKEN ?? '',
    v3Token: process.env.D4H_TOKEN ?? '',
  }, logger);
  const google = new GooglePlatform(settings.platforms.Google as GooglePlatformSettings, {
    customer: process.env.GOOGLE_CUSTOMER ?? '',
    credentials: process.env.GOOGLE_CREDENTIALS ?? '',
    adminEmail: process.env.GOOGLE_ADMIN_ACCOUNT ?? '',
  }, logger);
  const slack = new SlackPlatform(settings.platforms.Slack as SlackSettings, {
    botToken: process.env.SLACK_BOT_TOKEN ?? ''
  });
  const caltopo = new CalTopoPlatform(settings.platforms.CalTopo as CalTopoSettings, {
    accountId: process.env.CALTOPO_ACCOUNT_ID ?? '',
    authId: process.env.CALTOPO_AUTH_ID ?? '',
    authSecret: process.env.CALTOPO_AUTH_SECRET ?? '',
  });

  const start = new Date().getTime();
  await Promise.all([
    d4h.refresh(),
    google.refresh(),
    slack.refresh(),
    caltopo.refresh(),
  ]);
  logger.debug('refresh cache time %d', new Date().getTime() - start);

  return {
    d4h,
    google,
    slack,
    caltopo,
    training: d4h,
  }
}

async function startup() {
  const settings = JSON.parse(await fs.readFile(path.join(__dirname, '../data/settings.json'), 'utf-8'));
  const platforms = await setupPlatforms(settings);


  const buildModel = async (waitForRefresh?: boolean) => {
    const [ d4h, google, slack, caltopo ] = await Promise.all([
      platforms.d4h.afterRefresh(waitForRefresh),
      platforms.google.afterRefresh(waitForRefresh),
      platforms.slack.afterRefresh(waitForRefresh),
      platforms.caltopo.afterRefresh(waitForRefresh),
    ])

    const modelBuilder = new ModelBuilder(new D4HAgent(settings.platforms.D4H, d4h, () => logger), () => logger);
    modelBuilder.addAgent(new GoogleAgent(settings.platforms.Google, google, () => logger));
    modelBuilder.addAgent(new SlackAgent(settings.platforms.Slack, slack, () => logger));
    modelBuilder.addAgent(new CalTopoAgent({ ...settings.platforms.CalTopo, aliasEmails: settings.aliasEmails }, caltopo, () => logger));
    return modelBuilder;
  };

  const commands = new CommandRouter(settings.commands, buildModel, platforms, getLogger('commands'));
  await startBotSocket(commands);
  await startServer(buildModel, platforms.slack);
}

startup();