import { OnboardingQuestionnaire } from '../models/onboarding-questionnaire.model.js'
import { UserProfile } from '../models/user-profile.model.js'
import { User } from '../models/user.model.js'
import { ApiError } from '../utils/api-error.js'
import { UpdateProfileSchema } from '../schemas/profile-schema.js'
import { startSession } from 'mongoose'

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

export const updateProfile = async (input: UpdateProfileSchema) => {
  const session = await startSession()
  session.startTransaction()
  try {
    const { userId, username, level } = input
    const userProfile = await UserProfile.findOneAndUpdate(
      { userId: userId },
      { $set: { username: username, level: level } },
      { new: true, runValidators: true, session },
    )
    if (!userProfile) {
      throw new ApiError(404, 'User profile not found', 'USER_PROFILE_NOT_FOUND')
    }

    await session.commitTransaction()
    session.endSession()

    return userProfile
  } catch (error) {
    await session.abortTransaction()
    session.endSession()
    throw error
  }
}
