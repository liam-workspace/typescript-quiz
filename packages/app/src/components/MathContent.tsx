import type { ContentBlock } from "@pp/common"
import katex from "katex"
import "katex/dist/katex.min.css"
import { useTranslation } from "react-i18next"

const unsafeCommand =
  /\\(?:href|url|includegraphics|htmlClass|htmlId|htmlStyle|htmlData|def|gdef|edef|xdef|let|futurelet|newcommand|renewcommand|providecommand|global)(?![a-z])/u

type MathBlock = Extract<ContentBlock, { kind: "math" }>

function renderMathBlock({ tex, display }: MathBlock): string | null {
  if (tex.length > 4096 || tex.trim() === "" || unsafeCommand.test(tex)) {
    return null
  }

  try {
    return katex.renderToString(tex, {
      displayMode: display,
      trust: false,
      throwOnError: true,
      strict: "error",
      maxExpand: 100,
      maxSize: 10,
      output: "htmlAndMathml",
    })
  } catch {
    return null
  }
}

export function canRenderMathContent(blocks: readonly ContentBlock[]): boolean {
  return blocks.every(
    (block) => block.kind === "text" || renderMathBlock(block) !== null,
  )
}

export function MathContent({
  blocks,
}: {
  readonly blocks: readonly ContentBlock[]
}) {
  const { t } = useTranslation("runner")

  return (
    <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-2">
      {blocks.map((block, index) => {
        if (block.kind === "text") {
          return (
            <span key={index} className="wrap-anywhere whitespace-pre-wrap">
              {block.value}
            </span>
          )
        }

        const markup = renderMathBlock(block)

        if (markup === null) {
          return (
            <span key={index} role="alert" className="text-bad">
              {t("math.formulaError", {
                defaultValue: "This formula could not be rendered.",
              })}
            </span>
          )
        }

        return (
          <span
            key={index}
            className={
              block.display
                ? "block max-w-full basis-full overflow-x-auto"
                : "max-w-full overflow-x-auto"
            }
            // Only KaTeX's output with trust disabled enters the DOM as markup.
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        )
      })}
    </span>
  )
}
