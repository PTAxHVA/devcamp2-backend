import { Schema, model, Types } from 'mongoose'

export interface IQuizAttemptAnswer {
  quizAttemptId: Types.ObjectId
  questionId: Types.ObjectId
  selectedOptionId: Types.ObjectId | null
  userInput: string | null
  isCorrect: boolean
  createdAt?: Date
  updatedAt?: Date
}

const quizAttemptAnswerSchema = new Schema<IQuizAttemptAnswer>(
  {
    quizAttemptId: {
      type: Schema.Types.ObjectId,
      ref: 'QuizAttempt',
      required: true,
      index: true,
    },
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    selectedOptionId: { type: Schema.Types.ObjectId, ref: 'QuestionOption', default: null },
    userInput: { type: String, default: null },
    isCorrect: { type: Boolean, required: true },
  },
  { timestamps: true },
)

export const QuizAttemptAnswer = model<IQuizAttemptAnswer>(
  'QuizAttemptAnswer',
  quizAttemptAnswerSchema,
)
