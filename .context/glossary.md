# Glossary

Project-specific terms, acronyms, and jargon. Every agent reads this when
the term appears in a task. Prevents agents from guessing or generating
nonsense when the project has specific vocabulary.

Add a term whenever:
- You catch yourself explaining the same term twice
- An agent misunderstands a project-specific word
- A new domain concept emerges from real work

Keep entries terse. A sentence is usually enough.

---

## Format

```
## Term

Definition in one or two sentences. Optionally: how it's used in this project, what it's NOT to be confused with.
```

---

## Entries

## familyId

The tenant key. An immutable field on every non-`families` Firestore doc that
binds it to one family. Tenant isolation is enforced by comparing a resource's
`familyId` to the caller's own (`callerFamily()`, read server-side from the
caller's `users/{uid}` doc) in `firestore.rules` — never trusted from the request.

## userPrivate

A per-subject Firestore collection (`userPrivate/{uid}`) holding an adult member's
email, kept OFF the family-readable `users` doc so other members (notably
children) cannot read it. Readable only by the subject or a same-family parent;
never listable. (ADR-0008.)

## Founding-parent bootstrap

The signup path where a new parent atomically creates their `families` doc + their
own `users` doc (`role: 'parent'`). The ONLY place `role == 'parent'` is
self-assigned and a `familyId` is self-set. Bounded in rules (via `!callerExists()`)
so it cannot be replayed by an existing member to self-elevate or join another
family. (ADR-0006, threat-model §4.)

## Dormant feature

Code that is merged, typed, tested, and bundled into production but is
**disabled in the production deploy** because enabling it would require a
Firebase billing-plan upgrade (Spark → Blaze). Currently: Chore Photo
Verification (Storage-dependent — see `deploy.yml` and PR #84). The UI
affordance is reachable and the rules-test suite still gates the rules
file on every local `make verify`, but the deploy step that would push
the rules to the live project is intentionally absent. Activating a
dormant feature is a one-PR change (revert the deploy exclusion) paired
with a Firebase Console action. (ADR-0010.)

## Listes

The French label for the **Tasks** tab in the BottomNav. Chosen over the
literal translation "Tâches" because Chores already uses "Tâches" in
French; placing both side-by-side in the 5-slot nav would be unparseable
for a `fr-CA` user. `Tâches` → chores; `Listes` → the Task Management
tab (To-Do List + Routine Checklists). See `src/locales/fr.json` `nav.*`
and PR #85.
