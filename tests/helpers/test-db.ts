import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

// A single-node replica set (NOT a standalone) because createUserRoadmap /
// editUserRoadmap run inside Mongo transactions, which require a replica set.
let mongod: MongoMemoryReplSet | null = null

export const connectTestDb = async (): Promise<void> => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  await mongoose.connect(mongod.getUri())
  // Wait for every model's background index build before any test runs: an
  // in-flight createIndex can hold the collection lock just long enough to
  // abort a test transaction (5ms txn lock budget) as a transient error.
  await Promise.all(Object.values(mongoose.connection.models).map((model) => model.init()))
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
