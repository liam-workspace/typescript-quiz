import { useTranslation } from "react-i18next"
import type { AdminQuestion } from "../lib/api-types.js"

export interface AdminQuestionEditorProps {
  readonly question: AdminQuestion
  readonly editable: boolean
  readonly saving: boolean
  readonly onChange: (question: AdminQuestion) => void
  readonly onSave: () => void
}

export function AdminQuestionEditor({
  question,
  editable,
  saving,
  onChange,
  onSave,
}: AdminQuestionEditorProps) {
  const { t } = useTranslation("runner")
  const prefix = `question-${question.id}`

  function moveChoice(index: number, direction: -1 | 1) {
    const choices = [...question.choices]
    const target = index + direction
    ;[choices[index], choices[target]] = [choices[target], choices[index]]
    onChange({ ...question, choices })
  }

  return (
    <article className="device-card mt-6 p-4 sm:p-6">
      <section
        aria-label={t("admin.editor.preview", {
          defaultValue: "Learner preview",
        })}
        className="bg-paper rounded-lg p-4 sm:p-6"
      >
        <h3 className="text-ink-2 mb-3 text-sm font-semibold tracking-wide uppercase">
          {t("admin.editor.preview", { defaultValue: "Learner preview" })}
        </h3>
        <p className="text-ink mb-4 text-lg font-semibold whitespace-pre-wrap">
          {question.prompt}
        </p>
        <ol className="choice-stack">
          {question.choices.map((choice, index) => (
            <li key={choice.id} className="choice whitespace-pre-wrap">
              <span
                aria-hidden="true"
                className="text-ink-2 shrink-0 font-semibold"
              >
                {index + 1}.
              </span>
              {choice.label}
            </li>
          ))}
        </ol>
      </section>

      <form
        className="mt-6 space-y-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          onSave()
        }}
      >
        <div>
          <label htmlFor={`${prefix}-prompt`} className="block font-semibold">
            {t("admin.editor.prompt", { defaultValue: "Question prompt" })}
          </label>
          <textarea
            id={`${prefix}-prompt`}
            className="border-line mt-2 min-h-28 w-full rounded-md border bg-white p-3"
            value={question.prompt}
            maxLength={20_000}
            readOnly={!editable}
            disabled={saving}
            onChange={(event) =>
              onChange({ ...question, prompt: event.target.value })
            }
          />
        </div>
        <fieldset disabled={saving}>
          <legend className="mb-3 font-semibold">
            {t("admin.editor.choices", {
              defaultValue: "Choices and answer key",
            })}
          </legend>
          <div className="space-y-4">
            {question.choices.map((choice, index) => (
              <div
                key={choice.id}
                className="border-line rounded-md border p-3"
              >
                <label
                  htmlFor={`${prefix}-${choice.id}`}
                  className="block text-sm font-semibold"
                >
                  {t("admin.editor.choiceLabel", {
                    defaultValue: "Choice {{number}} label",
                    number: index + 1,
                  })}
                </label>
                <textarea
                  id={`${prefix}-${choice.id}`}
                  value={choice.label}
                  maxLength={2_000}
                  readOnly={!editable}
                  className="border-line mt-2 min-h-16 w-full rounded-md border bg-white p-3"
                  onChange={(event) =>
                    onChange({
                      ...question,
                      choices: question.choices.map((item) =>
                        item.id === choice.id
                          ? { ...item, label: event.target.value }
                          : item,
                      ),
                    })
                  }
                />
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="inline-flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={choice.isCorrect}
                      disabled={!editable}
                      className="accent-teal size-5"
                      onChange={(event) =>
                        onChange({
                          ...question,
                          choices: question.choices.map((item) =>
                            item.id === choice.id
                              ? { ...item, isCorrect: event.target.checked }
                              : item,
                          ),
                        })
                      }
                    />
                    {t("admin.editor.correct", {
                      defaultValue: "Choice {{number}} is correct",
                      number: index + 1,
                    })}
                  </label>
                  {editable ? (
                    <div className="flex flex-wrap gap-2 sm:ml-auto">
                      <button
                        type="button"
                        className="device-button"
                        data-variant="secondary"
                        disabled={index === 0}
                        aria-label={t("admin.editor.moveUpLabel", {
                          defaultValue: "Move choice {{number}} up",
                          number: index + 1,
                        })}
                        onClick={() => moveChoice(index, -1)}
                      >
                        {t("admin.editor.moveUp", { defaultValue: "Move up" })}
                      </button>
                      <button
                        type="button"
                        className="device-button"
                        data-variant="secondary"
                        disabled={index === question.choices.length - 1}
                        aria-label={t("admin.editor.moveDownLabel", {
                          defaultValue: "Move choice {{number}} down",
                          number: index + 1,
                        })}
                        onClick={() => moveChoice(index, 1)}
                      >
                        {t("admin.editor.moveDown", {
                          defaultValue: "Move down",
                        })}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </fieldset>
        {editable ? (
          <button
            type="submit"
            className="device-button w-full sm:w-auto"
            disabled={saving}
            aria-busy={saving}
          >
            {saving
              ? t("admin.editor.saving", { defaultValue: "Saving question…" })
              : t("admin.editor.save", { defaultValue: "Save question" })}
          </button>
        ) : null}
      </form>
    </article>
  )
}
