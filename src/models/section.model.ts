import { Schema, model, Types } from 'mongoose'

/**
 * Curated external learning resource attached to a section.
 * type is constrained to a small enum so the UI can render the right badge/icon.
 */
interface IResource {
  title: string
  url: string
  type: 'article' | 'video' | 'docs' | 'interactive'
  provider: string
  estimatedMinutes: number
}

export interface ISection {
  topicId: Types.ObjectId
  name: string
  slug: string
  contentOverview: string
  isPublished: boolean
  orderIndex: number
  resourceList: IResource[]
  createdAt?: Date
  updatedAt?: Date
}

const sectionSchema = new Schema<ISection>(
  {
    topicId: {
      type: Schema.Types.ObjectId,
      ref: 'MasterTopic',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    contentOverview: { type: String, default: '' },
    isPublished: { type: Boolean, default: false },
    orderIndex: { type: Number, default: 0 },
    resourceList: [
      {
        _id: false,
        title: { type: String, required: true },
        url: { type: String, required: true },
        type: {
          type: String,
          required: true,
          enum: ['article', 'video', 'docs', 'interactive'],
        },
        provider: { type: String, default: '' },
        estimatedMinutes: { type: Number, default: 0, min: 0 },
      },
    ],
  },
  { timestamps: true },
)

// Section slug must be unique within its parent topic.
sectionSchema.index({ topicId: 1, slug: 1 }, { unique: true })

export const Section = model<ISection>('Section', sectionSchema)
