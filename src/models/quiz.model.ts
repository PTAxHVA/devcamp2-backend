import { Schema, model, Types } from 'mongoose'

export interface IQuiz {
  sectionId: Types.ObjectId
  minPassScore: number
  createdAt?: Date
  updatedAt?: Date
}

const quizSchema = new Schema<IQuiz>(
  {
    sectionId: {
      type: Schema.Types.ObjectId,
      ref: 'Section',
      required: true,
      unique: true,
    },
    minPassScore: { type: Number, default: 80, min: 0, max: 100 },
  },
  { timestamps: true },
)

export const Quiz = model<IQuiz>('Quiz', quizSchema)
