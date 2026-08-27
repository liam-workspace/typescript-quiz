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
          // Radix primitives ship unstyled: `RadioGroup.Item` with no
          // className renders a button with no size, no border and no
          // indicator, so a child could select an answer and see NOTHING
          // change. Every assertion here still passed -- they check
          // aria-checked and onSelect, which are true of an invisible
          // control too. These are the prototype's `.choice` rules
          // (docs/prototype/index.html), including the selected state.
          <label
            key={choice.id}
            className="mb-2 flex min-h-11 w-full cursor-pointer touch-manipulation items-center gap-3 rounded-xl border-[1.5px] border-stone-300 bg-white px-4 py-3 text-[15px] has-[[data-state=checked]]:border-teal-700 has-[[data-state=checked]]:bg-teal-50 has-[[data-state=checked]]:font-bold"
          >
            <RadioGroup.Item
              value={choice.id}
              className="grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] border-stone-400 bg-white data-[state=checked]:border-teal-700 data-[state=checked]:bg-teal-700"
            >
              <RadioGroup.Indicator className="block size-1.5 rounded-full bg-white" />
            </RadioGroup.Item>
            {choice.label}
          </label>
        ))}
      </RadioGroup.Root>
      {locked ? <p>{t("listening.answerLocked")}</p> : null}
    </div>
  )
}
