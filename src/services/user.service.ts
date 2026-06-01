import { OnboardingQuestionnaire } from '../models/onboarding-questionnaire.model.js'
import { UserProfile } from '../models/user-profile.model.js'
import { User } from '../models/user.model.js'
import { ApiError } from '../utils/api-error.js'
import { UpdateProfileSchema, UpdateAccountCredentialsSchema } from '../schemas/profile-schema.js'
import { startSession } from 'mongoose'
import { hashPassword, comparePassword } from '../utils/password.js'

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

export const updateAccountCredentials = async (input: UpdateAccountCredentialsSchema) => {
  const session = await startSession()
  session.startTransaction()
  try {
    const { userId, email, password } = input
    const userCredentials = await User.findById({ userId }).select('email passwordHash').lean()
    if (!userCredentials) {
      throw new ApiError(404, 'User not found', 'USER_NOT_FOUND')
    }
    let isPasswordSame: boolean = false
    if (password) {
      isPasswordSame = await comparePassword(password, userCredentials.passwordHash)
    }
    if (userCredentials.email === email || isPasswordSame) {
      throw new ApiError(400, 'User credentials are same as input', 'USER_CREDENTIALS_ARE_SAME')
    }

    const hashedPassword = password ? await hashPassword(password) : userCredentials.passwordHash

    const updatedUser = await User.findOneAndUpdate(
      { userId: userId },
      { $set: { email: email, passwordHash: hashedPassword } },
      { new: true, runValidators: true, session },
    )
      .select('username email updatedAt')
      .lean()

    await session.commitTransaction()
    session.endSession()

    return updatedUser
  } catch (error) {
    await session.abortTransaction()
    session.endSession()
    throw error
  }
}
