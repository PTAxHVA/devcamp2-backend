import { Schema, model } from 'mongoose'

// Demo model — proves MongoDB connection works.
export interface Sample {
  name: string
  message: string
  createdAt: Date
}

const sampleSchema = new Schema<Sample>({
  name: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
})

export const SampleModel = model<Sample>('Sample', sampleSchema)
