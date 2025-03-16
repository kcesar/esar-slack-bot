import { Logger } from "winston";
import SlackPlatform, { SlashCommandLite } from "../platforms/slack-platform";
import ModelBuilder from "../model/model-builder";
import { TrainingPlatform } from "../platforms/types";
import doWacsCommand from "./wacs-command";

export default class CommandRouter {
  private readonly handlers: Record<string, (body: SlashCommandLite) => Promise<void>> = {};
  private readonly logger: Logger;

  constructor(buildModel: () => Promise<ModelBuilder>, training: TrainingPlatform, slack: SlackPlatform, logger: Logger) {
    this.handlers['/wacs'] = doWacsCommand.bind(undefined, buildModel, training, slack);
    this.logger = logger;
  }

  handle(body: SlashCommandLite): Promise<void> {
    this.logger.info('Handling command', { body });
    const handler = this.handlers[body.command] ?? this.handleUnknown;
    return handler(body);
  }

  private handleUnknown(body: SlashCommandLite) {
    this.logger.warn('Unknown command', body);
    return Promise.resolve();
  }
}