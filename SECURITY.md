# Security boundary

The local server defaults to `AUTH_MODE=demo` so the reader can be run without
an identity provider. In this mode, write requests may use the demo actor in
the request body or `X-Workspace-Actor` header. This is only for local
development.

For a deployed instance, set:

```sh
AUTH_MODE=token
AUTH_TOKENS_JSON='{"token-value":"workspace-member-id"}'
```

Write requests must then send `Authorization: Bearer token-value`. The server
ignores any actor ID in the request body and uses the server-side token map
before checking the member's workspace role.

Token-authenticated reads of workspace data use the same membership check. A
request without a token receives `401`; a signed-in user who is not a member of
the requested workspace receives `403`; a request without a workspace filter
returns only workspaces where that actor is a member. The domain evidence packet
and source-linked inspection endpoints are not customer-private workspace data.

Token-authenticated write requests must also send an `Idempotency-Key`. A
retry with the same key replays the original result instead of creating a
second question, decision, publication, or acknowledgment.

This token map is a small deployment adapter, not a replacement for an
identity provider. A production deployment should place a real identity and
token-validation service in front of the API, keep secrets outside the
repository, use TLS, rotate credentials, and retain audit logs.
