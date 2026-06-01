import { OnboardingQuestionnaire } from '../models/onboarding-questionnaire.model.js'
import { UserProfile } from '../models/user-profile.model.js'
import { User } from '../models/user.model.js'
import { ApiError } from '../utils/api-error.js'

export const getUser = async (userId: string) => {
  const user = await User.findById({ userId }).select('username email createdAt isActive').lean()
  if (!user) {
    throw new ApiError(404, 'User not found', 'USER_NOT_FOUND')
  }

  const onboardingStatus = await OnboardingQuestionnaire.findOne({ userId: userId })
    .select('completed')
    .lean()

  const userDetails = {
    userId: userId,
    email: user.email,
    username: user.username,
    createdAt: user.createdAt,
    isActive: user.isActive,
    onboardingStatus: onboardingStatus?.completed ?? false,
  }

  return userDetails
}

export const getProfile = async (userId: string) => {
  const userProfile = await UserProfile.findOne({ userId }).select('streak level updatedAt').lean()
  if (!userProfile) {
    throw new ApiError(404, 'User profile not found', 'USER_PROFILE_NOT_FOUND')
  }
  const userProfileDetails = {
    userId: userId,
    level: userProfile.level,
    streak: userProfile.streak,
    updatedAt: userProfile.updatedAt,
  }
  return userProfileDetails
}
