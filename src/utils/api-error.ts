export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string = 'ERROR',
    public details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
