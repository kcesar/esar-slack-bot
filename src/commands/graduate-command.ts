import { Block, MessageAttachment } from "@slack/web-api";
import { asLookup, equalsInsensitive } from "../lib/util";
import getLogger from "../lib/logging";
import { TeamMember } from "../model/types";
import ModelBuilder from "../model/model-builder";
import { TrainingPlatform } from "../platforms/types";
import SlackPlatform, { SlackUser, SlashCommandLite } from "../platforms/slack-platform";
import TeamModelContainer from "../model/team-model";
import GooglePlatform, { GoogleUser } from "../platforms/google-platform";
import D4HPlatform from "../platforms/d4h-platform";
import { v2Member, v3Group, v3Member } from "../platforms/d4h-types";
import { startOfToday } from "date-fns";

interface Platforms {
  slack: SlackPlatform,
  d4h: D4HPlatform,
  google: GooglePlatform,
};

interface Settings {
  auth: string[];
}

const logger = getLogger('command-graduate');

/**
 * 
 * @param slack 
 * @param body 
 * @returns 
 */
export default async function doGraduateCommand(settings: Settings, buildModel: () => Promise<ModelBuilder>, platforms: Platforms, body: SlashCommandLite) {
  const { slack, d4h, google } = platforms;

  const im = (text: string) => slack.post(body.channel_id, text);

  const userEmail = slack.getAllUsers().find(u => u.id === body.user_id)?.profile?.email ?? '';
  logger.info(`CMD: "${body.text}" from ${body.user_id} ${userEmail}`);
  if (!settings.auth.includes(userEmail)) {
    await im("I'm not allowed to let you graduate " + body.text);
    return;
  }
  if (body.text.includes(' ') || body.text.includes('@')) {
    await im("Invalid arguments. Use `/graduate first.last`, which should match the trainee's email address");
    return;
  }
  const modelBuilder = await buildModel();
  const model = modelBuilder.buildModel();
  // Find trainee by Google email address...
  const traineeMatches = model.getAllMembers().filter(m => (m.platforms['Google'] as GoogleUser|undefined)?.primaryEmail?.toLowerCase().startsWith(body.text.toLowerCase() + '@'));
  if (traineeMatches.length !== 1) {
    await im("Can't find a trainee " + body.text);
    return;
  }
  const trainee = traineeMatches[0];

  const googleUser = trainee.platforms['Google'] as GoogleUser;
  
  if (googleUser.orgUnitPath !== '/Trainees') {
    await im(`${googleUser.primaryEmail} is not in the /Trainees Google OU. Aborting.`);
    return;
  }
  const d4hUser = trainee.platforms['D4H'] as v2Member;
  if (!d4hUser) {
    await im(`Can't find D4H user for ${googleUser.primaryEmail}`);
    return;
  }

  const esarD4HGroup = model.getAllGroups().find(f => f.title === 'ESAR')?.platforms['D4H'] as v3Group;
  const esarFieldD4HGroup = model.getAllGroups().find(f => f.title === 'ESAR Field')?.platforms['D4H'] as v3Group;
  const esarTraineesD4HGroup = model.getAllGroups().find(f => f.title === 'ESAR Trainee')?.platforms['D4H'] as v3Group;
  const basicTrainingQualification = d4h.getAllQualifications().find(q => q.title === 'ESAR Basic Training')?.id;

  if (!esarD4HGroup) {
    im(`Can't find "ESAR" D4H group`);
    return;
  }
  if (!esarFieldD4HGroup) {
    im(`Can't find "ESAR Field" D4H group`);
    return;
  }
  if (!esarTraineesD4HGroup) {
    im(`Can't find "ESAR Trainee" D4H group`);
    return;
  }
  if (!basicTrainingQualification) {
    im(`Can't find "ESAR Basic Training" qualification`);
    return;
  }

  try {
    // Award "ESAR Basic Training"
    const award = "ESAR Basic Training"
    const basicTrainingAward = (await d4h.getAwardsForMember(trainee)).find(a => a.qualification.title === award);
    if (!basicTrainingAward) {
      await d4h.addAwardForMember(trainee, award, new Date());
    }

    // Move from "ESAR Trainee" to "ESAR Field"
    await d4h.addToGroup(d4hUser.id, esarD4HGroup.id);
    await d4h.addToGroup(d4hUser.id, esarFieldD4HGroup.id);
    await d4h.removeFromGroup(d4hUser.id, esarTraineesD4HGroup.id);

    // D4H position field should include "ESAR TM"
    await d4h.updateMember(d4hUser.id, {
      position: d4hUser.position ? d4hUser.position.includes('ESAR') ? d4hUser.position : `${d4hUser.position}; ESAR TM` : 'ESAR TM'
    })

    await google.addToGroup(googleUser.primaryEmail, "members" + "@kcesar.org");
    await google.updateUser(googleUser.primaryEmail, { orgUnitPath: '/Members' });
    await im(`Graduated ${googleUser.primaryEmail} :partying_face:`);
  } catch (error) {
    await im(`:exclamation: ${error}`);
  }
}