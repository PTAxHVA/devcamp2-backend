import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  MONGO_URI: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  GEMINI_API_KEY: z.string().min(1),
  // Which Gemini model to call. Overridable per environment (free-tier quota is
  // per model per day, so ops can switch e.g. to gemini-2.5-flash-lite without a
  // code change). Optional: absent env keeps today's behavior.
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
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
