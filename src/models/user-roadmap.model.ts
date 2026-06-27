import { Schema, model, Types } from 'mongoose'
import { RoadmapSource } from '../types/enums.js'

export interface IUserRoadmap {
  userId: Types.ObjectId
  roadmapId: Types.ObjectId
  sourceType: RoadmapSource
  isActive: boolean
  createdAt?: Date
  updatedAt?: Date
}

const userRoadmapSchema = new Schema<IUserRoadmap>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    roadmapId: {
      type: Schema.Types.ObjectId,
      ref: 'MasterRoadmap',
      required: true,
    },
    sourceType: { type: String, required: true, enum: Object.values(RoadmapSource) },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
)

// A user can have at most ONE active roadmap per role (master roadmap). This is a
// DB-level guard against enrolling the same role twice (incl. concurrent requests);
// soft-deleted (isActive:false) roadmaps are excluded, so re-enrolling later is fine.
userRoadmapSchema.index(
  { userId: 1, roadmapId: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
)

export const UserRoadmap = model<IUserRoadmap>('UserRoadmap', userRoadmapSchema)
