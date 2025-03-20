import { Logger } from "winston";
import SlackPlatform, { SlashCommandLite } from "../platforms/slack-platform";
import ModelBuilder from "../model/model-builder";
import { TrainingPlatform } from "../platforms/types";
import doWacsCommand from "./wacs-command";
import doGraduateCommand from './graduate-command';
import GooglePlatform from "../platforms/google-platform";

export default class CommandRouter {
  private readonly settings: Record<string, unknown>;
  private readonly handlers: Record<string, (body: SlashCommandLite) => Promise<void>> = {};
  private readonly logger: Logger;

  constructor(settings: Record<string,unknown>|undefined, buildModel: () => Promise<ModelBuilder>, platforms: unknown, logger: Logger) {
    this.settings = settings ?? {};
    this.handlers['/wacs'] = doWacsCommand.bind(undefined, buildModel, platforms);
    this.handlers['/graduate'] = doGraduateCommand.bind(undefined, this.settings['graduate'], buildModel, platforms);
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