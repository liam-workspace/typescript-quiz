#!/bin/sh
# Substitute the SPA's build-time auth placeholders with real values, then exec
# the command we were given.
#
# Vite inlines `import.meta.env.VITE_*` at BUILD time, so these three cannot be
# supplied to the container as ordinary environment variables — the bundle was
# already written. The Dockerfile therefore bakes `__VITE_AUTH_ISSUER__` (etc.)
# as the literal value and this script rewrites them on the way up, which keeps
# ONE image usable in any environment. Same pattern as newsfeed-cms's cms.sh.
#
# We exec "$@" rather than a hardcoded command, but note that under Kubernetes
# the Vault wrapper in _lib/_deployment.tpl sets BOTH `command:` and `args:`,
# which discards this image's ENTRYPOINT *and* CMD. The chart therefore passes
# the command explicitly:
#   entrypoint: /app/docker-entrypoint.sh node packages/server/dist/main.js
# Under plain `docker run` the image CMD supplies it instead.
set -e
SPA_DIR="${SPA_ROOT:-/app/public}"

substitute() {
  var_name="$1"
  eval "value=\${$var_name:-}"
  # Fail closed. cms.sh skips an empty value silently; here that would ship a
  # bundle asking a browser to reach `https://__VITE_AUTH_ISSUER__`, which
  # presents as a broken sign-in with no error anywhere in the deploy.
  if [ -z "$value" ]; then
    echo "FATAL: $var_name is not set; the SPA would ship the literal __${var_name}__" >&2
    exit 1
  fi
  find "$SPA_DIR" -type f \( -name '*.js' -o -name '*.html' \) \
    -exec sed -i "s|__${var_name}__|${value}|g" {} +
}

substitute VITE_AUTH_ISSUER
substitute VITE_AUTH_CLIENT_ID
substitute VITE_AUTH_REDIRECT_URI

exec "$@"
