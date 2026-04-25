import { ApiError } from '../utils/api-error.js'
import type { LoginInput, SignupInput } from '../schemas/auth.schema.js'

export const login = async (_input: LoginInput) => {
  throw new ApiError(501, 'Login not implemented yet — M3', 'NOT_IMPLEMENTED')
}

export const signup = async (_input: SignupInput) => {
  throw new ApiError(501, 'Signup not implemented yet — M3', 'NOT_IMPLEMENTED')
}
