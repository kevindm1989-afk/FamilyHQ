/**
 * Cloud Functions deployment region. MUST match the `region:` value passed
 * into every onCall in functions/src/notify*.ts.
 *
 * Kept in its own zero-dependency module (no firebase/app, no firebase init)
 * so the 5 client services that read it (boardService, choresParentService,
 * choresMemberService, todosService, wishlistService) can import the
 * constant without dragging the full firebase SDK into their test sandboxes.
 *
 * Pre-fix bug: every push-callable invocation since PR D used
 * `getFunctions()` with no region, defaulting to `us-central1`. The server-
 * side functions are deployed in `northamerica-northeast1`. Requests went
 * to a non-existent endpoint and returned 404; the SPA's fire-and-forget
 * try/catch (per ADR-0014) swallowed the error and the server saw zero
 * invocations — push had never delivered end-to-end.
 */
export const FUNCTIONS_REGION = 'northamerica-northeast1';
