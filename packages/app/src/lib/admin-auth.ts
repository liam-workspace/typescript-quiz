import { redirect } from "@tanstack/react-router"
import { ApiError } from "./api-client.js"
import type { Student } from "./api-types.js"
import { SIGN_IN_PATH } from "./authPaths.js"
import { getCurrentStudent } from "./session-api.js"

export async function requireAdmin(): Promise<Student> {
  const student = await getCurrentStudent().catch((error: unknown) => {
    if (error instanceof ApiError && error.problem.status === 401) {
      redirect({ href: SIGN_IN_PATH, replace: true, throw: true })
    }

    throw error
  })

  if (!student.isAdmin) {
    redirect({ to: "/", replace: true, throw: true })
  }

  return student
}
