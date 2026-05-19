import { Schema, model, Types } from 'mongoose'

export interface IQuestionOption {
  questionId: Types.ObjectId
  content: string
  isCorrect: boolean
  orderIndex: number
  createdAt?: Date
  updatedAt?: Date
}

const questionOptionSchema = new Schema<IQuestionOption>(
  {
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true, index: true },
    content: { type: String, required: true },
    isCorrect: { type: Boolean, required: true },
    orderIndex: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export const QuestionOption = model<IQuestionOption>('QuestionOption', questionOptionSchema)
