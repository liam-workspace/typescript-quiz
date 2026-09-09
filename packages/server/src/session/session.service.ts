import type { JwtClaims } from "@liam-workspace/node-auth-server"
import type { PgPool } from "@liam-workspace/node-postgres"
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
   * The role grant is the whole access model: without it any valid token
   * from any account provisions a student. Checked before the write, so a
   * refused caller leaves no row behind.
   *
   * The grant lives in `claims.rolesByApp[accessAppId]`, NOT `claims.roles`
   * -- the issuer emits `roles` as a map keyed by client_id
   * (`Record<string, string[]>`), and `@liam-workspace/node-auth-server`
   * only populates the flat `claims.roles` array when the claim itself is
   * an array. For our tokens it is a map, so `claims.roles` is always
   * empty; reading it here would 403 every caller.
   *
   * Fails closed on every edge: no email, no `rolesByApp` entry for
   * `accessAppId`, an empty array, or the array missing `accessRole` --
   * all refuse. The predecessor of this check (a comma-separated email
   * allowlist) had the same edge and the same rule: an unset or empty
   * grant rejects every sign-in, it never admits one.
   */
  private authorizedEmail(claims: JwtClaims): string {
    const { email, rolesByApp } = claims
    const { accessAppId, accessRole } = loadServerConfig()
    const grantedRoles = rolesByApp?.[accessAppId] ?? []

    if (!email || !grantedRoles.includes(accessRole)) {
      throw new ProblemException({
        type: "role_not_granted",
        title: "This account does not hold the role required to sign in.",
        status: HttpStatus.FORBIDDEN,
      })
    }

    return email
  }

  provision(
    claims: JwtClaims,
    subjectClaim: string,
  ): Promise<{ student: StudentRow; created: boolean }> {
    const email = this.authorizedEmail(claims)

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
