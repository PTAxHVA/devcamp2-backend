import { Schema, model, Types } from 'mongoose'

export interface IOnboardingQuestionnaire {
  userId: Types.ObjectId
  rolePreference: string
  goal: string
  completed: boolean
  timePerWeekHours: number
  currentComfortLevel: string
  learningStyle: string
  frameworkPreference: string
  projectType: string
  cliComfort: string
  timelineGoal: string
  operatingSystem: string
  selectedBranchIds: Types.ObjectId[]
  extraPreferences: string
  createdAt?: Date
  updatedAt?: Date
}

const onboardingQuestionnaireSchema = new Schema<IOnboardingQuestionnaire>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    rolePreference: { type: String, default: '' },
    goal: { type: String, default: '' },
    completed: { type: Boolean, default: false },
    timePerWeekHours: { type: Number, default: 0 },
    currentComfortLevel: { type: String, default: '' },
    learningStyle: { type: String, default: '' },
    frameworkPreference: { type: String, default: '' },
    projectType: { type: String, default: '' },
    cliComfort: { type: String, default: '' },
    timelineGoal: { type: String, default: '' },
    operatingSystem: { type: String, default: '' },
    selectedBranchIds: [{ type: Schema.Types.ObjectId, ref: 'MasterBranch' }],
    extraPreferences: { type: String, default: '' },
  },
  { timestamps: true },
)

export const OnboardingQuestionnaire = model<IOnboardingQuestionnaire>(
  'OnboardingQuestionnaire',
  onboardingQuestionnaireSchema,
)
