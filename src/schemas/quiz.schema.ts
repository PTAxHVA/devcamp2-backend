import { z } from 'zod'
import { objectId } from './object-id.schema.js'

export const submitAttemptSchema = z.object({
  answers: z
    .array(
      z
        .object({
          questionId: objectId,
          selectedOptionId: objectId.optional(),
          userInput: z.string().optional(),
        })
        .refine(
          (data) => {
            const hasOption = data.selectedOptionId !== undefined && data.selectedOptionId !== null
            const hasInput = data.userInput !== undefined && data.userInput !== null
            return (hasOption && !hasInput) || (!hasOption && hasInput)
          },
          {
            message: 'Exactly one of selectedOptionId or userInput must be provided',
          },
        ),
    )
    .min(1)
    .refine(
      (answers) => {
        const ids = answers.map((a) => a.questionId)
        return new Set(ids).size === ids.length
      },
      {
        message: 'Duplicate questionId found in answers',
      },
    ),
})

export type SubmitAttemptSchema = z.infer<typeof submitAttemptSchema>
