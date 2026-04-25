export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; details?: unknown } }

export const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data })
