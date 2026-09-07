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

# Fail closed on the wrong directory BEFORE trying to substitute anything.
# `find … -exec sed -i … {} +` invokes sed zero times and exits 0 when no
# file matches, so a SPA_DIR that exists but holds no build (a typo, a bad
# volume mount) would otherwise sail through silently and serve a container
# with a healthy /health and no SPA. This check is true on every start,
# fresh or restarted, since a built SPA never loses its index.html.
if [ ! -f "$SPA_DIR/index.html" ]; then
  echo "FATAL: $SPA_DIR/index.html not found; SPA_ROOT does not point at a built SPA" >&2
  exit 1
fi

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
  # Escape what is special on sed's REPLACEMENT side under a `|` delimiter:
  # a backslash, the delimiter itself, and `&` — which means "the whole match",
  # so an unescaped `&` in a value SILENTLY re-inserts the placeholder text and
  # exits 0. A redirect URI carrying a query string (`?a=1&b=2`) is the realistic
  # case, and the emptiness guard above cannot see it.
  esc=$(printf '%s' "$value" | sed 's/[\\&|]/\\&/g')
  find "$SPA_DIR" -type f \( -name '*.js' -o -name '*.html' \) \
    -exec sed -i "s|__${var_name}__|${esc}|g" {} +
}

substitute VITE_AUTH_ISSUER
substitute VITE_AUTH_CLIENT_ID
substitute VITE_AUTH_REDIRECT_URI

# Assert the END STATE, not that substitution work happened: no bare
# `__VITE_AUTH...` placeholder literal may remain in any file substitution
# was supposed to touch.
#
# This is deliberately NOT "assert at least one file was rewritten". A
# container restarted in place (a crash, an OOM kill — not a fresh pod)
# reuses its writable layer, where the placeholders were already replaced by
# the first start; on that path there is nothing left to match, and a
# "must-have-matched" check would fail every restart and turn a recoverable
# blip into a CrashLoopBackOff. Asserting the *absence* of the placeholder
# text is true both on a fresh container (just replaced) and on a restarted
# one (replaced earlier), so it stays idempotent while still catching the
# original bug: a wrong-but-existing SPA_DIR where `find -exec sed` matched
# nothing and the literal placeholder would otherwise ship to the browser.
#
# The `-name '*.js' -o -name '*.html'` filter here MUST match substitute()'s
# filter exactly — this checks "substitution reached every file it was
# supposed to", not "no file anywhere contains this text". A wider check
# breaks the moment a file placeholders were never written into shows up
# under $SPA_DIR: turn on Vite sourcemaps (`build.sourcemap: true`, a normal
# thing to reach for while debugging a production issue) and every `.js.map`
# carries the placeholder text forever, since substitute() never touches
# `.map` files — a scan of "everything" would then refuse to start on every
# boot, sourcemaps or not.
if find "$SPA_DIR" -type f \( -name '*.js' -o -name '*.html' \) \
     -exec grep -l '__VITE_AUTH' {} + 2>/dev/null | grep -q .; then
  echo "FATAL: __VITE_AUTH* placeholder still present under $SPA_DIR after substitution" >&2
  exit 1
fi

exec "$@"
