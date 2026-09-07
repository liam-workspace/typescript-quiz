declare const brand: unique symbol

type Branded<T, B extends string> = T & { readonly [brand]: B }

export type StudentId = Branded<string, "StudentId">

export type TestId = Branded<string, "TestId">

export type TestVersionId = Branded<string, "TestVersionId">

export type SectionId = Branded<string, "SectionId">

export type StimulusId = Branded<string, "StimulusId">

export type GroupId = Branded<string, "GroupId">

export type QuestionId = Branded<string, "QuestionId">

export type ChoiceId = Branded<string, "ChoiceId">

export type AttemptId = Branded<string, "AttemptId">

export const asStudentId = (v: string) => v as StudentId

export const asTestId = (v: string) => v as TestId

export const asTestVersionId = (v: string) => v as TestVersionId

export const asSectionId = (v: string) => v as SectionId

export const asStimulusId = (v: string) => v as StimulusId

export const asGroupId = (v: string) => v as GroupId

export const asQuestionId = (v: string) => v as QuestionId

export const asChoiceId = (v: string) => v as ChoiceId

export const asAttemptId = (v: string) => v as AttemptId
