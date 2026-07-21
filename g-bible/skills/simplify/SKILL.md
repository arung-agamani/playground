---
name: simplify
description: Behavior-preserving code simplification. Use when reviewing code for unnecessary complexity, removing dead code, flattening deep nesting, or reducing cognitive load without changing behavior. Yuuka's (Oracle) primary skill.
---

# Code Simplification

Reduce complexity without changing behavior. Every line removed is a bug that can't happen.

## When to Use

- After a feature is implemented but before it ships
- When reviewing code that feels "too clever"
- When you see unnecessary abstractions, indirection, or nesting
- Before handing work off to another developer

## Simplification Checklist

1. **Dead code**: Functions, variables, imports that are never used. Remove them.
2. **Unnecessary abstraction**: An interface with one implementation. A wrapper that adds no value. An abstraction that obscures more than it clarifies. Inline it.
3. **Deep nesting**: Nested conditionals, nested callbacks, nested ternaries. Flatten them. Guard clauses, early returns, extracted functions.
4. **Over-specification**: A function that takes 6 parameters but only ever uses 2. A config object with 20 options when 3 are ever set. Reduce the surface area.
5. **Reinventing the wheel**: Custom code that duplicates a standard library function or a well-established pattern already in the codebase. Replace with the standard approach.
6. **Duplicate logic**: The same check, transformation, or pattern appearing in multiple places. Extract it.

## Rules

- **Preserve behavior.** If the simplification changes what the code does (not just how), it's wrong.
- **Verify before and after.** If tests exist, run them. If they don't, manually trace the behavior.
- **Don't over-simplify.** "Simpler" doesn't mean "shorter." A clear 10-line function beats a cryptic 3-line one-liner.
