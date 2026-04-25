import { SampleModel } from '../models/sample.model.js'
import { logger } from '../config/logger.js'

// Returns all sample documents, newest first.
export const findAll = async () => {
  return SampleModel.find().sort({ createdAt: -1 }).lean()
}

// Inserts 3 demo documents on first run if collection is empty.
// Safe to call on every server start — idempotent.
export const seedIfEmpty = async () => {
  const count = await SampleModel.countDocuments()
  if (count > 0) {
    logger.info({ count }, 'Sample collection already populated, skipping seed')
    return
  }

  await SampleModel.insertMany([
    { name: 'VORA', message: 'Verified Online Roadmap Advisor — DevCamp 2 Final Project' },
    { name: 'MongoDB Atlas', message: 'Connection works! Data persisted in cloud.' },
    { name: 'Hello mentor', message: 'This document was inserted by the backend on first start.' },
  ])

  logger.info('Seeded 3 sample documents')
}
