---
name: verification-planning
description: Project-specific verification paths. Use before non-trivial work to plan how changes will be verified — tests to run, manual checks, edge cases to confirm. Yuzu (Orchestrator) uses this in the VERIFY phase of orchestration.
---

# Verification Planning

Before implementing anything non-trivial, plan how you'll know it works. Verification is not "it compiles" — it's "I am confident this is correct."

## When to Use

- Before dispatching agents to implement a multi-file change
- Before committing or declaring work complete
- When the change touches critical paths (auth, payments, data integrity)

## Verification Checklist

1. **What tests exist?** Find existing tests related to the changed code. These must still pass.
2. **What tests are missing?** Identify gaps — edge cases, error paths, boundary conditions that aren't covered.
3. **What manual checks?** If the project lacks tests, define specific manual verification steps. "Open the login page, enter invalid credentials, verify the error message appears."
4. **What integrations are affected?** List callers, consumers, and downstream code that might break. Verify each.
5. **What data is affected?** If database schemas or data transformations changed, verify migrations and data integrity.

## Output Format

```
Verification Plan for: [feature/bug/change]

Pre-existing tests to run:
- tests/api/users.test.ts (auth flow)
- tests/components/Login.test.tsx (rendering)

New edge cases to check:
- Empty input → should show validation error
- Network failure → should show retry UI
- Already logged in → should redirect away

Manual checks:
1. Navigate to /login
2. Submit empty form → verify error states
3. Submit invalid credentials → verify error message
4. Submit valid credentials → verify redirect to /dashboard

Risk assessment: LOW — changes are scoped to login component only.
```

Include the risk assessment and a confidence level.
