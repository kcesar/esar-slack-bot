import { type Express } from 'express';
import ModelBuilder from '../model/model-builder';
import { membershipReportTask } from './membership-report';
import SlackPlatform from '../platforms/slack-platform';

export function setupTasks(app: Express, buildModel: (wait: boolean) => Promise<ModelBuilder>, slack: SlackPlatform) {
  app.get('/task/membership-report', async (req, res) => {
    const to = req.query.to;
    if (!to || typeof to !== 'string') {
      res.status(400).json({ status: 'err', message: 'missing <to> parameter' });
      return;
    }

    const model = await buildModel(true);
    const result = await membershipReportTask(model);
    if (result.body && !req.query.noslack) {
        for (const target of to.split(';').map(f => f.trim())) {
          if (result.body.length > 5000) {
            await slack.uploadText(target, "Membership report", "membership-report.txt", result.body.replaceAll(':exclamation:', '!!'));
          } else {
            await slack.post(target, "Membership Report:\n" + result.body);
          }
          
        }
    }

    res.json({ status: 'ok', result: result.body });
  });
}