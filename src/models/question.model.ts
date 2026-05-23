import { Schema, model, Types } from 'mongoose'
import { QuestionType } from '../types/enums.js'

export interface IQuestion {
  quizId: Types.ObjectId
  type: QuestionType
  content: string
  orderIndex: number
  createdAt?: Date
  updatedAt?: Date
}

const questionSchema = new Schema<IQuestion>(
  {
    quizId: { type: Schema.Types.ObjectId, ref: 'Quiz', required: true, index: true },
    type: { type: String, required: true, enum: Object.values(QuestionType) },
    content: { type: String, required: true },
    orderIndex: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export const Question = model<IQuestion>('Question', questionSchema)
