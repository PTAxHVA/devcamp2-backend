import { z } from 'zod'

const objectIdRegex = /^[0-9a-fA-F]{24}$/
export const objectId = z.string().regex(objectIdRegex, 'Invalid ObjectId')
