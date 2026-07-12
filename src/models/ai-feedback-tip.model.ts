import { Schema, model } from 'mongoose'
import { FeedbackSeverity } from '../types/enums.js'
import type { FeedbackAction, FeedbackScenario } from '../config/ai-feedback-tips.js'

export interface IAiFeedbackTip {
  action: FeedbackAction
  scenario: FeedbackScenario
  text: string
  severity: FeedbackSeverity
  createdAt?: Date
  updatedAt?: Date
}

const aiFeedbackTipSchema = new Schema<IAiFeedbackTip>(
  {
    action: { type: String, enum: ['add', 'remove'], required: true },
    scenario: {
      type: String,
      enum: ['default', 'branch-conflict'],
      required: true,
      default: 'default',
    },
    text: { type: String, required: true, trim: true },
    severity: {
      type: String,
      enum: Object.values(FeedbackSeverity),
      required: true,
      default: FeedbackSeverity.WARNING,
    },
  },
  { timestamps: true },
)

// One curated tip per (action, scenario) — the service looks tips up by this key.
aiFeedbackTipSchema.index({ action: 1, scenario: 1 }, { unique: true })

export const AiFeedbackTip = model<IAiFeedbackTip>('AiFeedbackTip', aiFeedbackTipSchema)
