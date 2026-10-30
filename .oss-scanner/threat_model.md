# Threat model — fast-gateway

## What this project does and where untrusted input enters
- fast-gateway is a Node.js API gateway: it routes incoming HTTP and WebSocket requests to upstream services by prefix, path pattern and hostname, with hooks and optional caching.
- Untrusted: everything from downstream clients (method, URL/path including dot segments and encoding, query string, headers such as `Host` and `x-forwarded-*`, bodies, WebSocket upgrade requests and frames).
- Partially trusted: responses from upstream services (they should not be able to affect other routes or clients).
- Trusted: gateway configuration (routes, targets, hooks, middlewares) supplied by the operator.

## Components that matter most / least
- In scope, highest priority: `index.js` (route registration, prefix stripping / `prefixRewrite`, dot-segment handling, target URL construction), `lib/proxy-factory.js`, `lib/ws-proxy.js`, `lib/hostnames-hook.js`, `lib/default-hooks.js`.
- Out of scope: `demos/`, `docs/`, `benchmark/`, `test/`, devDependencies.
- `restana`, `0http` and `fast-proxy-lite` are our own dependencies; report issues reachable through the gateway and note the root cause.

## How to exercise it
- `npm test` runs the mocha suite in `test/` (routing, hostnames hook, WebSocket proxy, raw HTTP tests in `test/raw-http.js`).
- Minimal gateway: `require('./index')({ routes: [{ prefix: '/api', target: 'http://127.0.0.1:3001' }] }).start(8080)`.

## How you rate severity
- Critical: SSRF or request routing to an upstream/path the operator did not configure (e.g. escaping a route prefix via `..`, encoded slashes, or `Host` manipulation); remote code execution.
- High: bypassing gateway middlewares/hooks (auth, rate limit) for a configured route; request smuggling or header injection toward upstreams; a single request that crashes the gateway; cache poisoning across clients.
- Medium: resource exhaustion needing sustained traffic, leaking upstream internals to clients.
- Low: hardening suggestions.

## Anything to leave alone
- Behavior that only occurs with an obviously unsafe operator configuration (e.g. a route whose target is built from user input by custom hooks).
- Advisories that only affect devDependencies.
