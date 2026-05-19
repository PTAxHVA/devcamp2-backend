import { Schema, model, Types } from 'mongoose'

export enum RoadmapSource {
  SUGGESTED = 'SUGGESTED',
  CUSTOMIZED = 'CUSTOMIZED',
}

export interface IUserRoadmap {
  userId: Types.ObjectId
  masterRoadmapId: Types.ObjectId
  sourceType: RoadmapSource
  isActive: boolean
  createdAt?: Date
  updatedAt?: Date
}

const userRoadmapSchema = new Schema<IUserRoadmap>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    masterRoadmapId: {
      type: Schema.Types.ObjectId,
      ref: 'MasterRoadmap',
      required: true,
    },
    sourceType: { type: String, required: true, enum: Object.values(RoadmapSource) },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
)

// At most 1 active roadmap per user.
userRoadmapSchema.index(
  { userId: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
)

export const UserRoadmap = model<IUserRoadmap>('UserRoadmap', userRoadmapSchema)
