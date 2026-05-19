import { Schema, model, Types } from 'mongoose'

interface IResource {
  title: string
  url: string
  type: string
}

export interface ISection {
  masterTopicId: Types.ObjectId
  name: string
  contentOverview: string
  isPublished: boolean
  orderIndex: number
  resourceList: IResource[]
  createdAt?: Date
  updatedAt?: Date
}

const sectionSchema = new Schema<ISection>(
  {
    masterTopicId: {
      type: Schema.Types.ObjectId,
      ref: 'MasterTopic',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    contentOverview: { type: String, default: '' },
    isPublished: { type: Boolean, default: false },
    orderIndex: { type: Number, default: 0 },
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

export const Section = model<ISection>('Section', sectionSchema)
