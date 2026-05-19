import { Schema, model, Types } from 'mongoose'

export interface IPasswordResetToken {
  userId: Types.ObjectId
  tokenHash: string
  expiresAt: Date
  usedAt: Date | null
  createdAt?: Date
  updatedAt?: Date
}

const passwordResetTokenSchema = new Schema<IPasswordResetToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

// TTL: auto-delete documents after expiresAt.
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const PasswordResetToken = model<IPasswordResetToken>(
  'PasswordResetToken',
  passwordResetTokenSchema,
)
