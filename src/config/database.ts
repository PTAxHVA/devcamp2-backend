import mongoose from 'mongoose'
import { env } from './env.js'
import { logger } from './logger.js'

export const connectDB = async () => {
  try {
    await mongoose.connect(env.MONGO_URI)
    logger.info('MongoDB connected')
  } catch (err) {
    logger.error({ err }, 'MongoDB connection failed')
    process.exit(1)
  }
}
