import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

// A single-node replica set (NOT a standalone) because createUserRoadmap /
// editUserRoadmap run inside Mongo transactions, which require a replica set.
let mongod: MongoMemoryReplSet | null = null

export const connectTestDb = async (): Promise<void> => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  await mongoose.connect(mongod.getUri())
}

export const disconnectTestDb = async (): Promise<void> => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
  mongod = null
}

// Wipe every collection between tests so suites stay independent.
export const clearCollections = async (): Promise<void> => {
  const collections = mongoose.connection.collections
  for (const key of Object.keys(collections)) {
    await collections[key]!.deleteMany({})
  }
}
