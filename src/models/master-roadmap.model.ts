import { Schema, model } from 'mongoose'

export interface IMasterRoadmap {
  roleName: string
  description: string
  isPublished: boolean
  createdAt?: Date
  updatedAt?: Date
}

const masterRoadmapSchema = new Schema<IMasterRoadmap>(
  {
    roleName: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    isPublished: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
)

export const MasterRoadmap = model<IMasterRoadmap>('MasterRoadmap', masterRoadmapSchema)
