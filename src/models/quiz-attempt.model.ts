import { Schema, model, Types } from 'mongoose'

export interface IQuizAttempt {
  userId: Types.ObjectId
  quizId: Types.ObjectId
  score: number | null
  isPassed: boolean
  cooldownUntil: Date | null
  submittedAt: Date | null
  startedAt: Date
  createdAt?: Date
  updatedAt?: Date
}

const quizAttemptSchema = new Schema<IQuizAttempt>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    quizId: { type: Schema.Types.ObjectId, ref: 'Quiz', required: true, index: true },
    score: { type: Number, default: null, min: 0, max: 100 },
    isPassed: { type: Boolean, default: false },
    cooldownUntil: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    startedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
)

quizAttemptSchema.index({ userId: 1, quizId: 1 }, { unique: true })

export const QuizAttempt = model<IQuizAttempt>('QuizAttempt', quizAttemptSchema)
