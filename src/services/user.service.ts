import { randomBytes } from 'node:crypto'
import { OnboardingQuestionnaire } from '../models/onboarding-questionnaire.model.js'
import { UserProfile } from '../models/user-profile.model.js'
import { User } from '../models/user.model.js'
import { ApiError } from '../utils/api-error.js'
import {
  UpdateProfileSchema,
  UpdateAccountCredentialsSchema,
  DeactivateAccountSchema,
  UpdatePassportSchema,
} from '../schemas/profile.schema.js'
import { startSession } from 'mongoose'
import { hashPassword, comparePassword } from '../utils/password.js'
import { calculateCurrentStreak } from '../utils/streak.util.js'
import { env } from '../config/env.js'

export const getUser = async (userId: string) => {
  const user = await User.findById(userId).select('username email createdAt isActive').lean()
  if (!user) {
    throw new ApiError(404, 'User not found', 'USER_NOT_FOUND')
  }

  const [onboardingStatus, profile] = await Promise.all([
    OnboardingQuestionnaire.findOne({ userId: userId }).select('completed').lean(),
    UserProfile.findOne({ userId: userId }).select('avatarUrl').lean(),
  ])

  const userDetails = {
    userId: userId,
    email: user.email,
    username: user.username,
    createdAt: user.createdAt,
    isActive: user.isActive,
    onboardingStatus: onboardingStatus?.completed ?? false,
    avatarUrl: profile?.avatarUrl ?? null,
  }

  return userDetails
}

export const getProfile = async (userId: string) => {
  const user = await User.findById(userId).select('username').lean()
  const userProfile = await UserProfile.findOne({ userId })
    .select('streak level updatedAt lastActivityDate avatarUrl')
    .lean()

  if (!userProfile || !user) {
    throw new ApiError(404, 'User profile not found', 'USER_PROFILE_NOT_FOUND')
  }

  const currentStreak = calculateCurrentStreak(userProfile.streak, userProfile.lastActivityDate)

  return {
    userId,
    username: user.username,
    level: userProfile.level,
    streak: currentStreak,
    avatarUrl: userProfile.avatarUrl ?? null,
    updatedAt: userProfile.updatedAt,
  }
}

export const updateProfile = async (input: UpdateProfileSchema, userId: string) => {
  const session = await startSession()
  session.startTransaction()
  try {
    const { username, level, avatarUrl } = input
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
      {
        $set: {
          level: level,
          updatedAt: Date.now(),
          // Only touch avatar when the caller sent the field. `null` clears it
          // (mongoose stores the null); `undefined` is stripped, leaving it as-is.
          ...(avatarUrl !== undefined ? { avatarUrl } : {}),
        },
      },
      { new: true, runValidators: true, session },
    )
      .select('level streak updatedAt lastActivityDate avatarUrl')
      .lean()

    if (!userProfile) {
      throw new ApiError(404, 'User profile not found', 'USER_PROFILE_NOT_FOUND')
    }

    await session.commitTransaction()
    session.endSession()

    const currentStreak = calculateCurrentStreak(userProfile.streak, userProfile.lastActivityDate)

    return {
      userId,
      username: user.username,
      level: userProfile.level,
      streak: currentStreak,
      avatarUrl: userProfile.avatarUrl ?? null,
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

    const updatePayload: { updatedAt: number; email?: string; passwordHash?: string } = {
      updatedAt: Date.now(),
    }
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

const buildPassportSettings = (profile: { shareToken?: string; isPublic?: boolean }) => {
  const shareToken = profile.shareToken ?? null
  return {
    shareToken,
    isPublic: profile.isPublic ?? false,
    publicUrl: shareToken ? `${env.CLIENT_URL}/p/${shareToken}` : null,
  }
}

export const getPassportSettings = async (userId: string) => {
  const profile = await UserProfile.findOne({ userId }).select('shareToken isPublic').lean()
  if (!profile) {
    throw new ApiError(404, 'User profile not found', 'USER_PROFILE_NOT_FOUND')
  }

  return buildPassportSettings(profile)
}

export const updatePassportSettings = async (input: UpdatePassportSchema, userId: string) => {
  const profile = await UserProfile.findOne({ userId }).select('shareToken isPublic').lean()
  if (!profile) {
    throw new ApiError(404, 'User profile not found', 'USER_PROFILE_NOT_FOUND')
  }

  // Token is minted on first enable and on explicit regenerate. Disabling keeps
  // the token so re-enabling restores the SAME public link (revoke = regenerate).
  const shouldMintToken = input.isPublic && (!profile.shareToken || input.regenerate === true)
  const update: { isPublic: boolean; shareToken?: string } = { isPublic: input.isPublic }
  if (shouldMintToken) update.shareToken = randomBytes(16).toString('hex')

  const updatedProfile = await UserProfile.findOneAndUpdate(
    { userId },
    { $set: update },
    { new: true, runValidators: true },
  )
    .select('shareToken isPublic')
    .lean()
  if (!updatedProfile) {
    throw new ApiError(404, 'User profile not found', 'USER_PROFILE_NOT_FOUND')
  }

  return buildPassportSettings(updatedProfile)
}
