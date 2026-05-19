import { Schema, model, Types } from 'mongoose'

export interface IMasterBranch {
  masterRoadmapId: Types.ObjectId
  name: string
  description: string
  selectionGroup: string | null
  isMutuallyExclusive: boolean
  isMandatory: boolean
  orderIndex: number
  createdAt?: Date
  updatedAt?: Date
}

const masterBranchSchema = new Schema<IMasterBranch>(
  {
    masterRoadmapId: {
      type: Schema.Types.ObjectId,
      ref: 'MasterRoadmap',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    selectionGroup: { type: String, default: null },
    isMutuallyExclusive: { type: Boolean, default: false },
    isMandatory: { type: Boolean, default: false },
    orderIndex: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export const MasterBranch = model<IMasterBranch>('MasterBranch', masterBranchSchema)
