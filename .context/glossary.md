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
