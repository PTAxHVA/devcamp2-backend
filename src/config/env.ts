import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  MONGO_URI: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  FIREWORKS_API_KEY: z.string().min(1),
  // Which Fireworks model to call. Overridable per environment so ops can swap
  // the model (cost / quality / availability) without a code change — the default
  // is a cheap, JSON-reliable model that fits VORA's short structured-output calls.
  FIREWORKS_MODEL: z.string().min(1).default('accounts/fireworks/models/gpt-oss-120b'),
  // Fireworks' OpenAI-compatible base URL. Overridable only if the provider path changes.
  FIREWORKS_BASE_URL: z.string().url().default('https://api.fireworks.ai/inference/v1'),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().email(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
