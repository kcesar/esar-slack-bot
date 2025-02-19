import { D4HClient } from "../lib/remote-services/d4h";
import WorkspaceClient from "../lib/remote-services/googleWorkspace";
import SlackClient, { SlashCommandLite } from "../lib/remote-services/slack";

import doWacsCommand from "./wacs-command";

export default class CommandRouter {
  private readonly handlers: Record<string, (body: SlashCommandLite) => Promise<void>> = {};

  constructor(slack: SlackClient, d4h: D4HClient, google: WorkspaceClient) {
    this.handlers['/wacs'] = doWacsCommand.bind(undefined, slack, d4h, google);
  }

  handle(body: SlashCommandLite): Promise<void> {
    const handler = this.handlers[body.command] ?? this.handleUnknown;
    return handler(body);
  }

  private handleUnknown(body: SlashCommandLite) {
    console.log('Unknown command', body);
    return Promise.resolve();
  }
}