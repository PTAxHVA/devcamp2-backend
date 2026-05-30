import { isValidObjectId } from 'mongoose'
import { ApiError } from '../utils/api-error.js'
import { MasterRoadmap } from '../models/master-roadmap.model.js'
import { MasterBranch } from '../models/master-branch.model.js'
import { BranchTopic } from '../models/branch-topic.model.js'

export const generateSuggestedRoadmap = async (
  masterRoadmapId: string,
  branchSelections: string[],
) => {
  if (!isValidObjectId(masterRoadmapId)) {
    throw new ApiError(400, 'Invalid master roadmap ID', 'INVALID_MASTER_ROADMAP_ID')
  }

  for (const branchId of branchSelections) {
    if (!isValidObjectId(branchId)) {
      throw new ApiError(400, 'Invalid branch ID', 'INVALID_BRANCH_ID')
    }
  }

  const roadmap = await MasterRoadmap.findById(masterRoadmapId).lean()
  if (!roadmap) {
    throw new ApiError(404, 'Master roadmap not found', 'MASTER_ROADMAP_NOT_FOUND')
  }

  const selectedMasterBranches = await MasterBranch.find({ _id: { $in: branchSelections } }).lean()
  if (!selectedMasterBranches) {
    throw new ApiError(404, 'Master branch not found', 'MASTER_BRANCH_NOT_FOUND')
  }

  const selectedBranchTopics = await BranchTopic.find({
    branchId: { $in: selectedMasterBranches.map((branch) => branch._id) },
  }).lean()
  if (!selectedBranchTopics) {
    throw new ApiError(404, 'Branch topics not found', 'BRANCH_TOPICS_NOT_FOUND')
  }
}
