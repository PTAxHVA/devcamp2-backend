import { Schema, model, Types } from 'mongoose'
import { EditAction } from '../types/enums.js'

export interface IRoadmapEditLog {
  userRoadmapId: Types.ObjectId
  userId: Types.ObjectId
  editType: EditAction
  topicId: Types.ObjectId
  aiFeedback: string
  createdAt?: Date
  updatedAt?: Date
}

const roadmapEditLogSchema = new Schema<IRoadmapEditLog>(
  {
    userRoadmapId: {
      type: Schema.Types.ObjectId,
      ref: 'UserRoadmap',
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    editType: { type: String, required: true, enum: Object.values(EditAction) },
    topicId: { type: Schema.Types.ObjectId, ref: 'MasterTopic', required: true },
    aiFeedback: { type: String, default: '' },
  },
  { timestamps: true },
)

export const RoadmapEditLog = model<IRoadmapEditLog>('RoadmapEditLog', roadmapEditLogSchema)
