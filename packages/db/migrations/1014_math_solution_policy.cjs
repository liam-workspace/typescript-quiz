/* eslint-disable camelcase, typescript/no-unsafe-call, typescript/no-unsafe-member-access */
exports.shorthands = undefined

exports.up = (pgm) => {
  // Historical imports have no immutable record of the requested policy.
  pgm.sql(
    "ALTER TABLE question_math ADD COLUMN show_solution_after_test boolean NOT NULL DEFAULT false",
  )
}

exports.down = (pgm) => {
  pgm.sql("ALTER TABLE question_math DROP COLUMN show_solution_after_test")
}
