import { describe, expect, it } from "vitest"
import type {
  CappedStimulusWire,
  OpenStimulusWire,
  StimulusWire,
} from "./api-types.js"

describe("StimulusWire", () => {
  it("rejects a mediaUrl on a capped stimulus at the type level", () => {
    // A capped stimulus carries NO mediaUrl per openapi.yaml (CappedStimulus has
    // additionalProperties: false and no mediaUrl in its properties at all) --
    // the URL is only ever issued by a successful /play. If this object literal
    // ever typechecks, a component could read a mediaUrl straight off a capped
    // stimulus, which is exactly the play-cap bypass this type exists to prevent.
    const capped: CappedStimulusWire = {
      id: "stim-1",
      type: "audio",
      maxPlays: 2,
      playsUsed: 0,
      allowPause: false,
      allowSeek: false,
      // @ts-expect-error -- CappedStimulusWire has no mediaUrl property
      mediaUrl: "https://example.com/audio.mp3",
    }

    expect(capped.maxPlays).toBe(2)
  })

  it("still lets an open stimulus carry a mediaUrl", () => {
    const open: OpenStimulusWire = {
      id: "stim-2",
      type: "image",
      maxPlays: null,
      mediaUrl: "https://example.com/image.png",
    }

    const stimulus: StimulusWire = open

    expect(stimulus.maxPlays).toBeNull()
  })
})
