/**
 * Managed (email-less) child accounts — client service
 * (docs/specs/managed-child-accounts.md §5, §7).
 *
 * Thin client wrappers around the two parent-only callables plus the pure
 * helper that composes a managed child's synthetic sign-in address. Unlike the
 * fire-and-forget notify-* callables, the parent NEEDS the result and any
 * error here, so failures surface as a user-safe `ManagedChildActionError`
 * (never a raw Firebase code or PI).
 *
 * The child later signs in with family loginCode + loginHandle + password: the
 * login screen calls `composeChildLoginEmail` and hands the result to the
 * normal `signIn` path — no new auth primitive. The `.familyhq.invalid` suffix
 * (RFC 2606 reserved TLD) can never route mail, so this address is a login
 * identifier only, never a mailbox.
 */
import { getFunctions, httpsCallable, type FunctionsError } from 'firebase/functions';
import { FUNCTIONS_REGION } from '../../firebase/functions-region';

/**
 * Synthetic-address suffix for managed child sign-in. MUST stay in lockstep
 * with the server composer (functions/src/createManagedChild.ts
 * `CHILD_EMAIL_DOMAIN_SUFFIX` / `composeChildEmail`); both sides are pinned by
 * tests. `.invalid` is the IETF-reserved TLD (RFC 2606) — never routable.
 */
export const CHILD_LOGIN_EMAIL_DOMAIN = 'familyhq.invalid';

/** Parent-chosen child username: 2–20 lowercase letters or digits. */
export const CHILD_HANDLE_RE = /^[a-z0-9]{2,20}$/;
/** Minimum password length (matches the server-side check). */
export const CHILD_MIN_PASSWORD_LENGTH = 8;

/** A generic, user-safe error — never leaks a raw Firebase code or PI. */
export class ManagedChildActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagedChildActionError';
  }
}

const GENERIC_ERROR = 'Something went wrong. Please try again.';

export interface CreateManagedChildInput {
  displayName: string;
  handle: string;
  password: string;
}

export interface CreateManagedChildResult {
  childUid: string;
  /** The family's login code — the parent shares this + the handle with the child. */
  loginCode: string;
  handle: string;
}

/**
 * Compose the managed child's synthetic sign-in address from the family login
 * code + the child's handle. Inputs are normalised (trimmed, lower-cased) so
 * the child can type "OTTER42 / Maya" and still reproduce the exact address the
 * server minted at creation. Pure — no I/O.
 */
export function composeChildLoginEmail(loginCode: string, handle: string): string {
  const code = loginCode.trim().toLowerCase();
  const h = handle.trim().toLowerCase();
  return `${h}@${code}.${CHILD_LOGIN_EMAIL_DOMAIN}`;
}

/**
 * Map a callable failure to a user-safe message. The server's input-validation
 * codes (invalid-argument / already-exists / failed-precondition) already carry
 * user-safe, PI-free copy, so we surface those; everything else (permission,
 * auth, internal, unknown) collapses to the generic retry message. Rate-limit
 * gets its own friendly line.
 */
function toUserSafeMessage(err: unknown): string {
  const code = (err as Partial<FunctionsError> | null)?.code;
  const message = (err as Partial<FunctionsError> | null)?.message;
  switch (code) {
    case 'functions/resource-exhausted':
      return 'Too many attempts. Please wait a minute and try again.';
    case 'functions/invalid-argument':
    case 'functions/already-exists':
    case 'functions/failed-precondition':
      return typeof message === 'string' && message.length > 0 ? message : GENERIC_ERROR;
    default:
      return GENERIC_ERROR;
  }
}

/**
 * Parent-only: create an email-less managed child account. Pre-validates the
 * handle + password client-side for instant feedback (the callable re-checks
 * server-side, which is authoritative), normalises the handle, then invokes
 * `createManagedChild`. Returns the sign-in coordinates the parent relays to
 * the child (never the password — the parent already chose it).
 */
export async function createManagedChild(
  input: CreateManagedChildInput,
): Promise<CreateManagedChildResult> {
  const displayName = input.displayName.trim();
  const handle = input.handle.trim().toLowerCase();
  if (displayName.length < 1 || displayName.length > 50) {
    throw new ManagedChildActionError('Please enter a name (1–50 characters).');
  }
  if (!CHILD_HANDLE_RE.test(handle)) {
    throw new ManagedChildActionError('Usernames use 2–20 lowercase letters or numbers.');
  }
  if (input.password.length < CHILD_MIN_PASSWORD_LENGTH) {
    throw new ManagedChildActionError('Passwords need at least 8 characters.');
  }

  try {
    const fns = getFunctions(undefined, FUNCTIONS_REGION);
    const fn = httpsCallable<CreateManagedChildInput, CreateManagedChildResult>(
      fns,
      'createManagedChild',
    );
    const res = await fn({ displayName, handle, password: input.password });
    return res.data;
  } catch (err) {
    throw new ManagedChildActionError(toUserSafeMessage(err));
  }
}

export interface ResetManagedChildPasswordInput {
  childUid: string;
  newPassword: string;
}

/**
 * Parent-only: reset a managed child's password (the child has no email, so the
 * self-serve reset flow can't reach them). Pre-validates length client-side.
 */
export async function resetManagedChildPassword(
  input: ResetManagedChildPasswordInput,
): Promise<void> {
  if (input.newPassword.length < CHILD_MIN_PASSWORD_LENGTH) {
    throw new ManagedChildActionError('Passwords need at least 8 characters.');
  }
  try {
    const fns = getFunctions(undefined, FUNCTIONS_REGION);
    const fn = httpsCallable<ResetManagedChildPasswordInput, { ok: true }>(
      fns,
      'resetManagedChildPassword',
    );
    await fn({ childUid: input.childUid, newPassword: input.newPassword });
  } catch (err) {
    throw new ManagedChildActionError(toUserSafeMessage(err));
  }
}
