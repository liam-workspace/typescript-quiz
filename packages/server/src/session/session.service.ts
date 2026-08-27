import {
  isEmailAllowed,
  type JwtClaims,
} from "@liam-workspace/node-auth-server"
import type { PgPool } from "@liam-public/node-postgres"
import { HttpStatus, Inject, Injectable } from "@nestjs/common"
import {
  findStudentBySubject,
  upsertStudentBySubject,
  type StudentRow,
} from "@pp/db"
import { ProblemException } from "../attempts/problem.exception.js"
import { loadServerConfig } from "../config.js"
import { REQUEST_POOL } from "../database/tokens.js"

/** The contract's `Student`: closed, and deliberately narrower than the row. */
export interface StudentView {
  id: string
  displayName: string
  email: string
  level: "primary-step-1" | "primary-step-2" | null
  isAdmin: boolean
}

/**
 * `isAdmin` is taken from the claims on THIS request, never from the
 * database. There is no admin column: the token is the authority, so
 * revoking the role at the identity provider takes effect on the next call
 * rather than after a sync.
 */
export function toStudentView(row: StudentRow, isAdmin: boolean): StudentView {
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    level: row.level,
    isAdmin,
  }
}

/**
 * JwtClaims carries no name — node-auth-server never extracts a `name` claim
 * from the token — but `student.display_name` is NOT NULL with a not-blank
 * CHECK, and the contract requires `displayName`. The email local part is the
 * only name-shaped thing the verified claims actually contain, so it seeds
 * the profile; a parent can rename later.
 */
function displayNameFrom(email: string): string {
  const local = email.split("@")[0]?.trim()

  return local && local.length > 0 ? local : email
}

@Injectable()
export class SessionService {
  constructor(@Inject(REQUEST_POOL) private readonly pool: PgPool) {}

  /**
   * The allowlist is the whole access model: without it any valid Google
   * token from any account provisions a student. Checked before the write,
   * so a refused email leaves no row behind.
   */
  private allowedEmail(claims: JwtClaims): string {
    const { email } = claims

    if (!email || !isEmailAllowed(email, loadServerConfig().allowedEmails)) {
      throw new ProblemException({
        type: "email_not_allowed",
        title: "This email is not permitted to sign in.",
        status: HttpStatus.FORBIDDEN,
      })
    }

    return email
  }

  provision(
    claims: JwtClaims,
    subjectClaim: string,
  ): Promise<{ student: StudentRow; created: boolean }> {
    const email = this.allowedEmail(claims)

    return upsertStudentBySubject(this.pool, {
      subjectClaim,
      email,
      displayName: displayNameFrom(email),
    })
  }

  find(subjectClaim: string): Promise<StudentRow | null> {
    return findStudentBySubject(this.pool, subjectClaim)
  }
}
