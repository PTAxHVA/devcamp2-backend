import { Schema, model, Types } from 'mongoose'
import { SkillLevel } from '../types/enums.js'

export interface IUserProfile {
  userId: Types.ObjectId
  level: SkillLevel
  streak: number
  lastActivityDate: Date | null
  longestStreak: number
  // Verified Skill Passport (public share page). No default on shareToken: the
  // field must stay ABSENT until the user first enables sharing, so the sparse
  // unique index below never sees two null values. Docs created before this
  // field existed simply read as "passport never enabled".
  shareToken?: string
  isPublic?: boolean
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
    shareToken: { type: String },
    isPublic: { type: Boolean, default: false },
  },
  { timestamps: true },
)

// One passport link per profile; sparse so the many profiles WITHOUT a token
// (field absent) don't collide on uniqueness.
userProfileSchema.index({ shareToken: 1 }, { unique: true, sparse: true })

export const UserProfile = model<IUserProfile>('UserProfile', userProfileSchema)
