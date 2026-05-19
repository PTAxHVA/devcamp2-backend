import { Schema, model, Types } from 'mongoose'

interface IResource {
  title: string
  url: string
  type: string
}

interface IDependsOn {
  requiredTopicIds: Types.ObjectId[]
  requiredBranchIds: Types.ObjectId[]
}

export interface IMasterTopic {
  masterBranchId: Types.ObjectId
  name: string
  description: string
  isPublished: boolean
  orderIndex: number
  dependsOn: IDependsOn
  resourceList: IResource[]
  createdAt?: Date
  updatedAt?: Date
}

const masterTopicSchema = new Schema<IMasterTopic>(
  {
    masterBranchId: {
      type: Schema.Types.ObjectId,
      ref: 'MasterBranch',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    isPublished: { type: Boolean, default: false, index: true },
    orderIndex: { type: Number, default: 0 },
    dependsOn: {
      requiredTopicIds: [{ type: Schema.Types.ObjectId, ref: 'MasterTopic' }],
      requiredBranchIds: [{ type: Schema.Types.ObjectId, ref: 'MasterBranch' }],
    },
    resourceList: [
      {
        _id: false,
        title: { type: String, required: true },
        url: { type: String, required: true },
        type: { type: String, required: true },
      },
    ],
  },
  { timestamps: true },
)

export const MasterTopic = model<IMasterTopic>('MasterTopic', masterTopicSchema)
