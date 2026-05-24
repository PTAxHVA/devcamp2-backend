import { Schema, model, Types } from 'mongoose'

/**
 * Junction table linking MasterTopic ↔ MasterBranch (many-to-many).
 *
 * Scenario B: MasterTopic is a LIBRARY entity (no direct branch FK).
 * Topics are reused across branches/roadmaps via this junction — Git, JS Fundamentals,
 * TypeScript, etc. live as ONE MasterTopic doc but appear in multiple branches
 * (Frontend roadmap + Backend roadmap) with potentially different order.
 */
export interface IBranchTopic {
  branchId: Types.ObjectId
  topicId: Types.ObjectId
  orderIndex: number
  createdAt?: Date
  updatedAt?: Date
}

const branchTopicSchema = new Schema<IBranchTopic>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'MasterBranch',
      required: true,
      index: true,
    },
    topicId: {
      type: Schema.Types.ObjectId,
      ref: 'MasterTopic',
      required: true,
      index: true,
    },
    orderIndex: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
)

// Each (branch, topic) link exists at most once.
branchTopicSchema.index({ branchId: 1, topicId: 1 }, { unique: true })

// Fast retrieval of ordered topics within a branch (for roadmap rendering).
branchTopicSchema.index({ branchId: 1, orderIndex: 1 })

export const BranchTopic = model<IBranchTopic>('BranchTopic', branchTopicSchema)
