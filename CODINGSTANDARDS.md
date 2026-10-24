# Coding Standards

This is the canonical source for coding standards and practices in this repository — for
human contributors and coding agents alike. `AGENTS.md` points here rather than restating these
rules, and `CLAUDE.md` points to `AGENTS.md`.

This document does not require any existing code to be rewritten. It governs new code and
code you touch going forward. Bringing the existing codebase in line with these standards is
tracked as separate follow-up work.

## Lint, format, and style

- ESLint 9 (flat config, `eslint.config.js`) is the linter, scoped to
  `./src*/**/*.{ts,js,cjs,mjs,vue}` (covers both `src/` and `src-bex/`). Run `npm run lint`
  (`-- --fix` to autofix). Key rules already enforced: `@typescript-eslint/no-explicit-any`
  as an error, and `@typescript-eslint/consistent-type-imports` (prefer `import type`).
- Prettier 3 (`.prettierrc.json`: single quotes, 100-column print width) is the sole
  formatter. Run `npm run format`. Do not add stylistic ESLint rules that would conflict
  with Prettier.
- `.editorconfig` governs whitespace/EOL/charset at the editor level; keep it in sync with
  Prettier's settings if either changes.
- The rule set above is treated as sufficient for this repository today. Extending it (for
  example, an import/dependency-boundary rule to enforce the layering described below) is
  deliberately out of scope for this document — revisit only if boundary violations become a
  recurring problem in review.

## TypeScript discipline

- Strict mode is on (`quasar.config.ts` → `build.typescript.strict: true`); do not weaken it.
- **Never use `any`.** Prefer exact types, type guards, discriminated unions, generics, or
  `unknown` plus narrowing. If a third-party surface is awkward or weakly typed, add a local
  type, adapter, or ambient declaration under `src/types/` instead of reaching for `any`. New
  `any` usage is treated as a failure unless explicitly requested and justified in review.
- Prefer `readonly` properties and `as const` assertions to prevent accidental mutation of
  values that should be immutable.
- Prefer pure functions for calculations and queries. Use union types and discriminated
  unions to model state so illegal states are unrepresentable rather than checked at
  runtime.
- Use `<script setup lang="ts">` for all Vue SFCs.

## Domain-Driven Design standards

These standards apply to domain logic you write or materially change — business rules,
invariants, and the concepts they operate on. They are principle-level guidance, not a
mandated folder layout: this repository does not yet have a dedicated domain directory (e.g.
`src/domain/`), and this document does not introduce one. Where a new domain concept needs a
home, place it near its existing feature area (e.g. alongside the relevant `src/services/*`
or `src-bex/handlers/*` module) using the patterns below. A concrete folder convention, if
adopted, is a decision for a future, separate ticket once enough domain code exists to
justify one.

### Core modeling standards

1. **Value objects** — Encapsulate concepts like an email address or an amount using
   immutable type aliases or classes. Two value objects with equal values are
   interchangeable; equality is by value, not identity.
2. **Entities** — Model objects with a distinct identity (e.g. a UUID) that persists over
   time. Equality is by identity, not by attributes — two entities with identical attributes
   but different identities are different entities.
3. **Aggregates** — Group related entities and value objects into a single unit for data
   changes, and enforce invariants at the aggregate root. Code outside the aggregate should
   not mutate its internals directly.
4. **Avoid primitive obsession** — Don't pass raw `string`/`number` for domain concepts that
   carry business rules (a pubkey, a relay URL, a satoshi amount). Use a named type alias or
   branded type so the type system — not convention — prevents misuse. `src/types/pubkey.ts`
   (`Pubkey`, `createPubkey`) and `src/types/relay-url.ts` (`RelayUrl`, `createRelayUrl`) are
   the established pattern: a branded type plus a factory function that validates and
   normalizes, returning `null` on invalid input rather than throwing. Follow this shape for
   new domain concepts.

### Architectural structure

5. **Hexagonal / onion layering** — Keep the domain layer (business logic, entities, value
   objects) free of framework, browser, and I/O concerns. Application-layer code
   (use cases/services) orchestrates the domain; infrastructure code (storage, network,
   browser APIs) implements the domain's ports. Domain code should not import Vue, Quasar,
   Dexie, or `chrome.*`/`browser.*` APIs directly.
6. **Bounded contexts** — Organize code by business concept (e.g. vault/key custody, relay
   management, signing approval) rather than by technical layer alone, so each area's
   vocabulary and rules stay legible on their own.
7. **Ports as interfaces** — Define repository/service interfaces in the domain layer;
   implement them in the infrastructure layer. This is dependency inversion: the domain
   depends on an interface it owns, not on a concrete storage or transport mechanism.

### Naming and construction

- **Ubiquitous language** — Name classes, methods, and variables after the domain concepts
  they represent (e.g. `SigningApproval`, `RelayCatalog`, `VaultAccount`), so code reads in
  the same vocabulary used to describe the product, not in generic CRUD terms.
- **Factories** — Use factory functions or classes to encapsulate creation logic that must
  enforce invariants, so an entity or aggregate can never exist in an invalid state.

## Testing

- Vitest + jsdom is the test framework; config is `vitest.config.ts`, setup is
  `tests/setup.ts`. Run with `npm run test` (watch) or `npm run test:run` (single run).
- Tests live under `tests/unit/**` (mirroring the `src`/`src-bex` module structure:
  `services/`, `components/`, `pages/`, `stores/`, `composables/`, `utils/`,
  `handlers/`) or as co-located `*.spec.ts` files under `src/`/`src-bex/`.
- Mock crypto via `tests/unit/mocks/crypto.ts`. Porwr makes HTTP calls with `fetch` (there is no
  HTTP client library): stub it with `vi.stubGlobal('fetch', vi.fn())`, as
  `tests/unit/services/nip05-service.test.ts` does, and mock relay pools at the module boundary.
  Keep tests deterministic.

## Where this document does not go

- It does not require rewriting existing `src/`/`src-bex/` code — that migration is
  explicitly out of scope here and tracked separately.
- It does not change lint/format tooling or add new dependencies.
- It does not mandate a `src/domain/`-style folder convention.
