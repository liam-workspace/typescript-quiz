import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppMenu } from "./AppMenu.js"

const menuResources = {
  "menu.title": "Menu",
  "menu.library": "Test library",
  "menu.history": "Attempt history",
  "menu.leaveTest": "Leave test",
  "menu.leaveTestNoteBeforeStart":
    "Nothing has started yet. The clock begins when you tap I'm ready.",
  "menu.leaveTestNoteRunning": "The clock keeps running while you are away.",
  "menu.language": "Language",
  "menu.signOut": "Sign out",
  "menu.primaryNavigation": "Main menu",
  "menu.openLabel": "Open menu",
  "menu.closeLabel": "Close menu",
  "navigator.openLabel": "Open the question navigator",
}

const i18n = i18next.createInstance()
await i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { runner: menuResources },
    fr: {
      runner: {
        ...menuResources,
        "menu.title": "Menu français",
        "menu.primaryNavigation": "Navigation principale",
        "menu.closeLabel": "Fermer le panneau",
      },
    },
  },
})

beforeEach(async () => {
  await i18n.changeLanguage("en")
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderMenu(props: Partial<Parameters<typeof AppMenu>[0]> = {}) {
  const handlers = {
    onBackgroundAction: vi.fn(),
    onGoLibrary: vi.fn(),
    onGoHistory: vi.fn(),
    onLeaveTest: vi.fn(),
    onSignOut: vi.fn(),
  }

  render(
    <I18nextProvider i18n={i18n}>
      <button type="button" onClick={handlers.onBackgroundAction}>
        Background action
      </button>
      <AppMenu
        open
        onOpenChange={vi.fn()}
        inTest={false}
        clockStarted={false}
        student={{ displayName: "Tom", email: "tom@example.com" }}
        {...handlers}
        {...props}
      />
    </I18nextProvider>,
  )

  return handlers
}

describe("AppMenu", () => {
  it("renders a dialog labelled by its visible title", () => {
    renderMenu()
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeInTheDocument()
  })

  it("groups the student, navigation, language, and sign-out controls in the device menu", () => {
    renderMenu()

    const menu = screen.getByRole("navigation", { name: "Menu" })

    expect(menu).toHaveClass("device-drawer")
    expect(screen.getByText("Tom")).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Main menu" })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument()
    expect(screen.getByRole("contentinfo")).toHaveTextContent("Sign out")
  })

  it("uses the responsive panel dimensions with utility precedence", () => {
    renderMenu()

    expect(screen.getByRole("dialog", { name: "Menu" })).toHaveClass(
      "device-sheet-content",
      "device-drawer-panel",
    )
    expect(screen.getByRole("dialog", { name: "Menu" })).toHaveAttribute(
      "data-side",
      "left",
    )
  })

  it("localizes the primary navigation label", async () => {
    await i18n.changeLanguage("fr")
    renderMenu()

    expect(
      screen.getByRole("group", { name: "Navigation principale" }),
    ).toBeInTheDocument()
  })

  it("localizes the sheet close control", async () => {
    await i18n.changeLanguage("fr")
    renderMenu()

    expect(
      screen.getByRole("button", { name: "Fermer le panneau" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument()
  })

  it("makes the rest of the page inert while the modal menu is open", async () => {
    const user = userEvent.setup()
    const handlers = renderMenu()
    const backgroundAction = screen.getByRole("button", {
      name: "Background action",
      hidden: true,
    })

    expect(
      screen.queryByRole("button", { name: "Background action" }),
    ).not.toBeInTheDocument()
    expect(document.body).toHaveStyle({ pointerEvents: "none" })
    await expect(user.click(backgroundAction)).rejects.toThrow(
      /pointer-events/u,
    )
    expect(handlers.onBackgroundAction).not.toHaveBeenCalled()
  })

  it("contains reverse-Tab navigation inside the open menu", async () => {
    const user = userEvent.setup()
    renderMenu()
    const dialog = screen.getByRole("dialog", { name: "Menu" })
    const firstAction = within(dialog).getByRole("button", {
      name: "Test library",
    })

    firstAction.focus()
    await user.keyboard("{Shift>}{Tab}{/Shift}")

    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it("shows the signed-in student's display name", () => {
    renderMenu()
    expect(screen.getByText("Tom")).toBeInTheDocument()
    expect(screen.getByText("tom@example.com")).toBeInTheDocument()
  })

  it("hides Leave test outside an attempt", () => {
    renderMenu({ inTest: false })
    expect(
      screen.queryByRole("button", { name: "Leave test" }),
    ).not.toBeInTheDocument()
  })

  it("shows the pre-clock note when in a test but the clock has not started", () => {
    renderMenu({ inTest: true, clockStarted: false })
    expect(screen.getByText(/clock begins when you tap/i)).toBeInTheDocument()
  })

  it("shows the running-clock note once the clock has started", () => {
    renderMenu({ inTest: true, clockStarted: true })
    expect(
      screen.getByText(/clock keeps running while you are away/i),
    ).toBeInTheDocument()
  })

  it("calls onGoLibrary when Test library is clicked", async () => {
    const handlers = renderMenu()
    await userEvent.click(screen.getByRole("button", { name: "Test library" }))
    expect(handlers.onGoLibrary).toHaveBeenCalledOnce()
  })

  it("calls onGoHistory when Attempt history is clicked", async () => {
    const handlers = renderMenu()
    await userEvent.click(
      screen.getByRole("button", { name: "Attempt history" }),
    )
    expect(handlers.onGoHistory).toHaveBeenCalledOnce()
  })

  it("calls onLeaveTest when Leave test is clicked", async () => {
    const handlers = renderMenu({ inTest: true })
    await userEvent.click(screen.getByRole("button", { name: "Leave test" }))
    expect(handlers.onLeaveTest).toHaveBeenCalledOnce()
  })

  it("changes language and visibly distinguishes the selected language", async () => {
    renderMenu()
    const english = screen.getByRole("button", { name: "en" })
    const french = screen.getByRole("button", { name: "fr" })

    expect(english).toHaveAttribute("aria-pressed", "true")
    expect(french).toHaveAttribute("aria-pressed", "false")
    expect(english).toHaveClass("device-language-button")
    expect(french).toHaveClass("device-language-button")
    expect(english.className).toBe(french.className)

    await userEvent.click(french)

    expect(english).toHaveAttribute("aria-pressed", "false")
    expect(french).toHaveAttribute("aria-pressed", "true")
    expect(english.className).toBe(french.className)
  })

  it("uses 44px targets for every menu action", () => {
    renderMenu({ inTest: true })

    for (const name of [
      "Test library",
      "Attempt history",
      "Leave test",
      "en",
      "fr",
      "de",
      "es",
      "it",
      "ja",
      "Sign out",
    ]) {
      expect(screen.getByRole("button", { name }).className).toContain(
        "size-11",
      )
    }
  })

  it("calls onSignOut when Sign out is clicked", async () => {
    const handlers = renderMenu()
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }))
    expect(handlers.onSignOut).toHaveBeenCalledOnce()
  })

  // The student arrives as a prop, so the menu must render before the shell
  // has resolved one rather than assuming it is always there. The earlier
  // version read it from useAuth(), which throws outright without an
  // AuthProvider -- and nothing in this app mounts one.
  it("renders without a student, showing a placeholder initial", () => {
    renderMenu({ student: undefined })

    expect(screen.getByText("Menu")).toBeInTheDocument()
    expect(screen.getByText("?")).toBeInTheDocument()
  })

  it("shows the student's name and email when the shell supplies one", () => {
    renderMenu({ student: { displayName: "Tom", email: "tom@example.com" } })

    expect(screen.getByText("Tom")).toBeInTheDocument()
    expect(screen.getByText("tom@example.com")).toBeInTheDocument()
  })
})
