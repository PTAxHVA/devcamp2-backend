import { Schema, model, Types } from 'mongoose'

/**
 * Prerequisite dependencies of a topic.
 * Denormalized on the Topic doc for fast reads (vs a separate junction).
 * - requiredTopicIds: must complete these topics first
 * - requiredBranchIds: must select these branches in the user's roadmap first
 */
interface IDependsOn {
  requiredTopicIds: Types.ObjectId[]
  requiredBranchIds: Types.ObjectId[]
}

/**
 * MasterTopic — LIBRARY entity (Scenario B).
 *
 * Topics are NOT scoped to a branch. They live independently and are linked
 * into branches via the BranchTopic junction. This lets shared topics
 * (Git, JavaScript Fundamentals, TypeScript, etc.) be defined ONCE and reused
 * across the Frontend and Backend roadmaps.
 *
 * Per-branch context (such as order in that branch) lives on BranchTopic,
 * NOT here.
 */
export interface IMasterTopic {
  name: string
  slug: string
  description: string
  descriptionShort: string
  estimatedHours: number
  iconUrl: string
  isPublished: boolean
  dependsOn: IDependsOn
  createdAt?: Date
  updatedAt?: Date
}

const masterTopicSchema = new Schema<IMasterTopic>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    description: { type: String, default: '' },
    descriptionShort: { type: String, default: '' },
    estimatedHours: { type: Number, default: 0, min: 0 },
    iconUrl: { type: String, default: '' },
    isPublished: { type: Boolean, default: false, index: true },
    dependsOn: {
      requiredTopicIds: [{ type: Schema.Types.ObjectId, ref: 'MasterTopic' }],
      requiredBranchIds: [{ type: Schema.Types.ObjectId, ref: 'MasterBranch' }],
    },
  },
  { timestamps: true },
)

export const MasterTopic = model<IMasterTopic>('MasterTopic', masterTopicSchema)
