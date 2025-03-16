import { MemberTrainingAward, TeamMember } from "../model/types";

export interface TrainingPlatform {
  getAwardsForMember(member: TeamMember): Promise<MemberTrainingAward[]>;
}