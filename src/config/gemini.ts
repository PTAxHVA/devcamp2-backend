import { GoogleGenerativeAI } from '@google/generative-ai'
import { env } from './env.js'

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY)

export const geminiModel = genAI.getGenerativeModel({
  model: env.GEMINI_MODEL,
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json',
  },
})
