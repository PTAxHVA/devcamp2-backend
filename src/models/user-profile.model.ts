import { Schema, model, Types } from 'mongoose'
import { SkillLevel } from '../types/enums.js'

export interface IUserProfile {
  userId: Types.ObjectId
  level: SkillLevel
  streak: number
  lastActivityDate: Date | null
  longestStreak: number
  createdAt?: Date
  updatedAt?: Date
}

const userProfileSchema = new Schema<IUserProfile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    level: { type: String, enum: Object.values(SkillLevel), default: SkillLevel.BEGINNER },
    streak: { type: Number, default: 0 },
    lastActivityDate: { type: Date, default: null },
    longestStreak: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export const UserProfile = model<IUserProfile>('UserProfile', userProfileSchema)
