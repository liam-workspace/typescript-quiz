import { RadioGroup } from "radix-ui"
import { useTranslation } from "react-i18next"
import type { RunnerChoice } from "../lib/api-types.js"

export interface ChoiceListProps {
  choices: RunnerChoice[]
  selectedId: string | null
  onSelect: (choiceId: string) => void
  // True when allowAnswerChange is false AND an answer already exists for
  // this question -- computed by the page (envelope.responses + the
  // section's allowAnswerChange), not by this component. components/ is
  // stateless and props-only by policy; this prop is that policy's whole
  // interface for "is this question still open to change."
  locked: boolean
}

// Radix's own RadioGroupItem already refuses interaction and skips
// onValueChange while `disabled` -- see `context.disabled || disabled` in
// @radix-ui/react-radio-group -- so `locked` only needs to reach `Root`.
export function ChoiceList({
  choices,
  selectedId,
  onSelect,
  locked,
}: ChoiceListProps) {
  const { t } = useTranslation("runner")

  return (
    <div>
      <RadioGroup.Root
        value={selectedId}
        onValueChange={onSelect}
        disabled={locked}
      >
        {choices.map((choice) => (
          <label key={choice.id} className="flex items-center gap-2">
            <RadioGroup.Item value={choice.id}>
              <RadioGroup.Indicator />
            </RadioGroup.Item>
            {choice.label}
          </label>
        ))}
      </RadioGroup.Root>
      {locked ? <p>{t("listening.answerLocked")}</p> : null}
    </div>
  )
}
