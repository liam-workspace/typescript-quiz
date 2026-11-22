import { Link, Outlet, createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { requireAdmin } from "../lib/admin-auth.js"

const navigation = [
  { label: "Overview", href: "/admin" },
  { label: "Candidates", href: "/admin/candidates" },
  { label: "Quizzes", href: "/admin/quizzes" },
  { label: "Questions", href: "/admin/questions" },
  { label: "Results", href: "/admin/results" },
  { label: "Learners", href: "/admin/learners" },
]

export function AdminLayout() {
  const { t } = useTranslation("runner")

  return (
    <div className="device-page">
      <header className="app-bar">
        <Link to="/" className="app-brand">
          {t("admin.library", { defaultValue: "Test library" })}
        </Link>
        <span className="text-ink-2 ml-auto text-sm font-semibold">
          {t("admin.label", { defaultValue: "Admin" })}
        </span>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <h1 className="screen-title" tabIndex={-1} data-page-title>
          {t("admin.title", { defaultValue: "Administration" })}
        </h1>
        <nav
          aria-label={t("admin.title", { defaultValue: "Administration" })}
          className="my-6"
        >
          <ul className="flex flex-wrap gap-2">
            {navigation.map(({ label, href }) => (
              <li key={href}>
                <Link
                  to={href}
                  activeOptions={{ exact: href === "/admin" }}
                  activeProps={{ className: "bg-teal-bg text-teal" }}
                  className="hover:bg-teal-bg inline-flex min-h-11 items-center rounded-md px-4 font-semibold underline-offset-4 focus-visible:underline"
                >
                  {t(`admin.navigation.${label.toLowerCase()}`, {
                    defaultValue: label,
                  })}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export const Route = createFileRoute("/admin")({
  beforeLoad: requireAdmin,
  component: AdminLayout,
})
