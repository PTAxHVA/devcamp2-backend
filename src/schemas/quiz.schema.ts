import { z } from 'zod'

export const submitAttemptSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string(),
      selectedOptionId: z.string().optional(),
      userInput: z.string().optional(),
    }),
  ),
})

export type SubmitAttemptSchema = z.infer<typeof submitAttemptSchema>
