# Why these repository conventions

Reviewed September 6, 2026. `AGENTS.md` contains the operative rules; this document records their rationale and research sources. User preferences take priority over these external conventions.

## What the research supports

Google's code-review guidance favors understandable design, useful tests, meaningful names, necessary comments, and avoiding speculative generalization. Those principles align with short plain-English comments and small, focused functions/modules. It does not establish a universal maximum file length or folder layout. [Google review guidance](https://google.github.io/eng-practices/review/reviewer/looking-for.html)

The TypeScript style guide provides a concrete example of consistent type/value naming and module conventions. We use relevant ideas, not the entire guide: Expo's required exports/filenames and the repository's formatter still govern this stack. [Google TypeScript style guide](https://google.github.io/styleguide/tsguide.html)

Reddit discussions emphasize code review and avoiding duplicate type definitions, but disagree about colocating types versus sharing them. Naming discussions also show that short generic names and descriptive ones each have appropriate contexts. These are qualitative peer opinions, not a representative poll or proof of a majority view. [Type organization discussion](https://www.reddit.com/r/typescript/comments/1dbbqsc/types_across_a_project/), [Generic naming discussion](https://www.reddit.com/r/typescript/comments/1drxad9/why_do_we_use_such_ambiguous_names_for_generics/)

## How that translates to this repository

| Preference | Repository decision |
| --- | --- |
| Short comments | Explain non-obvious behavior/reasons in one plain-English line; omit narration |
| Few abstractions | Use named domain functions and existing service boundaries; add generic machinery only for a demonstrated need |
| Shallow code | Prefer guard clauses; simplify branching without creating a maze of tiny helpers |
| Manageable files | Typical 100–300 lines, review before 500, no hand-written source files reaching 1,000; these are project choices |
| Clear names | Domain names with enough context, no unnecessary prefixes or very long descriptions |
| Types in types | Feature/package-local `types/`, with shared wire types in contracts; avoid a global type bag |
| Pure functions in lib | Feature/package-local `lib/`; dependencies such as time are passed as arguments |
| Clear filenames | Domain-specific modules, PascalCase components, framework filenames where required |

Zod validators and Drizzle definitions execute at runtime, so they belong in schema modules rather than `types/`. Transport types derive from the Zod schema with type-only imports, avoiding a manually maintained duplicate. Package boundaries prevent a type reuse shortcut from pulling database/server code into a mobile bundle.

Use formatting/lint tools for mechanical consistency. Reviewers should spend their attention on behavior, security, data integrity, and readability. The [AGENTS.md convention](https://agents.md/) supports keeping repository instructions discoverable; the requested `CLAUDE.md` symlink keeps one maintained source for both entrypoints.

The AI security rules follow the separation between untrusted model input and enforceable application/tool authorization described by [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html). They remain requirements to implement and verify, not claims of deployed isolation.
