---
name: rust-coding-style
description: Use when writing, refactoring, or reviewing Rust code to apply naming, signature, type-path, error-type, and test-placement conventions.
---

# Rust coding style

## Names and signatures

- Use the terms used by dependencies and protocols for corresponding concepts; do not introduce local synonyms or abbreviations.
- Omit redundant enclosing names: use `cache::Entry`, not `cache::CacheEntry`, and `Entry { key }`, not `Entry { entry_key }`.
- Include at least a verb and an object in function names, unless clearly redundant or following an established Rust naming convention.
- Use structs with named fields instead of tuples or fixed-size arrays when positions represent distinct roles rather than a sequence.

## Type paths and imports

- Write type paths at use sites, such as `crate::module::Type` or `super::Type`; do not import types with `use` merely to omit their module paths.
- Do not define `type` aliases or rename imports merely to shorten type names or generic expressions.
- Do not use `pub use` to hide an internal module path. Define a type in the module that exposes it, or have callers write its full path.
- Import traits needed for method resolution with `use ... as _`. Keep required associated type definitions; they are not convenience aliases.

## Tests

- Place unit tests near their implementations in the same module unless this causes compiler or Clippy warnings.

## Error types

- Return the error type of the subsystem performing the operation rather than an application-wide catch-all enum.
- Represent distinct failure kinds with enum variants, and store failure-specific details in the fields of the corresponding variant.
