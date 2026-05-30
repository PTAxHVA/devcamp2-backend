import { GoogleGenerativeAI } from '@google/generative-ai'
import { env } from './env.js'

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY)

export const geminiModel = genAI.getGenerativeModel({
  model: 'gemini-2.0-flash',
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 2048,
    responseMimeType: 'application/json',
  },
})
