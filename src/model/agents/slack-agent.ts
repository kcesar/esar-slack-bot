import { Logger } from "winston";
import SlackPlatform, { SlackChannelSetting, SlackSettings, SlackUser, UserAndChannels } from "../../platforms/slack-platform";
import { ModelAgent, TEMPLATE_MEMBER } from "../team-model";
import { TeamMember, CheckConcern, TeamGroup } from "../types";
import getLogger, { LogFactory } from "../../lib/logging";
import { getConcernList } from "./agent-utils";
import { equalsInsensitive } from "../../lib/util";

export default class SlackAgent implements ModelAgent {
  readonly name = 'Slack';
  private readonly slack: SlackPlatform;
  private readonly settings: SlackSettings;
  private readonly logger: Logger;

  constructor(settings:SlackSettings, slack: SlackPlatform, logFactory: LogFactory = getLogger) {
    this.settings = settings;
    this.slack = slack;
    this.logger = logFactory('slack-agent');
  }
  
  // populateGroups(groups: TeamGroup[]): void {
  //   const lookup = asLookup(this.settings.channels, c => c.slack);
  //   for (const channel of this.slack.getAllChannels()) {
  //     const setting = lookup[channel.name_normalized ?? ''];
  //     if (!setting) {
  //       continue;
  //     }
  //     const groupMatch = groups.find(g => equalsInsensitive(g.title, setting.groups));
  //     if (groupMatch) {
  //       groupMatch.platforms[this.name] = channel;
  //     }
  //   }
  // }

  populateMembers(members: TeamMember[]): void {
    const users = this.slack.getUsersAndChannels().filter(u => !u.is_bot && u.id !== 'USLACKBOT');
    const membersByEmail = {};
    for (const member of members) {
      for (const email of member.emails) {
        const lowerEmail = email.toLowerCase();
        membersByEmail[lowerEmail] = [ ...membersByEmail[lowerEmail] ?? [], member ];
      }
    }

    for (const user of users) {
      const existing = membersByEmail[user.profile?.email?.toLowerCase() ?? ''] ?? [];

      if (existing.length == 1) {
        existing[0].platforms[this.name] = user;
      } else {
        const member: TeamMember = {
          ...JSON.parse(JSON.stringify(TEMPLATE_MEMBER))
        };
        member.platforms[this.name] = user;
        members.push(member);
      }
    }
  }

  getMemberConcerns(member: TeamMember): CheckConcern[] {
    const [ concerns, add ] = getConcernList(this.name);
    const slackUser = member.platforms[this.name] as SlackUser|undefined;
    if (member.teamStatus.current) {
      if (!slackUser) {
        // don't mind users that aren't in Slack
      } else {
        if (!equalsInsensitive(slackUser.profile?.email, member.teamEmail)) {
          add(`Primary email ${slackUser.profile?.email} does not match primary team email ${member.teamEmail}`);
        }
      }
    } else if (member.teamStatus.trainee) {

    } else {
      if (slackUser && !slackUser?.deleted) {
        add(`Has an active Slack account "${slackUser?.real_name}" (${slackUser?.profile?.email})`);
      }
    }
    return concerns;
  }

  getMembershipConcerns(member: TeamMember, groups: TeamGroup[]): CheckConcern[] {
    const [ concerns, add ] = getConcernList(this.name);
    const slackUser = member.platforms[this.name] as UserAndChannels;
    if (!slackUser) {
      return concerns;
    }

    const settingsByChannelId: Record<string, SlackChannelSetting> = {};
    const settingsByGroupTitle: Record<string, SlackChannelSetting[]> = {};
    for (const setting of this.settings.channels.filter(f => f.sync)) {
      const channel = this.slack.getChannelByName(setting.slack);
      if (!channel) continue;

      settingsByChannelId[channel.id!] = setting;
      for (const group of setting.groups) {
        settingsByGroupTitle[group] = [ ...settingsByGroupTitle[group] ?? [], setting]; 
      }
    }

    const userExpectedInChannels: Record<string, true> = {};
    for (const group of member.groups) {
      for (const channelSetting of settingsByGroupTitle[group.title] ?? []) {
        userExpectedInChannels[channelSetting.slack] = true;
      }
    }

    for (const channelId of slackUser.channels) {
      const channel = this.slack.getChannel(channelId);
      
      if (channel?.is_private && !userExpectedInChannels[channel?.name_normalized ?? '']) {
        add('is in private channel #' + channel.name);
      }
      delete userExpectedInChannels[channel?.name_normalized ?? ''];
    }

    for (const extraExpectations of Object.keys(userExpectedInChannels)) {
      add('is not in channel #' + extraExpectations)
    }

    /*
    const slackUserChannels = asLookup(slackUser.channels, c => c);

    const slackGroups = groups.map(f => f.platforms[this.name] as Channel);
    for (const group of member.groups) {
      const channel = group.platforms[this.name] as Channel;
      if (!channel) continue;

      const isInChannel = !!slackUserChannels[channel.id ?? 'no-match'];
      delete slackUserChannels[channel.id ?? 'no-match'];

      if (channel.is_private && !isInChannel) {
        add(`Is in group "${group.title}", but Slack user "${slackUser.real_name}" is not in channel #${channel.name}`);
      }
    }

    const remainingChannels = Object.keys(slackUserChannels);
    console.log(member.name.preferredFull, remainingChannels);
    for (const group of Object.keys(slackUserChannels).map(id => groups.find(g => g.platforms[this.name]?.id == id))) {
      add(`Is not in group "${group?.title}", but Slack user "${slackUser.real_name}" is in channel #${group?.platforms[this.name].name}`);
    }
*/
    //for (const group of groups.map(f => f.platforms[this.name]))
    // const expectedMemberships: Record<string, { slack: string, group: string }> = {};
    // for (const setting of this.settings.channels) {
    //   const channel = this.slack.getChannelByName(setting.slack);
    //   if (channel?.id) {
    //     expectedMemberships[channel.id] = setting;
    //   }
    // }

    // for (const channelId of slackUser.channels) {
    //   const setting = expectedMemberships[channelId];
    //   if (!setting) {
    //     continue;
    //   }

    //   const isInGroup = member.groups.some(f => f.title === setting.group);
    //   console.log(member.name.preferredFull, setting, isInGroup);
    //   if (isInGroup) {
    //     // user is in channel and is in group
    //   } else {
    //     add(`User ${slackUser.real_name} is in channel #${setting.slack}, but not group ${setting.group}`);
    //   }
    // }
    // // for (const group of member.groups) {
    // //   const settingsForGroup = this.settings.channels.filter(c => c.group === group.title);
    // //   for (const setting of settingsForGroup) {
    // //     const channel = this.slack.getChannelByName(setting.slack);
    // //     if (!channel) {
    // //       continue;
    // //     }

    // //     if (!slackUser.channels.includes(channel.id ?? 'none')) {
    // //       add(`Slack user ${slackUser.real_name} should be in channel #${channel.name}`);
    // //     }
    // //   }
    // // }

    // // for (const setting of this.settings.channels) {
    // //   const channel = this.slack.getChannelByName(setting.slack);
    // //   if (channel && slackUser.channels.includes(channel.id ?? '') && !)
    // // }
    // // for (const group of member.groups) {
    // //   // const setting = this.settings.groups[group.title];
    // //   // if (setting) {
    // //   //   console.log('have setting for ')
    // //   // }
    // // }

    // // for (const channel of slackUser.)
    // // for (const [ channelName, channelSetting ] of Object.entries(this.settings.channels)) {
    // //   const channel = this.slack.getChannel(channelName);
    // // }

    return concerns;
  }
}
