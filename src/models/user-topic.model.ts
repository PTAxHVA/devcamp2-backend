import { Schema, model, Types } from 'mongoose'

export enum TopicStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

export interface IUserTopic {
  userRoadmapId: Types.ObjectId
  masterTopicId: Types.ObjectId
  customName: string | null
  status: TopicStatus
  orderIndex: number
  createdAt?: Date
  updatedAt?: Date
}

const userTopicSchema = new Schema<IUserTopic>(
  {
    userRoadmapId: {
      type: Schema.Types.ObjectId,
      ref: 'UserRoadmap',
      required: true,
      index: true,
    },
    masterTopicId: {
      type: Schema.Types.ObjectId,
      ref: 'MasterTopic',
      required: true,
    },
    customName: { type: String, default: null },
    status: {
      type: String,
      enum: Object.values(TopicStatus),
      default: TopicStatus.NOT_STARTED,
    },
    orderIndex: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export const UserTopic = model<IUserTopic>('UserTopic', userTopicSchema)
