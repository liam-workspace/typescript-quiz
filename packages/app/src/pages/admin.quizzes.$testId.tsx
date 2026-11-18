import { Outlet, createFileRoute, useMatches } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { AdminQuestionEditor } from "../components/AdminQuestionEditor.js"
import {
  getAdminTest,
  listAdminQuestions,
  patchDraftQuestion,
} from "../lib/admin-api.js"
import type { AdminQuestion, AdminTestDetail } from "../lib/api-types.js"
import { Route as QuizzesRoute } from "./admin.quizzes.js"

interface AdminQuizDetailData {
  readonly quiz: AdminTestDetail
  readonly questions: AdminQuestion[]
  readonly nextCursor: null
}

async function loadQuestions(testId: string): Promise<AdminQuestion[]> {
  const questions: AdminQuestion[] = []
  let cursor: string | null = null

  do {
    // Each opaque cursor depends on the preceding page.
    // eslint-disable-next-line no-await-in-loop
    const page = await listAdminQuestions({
      limit: 20,
      testId,
      ...(cursor ? { cursor } : {}),
    })
    questions.push(...page.items)
    cursor = page.nextCursor
  } while (cursor !== null)

  return questions
}

export async function loadAdminQuizDetail(
  testId: string,
): Promise<AdminQuizDetailData> {
  const [quiz, questions] = await Promise.all([
    getAdminTest(testId),
    loadQuestions(testId),
  ])

  return { quiz, questions, nextCursor: null }
}

function hasQuestionChanges(original: AdminQuestion, edited: AdminQuestion) {
  return (
    original.prompt !== edited.prompt ||
    original.choices.length !== edited.choices.length ||
    original.choices.some((choice, index) => {
      const editedChoice = edited.choices[index]

      return (
        choice.id !== editedChoice.id ||
        choice.label !== editedChoice.label ||
        choice.isCorrect !== editedChoice.isCorrect
      )
    })
  )
}

export function AdminQuizDetailScreen({
  initialData,
}: {
  readonly initialData: AdminQuizDetailData
}) {
  const { t } = useTranslation("runner")
  const [data, setData] = useState(() => ({
    ...initialData,
    questionEdits: new Map<string, AdminQuestion>(),
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const editable = data.quiz.status === "draft"

  function updateQuestion(question: AdminQuestion) {
    setData((current) => {
      const original = current.questions.find((item) => item.id === question.id)
      const questionEdits = new Map(current.questionEdits)

      if (original && hasQuestionChanges(original, question)) {
        questionEdits.set(question.id, question)
      } else {
        questionEdits.delete(question.id)
      }

      return { ...current, questionEdits }
    })
    setError(null)
    setSaved(false)
  }

  async function saveQuestion(question: AdminQuestion) {
    if (!editable || saving) {
      return
    }

    setSaved(false)
    setError(null)

    if (!question.prompt.trim() || question.prompt.trim().length > 20_000) {
      setError(
        t("admin.editor.invalidPrompt", {
          defaultValue: "Enter a question prompt of up to 20,000 characters.",
        }),
      )

      return
    }

    if (
      question.choices.length < 2 ||
      question.choices.length > 100 ||
      question.choices.some(
        (choice) => !choice.label.trim() || choice.label.trim().length > 2_000,
      )
    ) {
      setError(
        t("admin.editor.invalidChoices", {
          defaultValue:
            "Provide 2–100 choices with a label of up to 2,000 characters each.",
        }),
      )

      return
    }

    if (!question.choices.some((choice) => choice.isCorrect)) {
      setError(
        t("admin.editor.invalidAnswer", {
          defaultValue: "Select at least one correct choice.",
        }),
      )

      return
    }

    setSaving(true)
    let committed = false

    try {
      await patchDraftQuestion(data.quiz.versionId, question.id, {
        prompt: question.prompt.trim(),
        choices: question.choices.map((choice) => ({
          ...choice,
          label: choice.label.trim(),
        })),
      })
      committed = true
      const refreshed = await loadAdminQuizDetail(data.quiz.id)
      setData((current) => {
        const questionEdits = new Map<string, AdminQuestion>()

        if (
          refreshed.quiz.versionId === current.quiz.versionId &&
          refreshed.quiz.status === "draft"
        ) {
          for (const item of refreshed.questions) {
            const edited = current.questionEdits.get(item.id)

            if (
              item.id !== question.id &&
              edited &&
              hasQuestionChanges(item, edited)
            ) {
              questionEdits.set(item.id, edited)
            }
          }
        }

        return { ...refreshed, questionEdits }
      })
      setSaved(true)
    } catch {
      setError(
        committed
          ? t("admin.editor.refreshError", {
              defaultValue:
                "The question was saved, but the latest quiz could not be loaded. Refresh before editing again.",
            })
          : t("admin.editor.saveError", {
              defaultValue:
                "Could not save the question. Your edits are still here. Please try again.",
            }),
      )
    } finally {
      setSaving(false)
    }
  }

  let description = t("admin.editor.readOnly", {
    defaultValue: "This version is read-only.",
  })

  if (editable) {
    description = t("admin.editor.draft", {
      defaultValue:
        "Draft · Preview each question, then edit its text, choice order and answer key.",
    })
  } else if (data.quiz.status === "published") {
    description = t("admin.editor.published", {
      defaultValue:
        "Published version · Read-only. Create a draft to make changes.",
    })
  }

  return (
    <section aria-labelledby="admin-quiz-title">
      <a
        href="/admin/quizzes"
        className="text-teal mb-4 inline-flex min-h-11 items-center underline underline-offset-4"
      >
        {t("admin.editor.back", { defaultValue: "Back to quizzes" })}
      </a>
      <h2 id="admin-quiz-title" className="screen-title">
        {data.quiz.title}
      </h2>
      <p className="screen-subtitle">{description}</p>
      {saved ? (
        <p role="status" className="text-teal mt-4 font-semibold">
          {t("admin.editor.saved", {
            defaultValue: "Question saved. The preview is up to date.",
          })}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-bad mt-4 font-semibold">
          {error}
        </p>
      ) : null}
      {data.questions.length === 0 ? (
        <p className="device-card mt-6">
          {t("admin.editor.empty", {
            defaultValue: "This quiz has no questions yet.",
          })}
        </p>
      ) : null}
      {data.questions.map((item) => {
        const question = data.questionEdits.get(item.id) ?? item

        return (
          <AdminQuestionEditor
            key={question.id}
            question={question}
            editable={editable}
            saving={saving}
            onChange={updateQuestion}
            onSave={() => saveQuestion(question)}
          />
        )
      })}
    </section>
  )
}

function AdminQuizPending() {
  const { t } = useTranslation("runner")

  return (
    <p role="status" className="device-card text-ink-2">
      {t("admin.editor.loading", { defaultValue: "Loading quiz…" })}
    </p>
  )
}

function AdminQuizError() {
  const { t } = useTranslation("runner")

  return (
    <p role="alert" className="device-card text-bad">
      {t("admin.editor.loadError", {
        defaultValue: "Could not load this quiz. Please refresh to try again.",
      })}
    </p>
  )
}

export const Route = createFileRoute("/admin/quizzes/$testId")({
  loader: ({ params }) => loadAdminQuizDetail(params.testId),
  pendingComponent: AdminQuizPending,
  errorComponent: AdminQuizError,
  component: QuizDetailRouteComponent,
})

function QuizDetailRouteComponent() {
  const data = Route.useLoaderData()

  return <AdminQuizDetailScreen key={data.quiz.id} initialData={data} />
}

// The catalogue predates its child route. Compose its original screen with an
// Outlet here so deep links render details without changing the catalogue file.
const CatalogueComponent = QuizzesRoute.options.component
QuizzesRoute.update({
  component: function QuizzesWithDetail() {
    const hasDetail = useMatches({
      select: (matches) =>
        matches.some((match) => match.routeId === "/admin/quizzes/$testId"),
    })

    if (hasDetail) {
      return <Outlet />
    }

    return CatalogueComponent ? <CatalogueComponent /> : null
  },
})
