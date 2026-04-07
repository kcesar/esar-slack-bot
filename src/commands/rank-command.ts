import getLogger from "../lib/logging";
import ModelBuilder from "../model/model-builder";
import SlackPlatform, { SlashCommandLite } from "../platforms/slack-platform";
import GooglePlatform, { GoogleUser } from "../platforms/google-platform";
import D4HPlatform from "../platforms/d4h-platform";
import { v3Group, v3Member } from "../platforms/d4h-types";

interface Platforms {
  slack: SlackPlatform,
  d4h: D4HPlatform,
  google: GooglePlatform,
};

interface Settings {
  auth: string[];
  notify: string[];
}

const logger = getLogger('command-promote-leader');

const UPPER_RANKS = [ 'TLT','TL', 'FLT', 'FL','OLT', 'OL'];
const D4H_QUALIFICATIONS: Record<string, string> = {
  TL: 'ESAR Team Leader',
  FL: 'ESAR Field Leader',
  OL: 'ESAR Operations Leader',
};
const CLASS_EMAILS = [ 'tlt' ];



const BODY_REGEX = new RegExp(`^(${UPPER_RANKS.join('|')}) ([a-z-.]+)$`);
/**
 * 
 * @param slack 
 * @param body 
 * @returns 
 */
export default async function doRankCommand(settings: Settings, buildModel: () => Promise<ModelBuilder>, platforms: Platforms, body: SlashCommandLite) {
  const { slack, d4h, google } = platforms;
  
  const im = (text: string) => slack.post(body.channel_id, text);

  const userEmail = slack.getAllUsers().find(u => u.id === body.user_id)?.profile?.email ?? '';
  logger.info(`CMD: "${body.text}" from ${body.user_id} ${userEmail}`);
  if (!settings.auth.includes(userEmail)) {
    await im("I'm not allowed to let you promote " + body.text);
    return;
  }

  const [ , newRank, alias, noop ] = body.text.match(BODY_REGEX) ?? [];
  if (!newRank || !alias) {
    await im("Command not in format /set-rank {rank} {first.last}");
  }
  console.log('rank arguments', newRank, alias);

  const modelBuilder = await buildModel();
  const model = modelBuilder.buildModel();
  // Find trainee by Google email address...
  const memberMatches = model.getAllMembers().filter(m => m.teamEmail?.toLowerCase().startsWith(alias.toLowerCase() + '@'));
  if (memberMatches.length !== 1) {
    await im("Can't find a member " + alias);
    return;
  }
  const member = memberMatches[0];

  const googleUser = member.platforms['Google'] as GoogleUser;
  
  const d4hUser = member.platforms['D4H'] as v3Member;
  if (!d4hUser) {
    await im(`Can't find D4H user for ${member.teamEmail}`);
    return;
  }

  const d4hRankGroups: Record<string, v3Group> = {};
  for (const r of UPPER_RANKS) {
    const groupName = `ESAR ${r}`;
    d4hRankGroups[r] = model.getAllGroups().find(g => g.title === groupName)?.platforms['D4H'] as v3Group;
    if (!d4hRankGroups[r]) {
      await im(`Can't find D4H group ${groupName}`);
      return;
    }
  }

  const qualificationName = D4H_QUALIFICATIONS[newRank];
  let d4hQualification = qualificationName ? d4h.getAllQualifications().find(q => q.title === qualificationName)?.id : undefined;
  if (qualificationName && !d4hQualification) {
    await im(`Can't find D4H qualification ${qualificationName}`);
    return;
  }

  try {
    // // Award "ESAR Basic Training"
    // const award = "ESAR Basic Training"
    // const basicTrainingAward = (await d4h.getAwardsForMember(trainee)).find(a => a.qualification.title === award);
    // if (!basicTrainingAward) {
    //   await d4h.addAwardForMember(trainee, award, new Date());
    // }

    // // Move from "ESAR Trainee" to "ESAR Field"
    // await d4h.addToGroup(d4hUser.id, esarD4HGroup.id);
    // await d4h.addToGroup(d4hUser.id, esarFieldD4HGroup.id);
    // await d4h.removeFromGroup(d4hUser.id, esarTraineesD4HGroup.id);

    // D4H position field should include new rank
    const existingPosition = d4hUser.position?.match(/ESAR ..T?/)?.[0];
    console.log('check position', d4hUser.position, existingPosition);
    if (!existingPosition) {
      await im('Existing D4H position is unrecognized: ' + d4hUser.position);
      return;
    }

    let work = [];

    await d4h.updateMember(d4hUser.id, {
      position: d4hUser.position?.replace(existingPosition, `ESAR ${newRank}`)
    })

    let targetGroup = `${newRank.toLowerCase()}${CLASS_EMAILS.includes(newRank) ? '-' + new Date().getFullYear() : 's'}@kcesar.org`;
    
    for (const r of UPPER_RANKS) {
      if (r === newRank) {
        continue;
      }
      const emailGroup = r.toLowerCase() + 's@kcesar.org';
      if (await google.removeFromGroup(googleUser.primaryEmail, emailGroup, { ignoreMissing: true })) {
        work.push('Removed from Google ' + emailGroup);
      };

      if (await d4h.removeFromGroup(d4hUser.id, d4hRankGroups[r].id)) {
        work.push('Removed from D4H ' + d4hRankGroups[r].title);
      }
    }
    if (await google.addToGroup(googleUser.primaryEmail, targetGroup, { ignoreExisting: true })) {
      work.push('Added to Google ' + targetGroup);
    }
    if (await d4h.addToGroup(d4hUser.id, d4hRankGroups[newRank].id)) {
      work.push('Added to D4H ' + d4hRankGroups[newRank].title);
    }

    await d4h.addAwardForMember(member, qualificationName, new Date());

    await im(`${member.name.preferredFull} is now a ${newRank} :partying_face:\n${work.join('\n')}`);
    for (const notify of settings.notify) {
      await slack.send(notify, `${userEmail} ran /set-rank command for ${googleUser.primaryEmail}`);
    }
  } catch (error) {
    await im(`:exclamation: ${error}`);
  }
}