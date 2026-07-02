import { Schema, model, Types } from 'mongoose'
import { QuestionType } from '../types/enums.js'

export interface IQuestion {
  quizId: Types.ObjectId
  type: QuestionType
  content: string
  /**
   * - MULTIPLE_CHOICE: the correct option letter ('A' | 'B' | 'C' | 'D').
   *   QuestionOption.isCorrect remains the source of truth; this is a cache.
   * - FILL_IN_BLANK: the canonical answer text (e.g. 'head').
   */
  correctAnswer: string
  /**
   * FILL_IN_BLANK only: additional acceptable answer variants
   * (e.g. ['<head>'] when canonical is 'head'). Matched case-insensitively after trim.
   * Empty for MULTIPLE_CHOICE.
   */
  acceptableAnswers: string[]
  orderIndex: number
  createdAt?: Date
  updatedAt?: Date
}

const questionSchema = new Schema<IQuestion>(
  {
    quizId: { type: Schema.Types.ObjectId, ref: 'Quiz', required: true, index: true },
    type: { type: String, required: true, enum: Object.values(QuestionType) },
    content: { type: String, required: true },
    correctAnswer: { type: String, required: true },
    acceptableAnswers: { type: [String], default: [] },
    orderIndex: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export const Question = model<IQuestion>('Question', questionSchema)
