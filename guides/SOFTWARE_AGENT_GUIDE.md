# SOFTWARE_AGENT_GUIDE.md

## Scope

This guide applies primarily to non-Godot C#/.NET software projects, including:
- C#/.NET desktop applications, APIs, libraries, CLI tools, services, and background workers
- Non-Godot projects using C#/.NET

For non-.NET software, keep the generic safety/evidence principles but use that project's native manifest, package manager, compiler, test runner, and configured scripts instead of the .NET-specific required workflow below.

Do not use Godot scene-tree or inspector tools unless a `project.godot` exists and is active.
Do not use web browser/screenshot tools unless the application exposes a web API/UI.

---

## Primary Tools

**Workspace & Search**
- open workspace, read file, edit file, write file
- file search, text search, project inspection
- C# symbol definitions, references, and definitions lookup

**C#/.NET Core Tools**
- `inspect_dotnet_project`
- `dotnet_restore`
- `dotnet_build`
- `dotnet_test`
- `dotnet_run`
- `dotnet_format`
- `get_csharp_diagnostics`

**Serena Semantic Tools** (when Serena is enabled)
- `serena_start_session` — start a Serena session for the workspace
- `serena_find_symbol` — locate a symbol by name
- `serena_find_referencing_symbols` — find all references to a symbol
- `serena_get_symbols_overview` — overview of symbols in a file
- `serena_search_for_pattern` — language-aware pattern search
- `serena_find_implementations` — find implementations
- `serena_find_declaration` — find declaration
- `serena_get_diagnostics_for_file` — LSP diagnostics for a file
- `serena_get_diagnostics_for_symbol` — diagnostics for a symbol
- `serena_replace_symbol_body` — replace symbol body (controlled mutation)
- `serena_insert_before_symbol` — insert code before a symbol
- `serena_insert_after_symbol` — insert code after a symbol
- `serena_rename_symbol` — rename symbol across the project
- `serena_safe_delete_symbol` — delete symbol with safety checks

**Process management**
- start process (for persistent background services or long-running APIs)
- get process logs
- list processes
- stop process

---

## Required Workflow

1. **Inspect Solution/Project:** Read `.sln` or `.csproj` files to identify target frameworks, dependencies, and project structure.
2. **Determine Target Frameworks:** Identify whether the project targets `.NET Core / Standard / Framework` or specific operating systems.
3. **Restore Dependencies:** Run `dotnet_restore` when starting or when project references/dependencies change. Do not run repeatedly.
4. **Compile & Build:** Execute `dotnet_build` to catch compilation errors. Fix diagnostics returned semantically.
5. **Run Tests:** Execute targeted unit/integration tests using `dotnet_test` (with filter arguments to run specific tests if needed).
6. **Lsp & Semantics:** Prefer Roslyn/LSP symbol definition and reference tracking over plain text search when navigating code.
7. **Clean execution:** For long-running apps, use persistent process tools rather than blocking shell commands.

---

## Software-Specific Rules

- **Do not rewrite entire project files** unless modifying configuration/dependencies is explicitly requested.
- **Do not add packages** or dependencies without necessity.
- **Do not change target frameworks** casually.
- **Do not expose secrets** or credentials in code, environments, or logs.
- **Do not claim tests passed** unless they were actually executed and returned a successful exit code.
- Prefer semantic C# refactorings and structural symbol navigation over simple regex replacement.
- For long-running processes, capture logs and check for stack traces or unhandled exceptions.

---

## Verification Checklist

- [ ] Project restores without NuGet errors.
- [ ] Build completes with 0 errors and warning counts checked.
- [ ] Targeted tests run and pass.
- [ ] Code formatting verified with linter or `dotnet_format`.
- [ ] Process starts, listens on designated ports (if API), and logs are clean of exceptions.
- [ ] Code compiles cleanly on target frameworks.

---

## Serena Routing

Use Serena for semantic navigation when the backend supports the language.

- Use Roslyn/Auvrynt .NET tools for authoritative C# diagnostics.
- Avoid duplicate semantic edits from Serena and Roslyn in the same step.
- Choose one semantic mutation owner per operation.
- Refresh both services after edits when both are active.

For C#:
- Compiler/build truth → .NET tools (`dotnet_build`, `inspect_dotnet_project`)
- Semantic navigation → Serena (`serena_find_symbol`, `serena_find_referencing_symbols`, etc.)
- Debugger → DAP

Do not claim Serena alone proves a C# build succeeds. Always run `dotnet_build` to verify.
