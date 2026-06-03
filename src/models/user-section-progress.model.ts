import { Schema, model, Types } from 'mongoose'

export interface IUserSectionProgress {
  userTopicId: Types.ObjectId
  sectionId: Types.ObjectId
  isCompleted: boolean
  startedAt: Date
  completedAt: Date | null
  createdAt?: Date
  updatedAt?: Date
}

const userSectionProgressSchema = new Schema<IUserSectionProgress>(
  {
    userTopicId: { type: Schema.Types.ObjectId, ref: 'UserTopic', required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
    isCompleted: { type: Boolean, default: false },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

// index for fetching and sorting user's section progress
userSectionProgressSchema.index({ userTopicId: 1, sectionId: 1 }, { unique: true })

export const UserSectionProgress = model<IUserSectionProgress>(
  'UserSectionProgress',
  userSectionProgressSchema,
)
