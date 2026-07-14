import OpenAI from 'openai'
import { env } from './env.js'

/**
 * Provider-neutral result shape. Kept identical to what the AI services already
 * consume (`.response.text()`) so swapping the provider touches only their
 * imports — never the guardrail / JSON-parse / fallback logic in each service.
 */
export interface AiGenerateResult {
  response: { text: () => string }
}

// Fireworks exposes an OpenAI-compatible API, so the openai SDK is a drop-in.
// Each AI service already caps its call with a 10s Promise.race, so keep SDK
// retries low to avoid stacking extra latency on top of that budget.
const client = new OpenAI({
  apiKey: env.FIREWORKS_API_KEY,
  baseURL: env.FIREWORKS_BASE_URL,
  maxRetries: 1,
})

export const aiModel = {
  /** Send one prompt, return its text. The model is chosen by FIREWORKS_MODEL. */
  async generateContent(prompt: string): Promise<AiGenerateResult> {
    const completion = await client.chat.completions.create({
      model: env.FIREWORKS_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 8192,
      // Every VORA prompt already demands JSON-only output; json_object mode
      // asks the model for machine-parseable JSON. A model that ignores or lacks
      // it is still handled by each service's ```-fence strip + JSON.parse.
      response_format: { type: 'json_object' },
    })
    const text = completion.choices[0]?.message?.content ?? ''
    return { response: { text: () => text } }
  },
}
