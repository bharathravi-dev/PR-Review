/** Error shape at every port boundary (spine Consistency Conventions). */
export interface AppError {
  code: string
  message: string
  retryable: boolean
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError }

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })
export const err = (code: string, message: string, retryable = false): Result<never> => ({
  ok: false,
  error: { code, message, retryable },
})
