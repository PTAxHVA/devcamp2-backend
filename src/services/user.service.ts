import { OnboardingQuestionnaire } from '../models/onboarding-questionnaire.model.js'
import { UserProfile } from '../models/user-profile.model.js'
import { User } from '../models/user.model.js'
import { ApiError } from '../utils/api-error.js'
import {
  UpdateProfileSchema,
  UpdateAccountCredentialsSchema,
  DeactivateAccountSchema,
} from '../schemas/profile.schema.js'
import { startSession } from 'mongoose'
import { hashPassword, comparePassword } from '../utils/password.js'

export const getUser = async (userId: string) => {
  const user = await User.findById(userId).select('username email createdAt isActive').lean()
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
  const user = await User.findById(userId).select('username').lean()
  const userProfile = await UserProfile.findOne({ userId }).select('streak level updatedAt').lean()

  if (!userProfile || !user) {
    throw new ApiError(404, 'User profile not found', 'USER_PROFILE_NOT_FOUND')
  }

  return {
    userId,
    username: user.username,
    level: userProfile.level,
    streak: userProfile.streak,
    updatedAt: userProfile.updatedAt,
  }
}

export const updateProfile = async (input: UpdateProfileSchema, userId: string) => {
  const session = await startSession()
  session.startTransaction()
  try {
    const { username, level } = input
    const user = await User.findOneAndUpdate(
      { _id: userId },
      { $set: { username: username, updatedAt: Date.now() } },
      { new: true, runValidators: true, session },
    )
      .select('username')
      .lean()
    if (!user) {
      throw new ApiError(404, 'User not found', 'USER_NOT_FOUND')
    }

    const userProfile = await UserProfile.findOneAndUpdate(
      { userId: userId },
      { $set: { level: level, updatedAt: Date.now() } },
      { new: true, runValidators: true, session },
    )
      .select('level streak updatedAt')
      .lean()

    if (!userProfile) {
      throw new ApiError(404, 'User profile not found', 'USER_PROFILE_NOT_FOUND')
    }

    await session.commitTransaction()
    session.endSession()

    return {
      userId,
      username: user.username,
      level: userProfile.level,
      streak: userProfile.streak,
      updatedAt: userProfile.updatedAt,
    }
  } catch (error) {
    await session.abortTransaction()
    session.endSession()
    throw error
  }
}

export const updateAccountCredentials = async (
  input: UpdateAccountCredentialsSchema,
  userId: string,
) => {
  const session = await startSession()
  session.startTransaction()
  try {
    const { email, currentPassword, password } = input
    const userCredentials = await User.findById(userId).select('+passwordHash').lean()
    if (!userCredentials) {
      throw new ApiError(404, 'User not found', 'USER_NOT_FOUND')
    }

    const isCurrentPasswordCorrect = await comparePassword(
      currentPassword,
      userCredentials.passwordHash,
    )
    if (!isCurrentPasswordCorrect) {
      throw new ApiError(401, 'Incorrect current password', 'INVALID_CREDENTIALS')
    }

    const normalizeEmail = email ? email.toLowerCase().trim() : undefined

    if (normalizeEmail) {
      const checkEmailExists = await User.exists({ email: normalizeEmail, _id: { $ne: userId } })
      if (checkEmailExists) {
        throw new ApiError(400, 'Email already exists', 'EMAIL_ALREADY_EXISTS')
      }
    }

    let isPasswordSame = false
    if (password) {
      isPasswordSame = await comparePassword(password, userCredentials.passwordHash)
    }

    if (userCredentials.email === normalizeEmail && isPasswordSame) {
      throw new ApiError(400, 'User credentials are same as input', 'USER_CREDENTIALS_ARE_SAME')
    }

    if (!normalizeEmail && !password) {
      throw new ApiError(400, 'Nothing to update', 'NOTHING_TO_UPDATE')
    }

    const hashedPassword = password ? await hashPassword(password) : userCredentials.passwordHash

    const updatePayload: any = { updatedAt: Date.now() }
    if (normalizeEmail) updatePayload.email = normalizeEmail
    if (password) updatePayload.passwordHash = hashedPassword

    const updatedUser = await User.findOneAndUpdate(
      { _id: userId },
      { $set: updatePayload },
      { new: true, runValidators: true, session },
    )
      .select('username email')
      .lean()

    if (!updatedUser) {
      throw new ApiError(404, 'User not found during update', 'USER_NOT_FOUND')
    }

    await session.commitTransaction()
    session.endSession()

    return {
      userId: userId,
      username: updatedUser.username,
      email: updatedUser.email,
    }
  } catch (error) {
    await session.abortTransaction()
    session.endSession()
    throw error
  }
}

export const deactivateAccount = async (userId: string, input: DeactivateAccountSchema) => {
  const user = await User.findById(userId).select('+passwordHash isActive').lean()
  if (!user) {
    throw new ApiError(404, 'User not found', 'USER_NOT_FOUND')
  }

  if (user.isActive === false) {
    throw new ApiError(400, 'Account is already deactivated', 'ACCOUNT_ALREADY_DEACTIVATED')
  }

  const isCurrentPasswordCorrect = await comparePassword(input.currentPassword, user.passwordHash)
  if (!isCurrentPasswordCorrect) {
    throw new ApiError(401, 'Incorrect current password', 'INVALID_CREDENTIALS')
  }

  const deactivateAccount = await User.findOneAndUpdate(
    { _id: userId, isActive: true },
    { $set: { isActive: false } },
    { new: true, runValidators: true },
  )
  if (!deactivateAccount) {
    throw new ApiError(
      400,
      'Account is already deactivated or user not found',
      'ACCOUNT_ALREADY_DEACTIVATED',
    )
  }

  const deactivateAccountDetails = {
    status: 'success',
    message: 'Account deactivated successfully',
  }

  return deactivateAccountDetails
}
