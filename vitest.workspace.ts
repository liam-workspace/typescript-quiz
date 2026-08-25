// Kept in sync with pnpm-workspace.yaml: packages/socket and packages/web
// are the old Razzia app, excluded from the pnpm workspace, so they must
// not be globbed here either.
export default ["packages/common", "packages/db"]
