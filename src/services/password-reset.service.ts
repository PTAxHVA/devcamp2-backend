import { RequestPasswordResetInput, ResetPasswordInput } from '../schemas/password-reset.schema.js'
import { sendPasswordResetEmail } from './email.service.js'
import { rawResetToken, hashedResetToken } from '../utils/crypto-hash.js'
import { User } from '../models/user.model.js'
import { PasswordResetToken } from '../models/password-reset-token.model.js'
import mongoose from 'mongoose'
import { ApiError } from '../utils/api-error.js'
import { hashPassword } from '../utils/password.js'
import { logger } from '../config/logger.js'

export const requestPasswordReset = async (input: RequestPasswordResetInput) => {
  const { email } = input
  const user = await User.findOne({ email })
  if (!user) {
    return { message: 'If the email exists, a reset link has been sent to it.' }
  }
  const token = rawResetToken()
  const hashedToken = hashedResetToken(token)
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24) // 24 hours from now
  const resetToken = await PasswordResetToken.create({
    userId: user._id,
    tokenHash: hashedToken,
    expiresAt,
  })
  try {
    await sendPasswordResetEmail(email, token)
  } catch (err) {
    await PasswordResetToken.findByIdAndDelete(resetToken._id)
    logger.error({ error: err }, 'Failed to send password reset email')
  }
  return { message: 'If the email exists, a reset link has been sent to it.' }
}

export const resetPassword = async (input: ResetPasswordInput) => {
  const session = await mongoose.startSession()
  session.startTransaction()
  try {
    const { token, newPassword } = input
    const hashedToken = hashedResetToken(token)
    const passwordResetToken = await PasswordResetToken.findOne({
      tokenHash: hashedToken,
      expiresAt: { $gt: new Date() },
      usedAt: null,
    }).session(session)

    if (!passwordResetToken) {
      throw new ApiError(400, 'Invalid or expired reset token.', 'INVALID_RESET_TOKEN')
    }
    const user = await User.findById(passwordResetToken.userId).session(session)
    if (!user) {
      throw new ApiError(400, 'Invalid or expired reset token.', 'INVALID_RESET_TOKEN')
    }
    user.passwordHash = await hashPassword(newPassword)
    await user.save()
    passwordResetToken.usedAt = new Date()

    await passwordResetToken.save()
    await session.commitTransaction()

    return { message: 'Password reset successfully.' }
  } catch (err) {
    await session.abortTransaction()
    throw err
  } finally {
    await session.endSession()
  }
}
