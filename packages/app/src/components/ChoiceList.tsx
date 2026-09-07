import { Checkbox, RadioGroup } from "radix-ui"
import { useTranslation } from "react-i18next"
import type { QuestionType, RunnerChoice } from "../lib/api-types.js"

export interface ChoiceListProps {
  choices: RunnerChoice[]
  // Decides the widget: `single_choice` renders radios (at most one
  // selection, picking a new one replaces the old), `multi_choice` renders
  // checkboxes (any number, each toggled independently). `isQuestionCorrect`
  // (@pp/common/scoring) grades `multi_choice` by exact set equality, so a
  // radio group -- which can only ever produce a one-element selection --
  // made that question type unanswerable correctly.
  questionType: QuestionType
  // Every currently-selected choice id, in no particular order. A
  // single_choice question's page keeps this at length 0 or 1.
  selectedIds: readonly string[]
  // Fires with the id of the choice the child just tapped. The page (not
  // this component -- components/ is stateless and props-only by policy)
  // decides what that means: replace the selection for single_choice, or
  // toggle it in/out of the set for multi_choice.
  onSelect: (choiceId: string) => void
  // True when allowAnswerChange is false AND an answer already exists for
  // this question -- computed by the page (envelope.responses + the
  // section's allowAnswerChange), not by this component. components/ is
  // stateless and props-only by policy; this prop is that policy's whole
  // interface for "is this question still open to change."
  locked: boolean
}

// Shared by both widgets below -- the prototype's `.choice` row (docs/
// prototype/index.html), including the selected state. Radix primitives
// ship unstyled: an Item/Root with no className renders a control with no
// size, no border and no indicator, so a child could select an answer and
// see NOTHING change. This is what gives both the radio dot and the
// checkbox square a visible, 44px-tall row.
// `.choice` is the prototype's own rule (src/index.css), not a local
// invention: border, padding, the 44px floor and the selected state all
// come from the design system rather than being re-derived per component.
const CHOICE_ROW_CLASS = "choice"

// The source pictograms are authored with `stroke="currentColor"` so they
// pick up `.choice`'s ink/selected colour -- only true of markup rendered
// straight into the DOM, not an `<img src>`. `imageSvg` is trusted content:
// it only ever reaches here from `@pp/db`'s import pipeline (admin-gated,
// `choice_image_svg_shape` + the zod script/handler check at import time),
// never from a student.
function ChoiceImage({ svg }: { readonly svg: string }) {
  return (
    <span
      aria-hidden="true"
      className="choice-image"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

function MultiChoiceList({
  choices,
  selectedIds,
  onSelect,
  locked,
}: Omit<ChoiceListProps, "questionType">) {
  const { t } = useTranslation("runner")

  return (
    <div>
      <p className="text-ink-2 mb-2 text-sm">
        {t("choices.selectAllThatApply")}
      </p>
      <div
        role="group"
        aria-label={t("choices.selectAllThatApply")}
        className="choice-stack"
      >
        {choices.map((choice) => (
          <label key={choice.id} className={CHOICE_ROW_CLASS}>
            <Checkbox.Root
              checked={selectedIds.includes(choice.id)}
              onCheckedChange={() => {
                onSelect(choice.id)
              }}
              disabled={locked}
              className="choice-dot rounded-[4px]"
            >
              <Checkbox.Indicator className="block size-2.5 rounded-[1px] bg-white" />
            </Checkbox.Root>
            {choice.imageSvg ? <ChoiceImage svg={choice.imageSvg} /> : null}
            {choice.label}
          </label>
        ))}
      </div>
      {locked ? <p>{t("listening.answerLocked")}</p> : null}
    </div>
  )
}

function SingleChoiceList({
  choices,
  selectedIds,
  onSelect,
  locked,
}: Omit<ChoiceListProps, "questionType">) {
  const { t } = useTranslation("runner")

  return (
    <div>
      <RadioGroup.Root
        value={selectedIds[0] ?? null}
        onValueChange={onSelect}
        disabled={locked}
        className="choice-stack"
      >
        {choices.map((choice) => (
          <label key={choice.id} className={CHOICE_ROW_CLASS}>
            <RadioGroup.Item
              value={choice.id}
              className="choice-dot rounded-full"
            >
              <RadioGroup.Indicator className="block size-1.5 rounded-full bg-white" />
            </RadioGroup.Item>
            {choice.imageSvg ? <ChoiceImage svg={choice.imageSvg} /> : null}
            {choice.label}
          </label>
        ))}
      </RadioGroup.Root>
      {locked ? <p>{t("listening.answerLocked")}</p> : null}
    </div>
  )
}

// Radix's own RadioGroupItem/CheckboxRoot already refuse interaction and
// skip their change callback while `disabled` -- see `context.disabled ||
// disabled` in @radix-ui/react-radio-group and the equivalent in
// @radix-ui/react-checkbox -- so `locked` only needs to reach each Root.
export function ChoiceList({
  choices,
  questionType,
  selectedIds,
  onSelect,
  locked,
}: ChoiceListProps) {
  if (questionType === "multi_choice") {
    return (
      <MultiChoiceList
        choices={choices}
        selectedIds={selectedIds}
        onSelect={onSelect}
        locked={locked}
      />
    )
  }

  return (
    <SingleChoiceList
      choices={choices}
      selectedIds={selectedIds}
      onSelect={onSelect}
      locked={locked}
    />
  )
}
