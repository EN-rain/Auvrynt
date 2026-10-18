# WEB_AGENT_GUIDE.md

## Scope

This guide applies to web projects: websites, web applications, frontend SPAs, full-stack apps with a web UI.

Do not apply this to Godot projects, desktop applications, CLI tools, or pure backend services unless they expose a web interface.

---

## Core Anti-Hallucination Rules
- **Never invent** a tool name, parameter, return field, command, process ID, URL, file path, screenshot, test result, or browser state.
- **Use only tools** that are actually exposed in the current session.
- **Tool availability is evidence. Tool names imagined from documentation are not available tools.**
- Before calling a specialized tool, confirm its exact tool name and schema are available.
- If a desired specialized tool is unavailable, use the safest available fallback or report the limitation.
- Do not describe a tool call as completed unless its result was returned successfully.
- Do not assume a development server is running, or that a URL, port, browser page, process, or screenshot exists.
- Do not reuse stale process IDs, workspace IDs, page IDs, or browser session IDs.
- Do not guess framework commands when package scripts can be inspected.
- Do not call multiple overlapping tools that produce the same information without a clear reason.
- Do not load unrelated Godot, desktop, mobile, or general software tools for a normal web task.
- Do not continue calling tools after the task is already verified.
- When a tool result conflicts with memory or assumptions, trust the current tool result.

---

## Primary Tools

**Workspace**
- open workspace, read file, edit file, write file
- file search, text search, project inspection

**Process management**
- start process (persistent — never use a blocking shell for a long-running dev server)
- get process logs
- list processes
- stop process

**Browser automation**
- navigate
- inspect DOM
- inspect accessibility tree
- capture page screenshot
- inspect console messages
- inspect network requests
- viewport resize
- click / type / wait

**Image tools**
- view image, inspect image, compare images

**Build and validation**
- package-manager scripts (lint, type-check, test, build)

**External internet research (Agent Reach — web profile)**
- `agent_reach_status` — detect local Agent Reach CLI
- `agent_reach_doctor` — channel health (`agent-reach doctor`)
- `agent_reach_guide` — install/update URLs and platform list
- Upstream CLIs after install: `yt-dlp`, `gh`, `twitter`, `opencli`, `bili`, etc. via `bash` when process scope is available
- Project: [Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach)

---

## Web Task Classification
Before executing any tool, classify the request into one primary task type:
- **A. Project inspection:** Framework, scripts, dependencies detection.
- **B. Bug fixing:** Code repair, hotfixes.
- **C. New feature implementation:** Adding new behavior, endpoints, routes.
- **D. UI implementation:** Adding visual layouts, components.
- **E. Website cloning or visual matching:** Replicating design from screenshot/reference.
- **F. Responsive testing:** Testing multiple viewports (Mobile, Tablet, Desktop).
- **G. Runtime debugging:** Fixing console errors, network request failures.
- **H. Build or test failure:** Compiler errors, test suites failure.
- **I. Performance investigation:** Auditing speeds, payload size, caching.
- **J. Accessibility review:** Inspecting roles, labels, contrast, keyboard focus.
- **K. Content-only edit:** Modifying static texts, links, images.
- **L. Deployment or production build preparation:** Validating build artifacts, production config.

---

## Tool Selection Decision Table

| Need | Preferred tool group | Do not use first |
|---|---|---|
| Find component | Workspace search | Browser screenshot |
| Start local app | Persistent process | Blocking shell |
| See runtime UI | Browser | Source read alone |
| Exact visual diff | Image comparison | Visual opinion only |
| Console exception | Browser console | Screenshot only |
| Failed API call | Network inspection | DOM inspection only |
| Build error | Build/validation | Browser |
| Change source | Edit tool | Shell redirection |
| Framework behavior | Official docs | Guessing |
| Mobile layout | Viewport/responsive tools | Desktop screenshot only |
| Research Twitter/Reddit/YouTube/XHS outside the app under test | Agent Reach (`agent_reach_*` + upstream CLIs) | Playwright alone on login-walled sites |
| Read arbitrary public web article as clean text | Agent Reach / Jina via upstream tools | Raw HTML dump |

---

## Core Workflow

1. Inspect only the project files and framework/package configuration needed for the request.
2. Detect the package manager from lockfiles (`package-lock.json` → npm, `yarn.lock` → yarn, `pnpm-lock.yaml` → pnpm, `bun.lockb` → bun).
3. Read existing scripts before choosing commands. Never guess a dev, test, or build command when scripts exist.
4. Make the smallest relevant source change while preserving the existing framework and architecture.
5. Run validation proportional to the changed surface.
6. Use browser/runtime tools only when the requested behavior or claimed result requires runtime evidence.
7. Stop processes started for the task when they are no longer needed.

### Browser verification is required for
- runtime browser bugs;
- user-visible behavior changes that cannot be established statically;
- responsive UI changes;
- visual-reference matching;
- console/network behavior;
- interactive or accessibility flows.

When browser verification is required, start or reuse the dev server with persistent process tools, confirm the real local URL from startup logs, inspect only the relevant DOM/accessibility/console/network state, capture the needed viewports, and compare screenshots when matching a reference.

### Browser verification is not automatically required for
- copy or typo changes;
- isolated compiler/test failures;
- backend-only changes;
- static configuration changes with an adequate non-browser validation path.

---

## Web-Specific Rules

- Do not install dependencies without checking the existing package manager; ask only when installation is truly required.
- Do not overwrite package configuration casually.
- Prefer semantic DOM inspection combined with screenshots over screenshots alone.
- Use browser tools only against the current project or an explicitly requested public URL.
- Protect against unsafe URL schemes (e.g. `file://`, `javascript:`) and SSRF.
- Allow `localhost` and `127.0.0.1` development URLs explicitly.
- Do not expose cookies, authorization headers, or secrets in responses.
- Do not download or copy proprietary website assets without permission.
- When cloning a design, reproduce layout and behavior without copying protected branding or code.
- Use exact viewport dimensions for reference comparisons.
- Distinguish resemblance from exact pixel similarity in image comparisons.
- Reinspect DOM after major re-renders before making further changes.
- Do not reuse stale process IDs, page IDs, or session IDs.

---

## Task-Specific Playbooks

### UI & Visual Matching Playbook
1. Inspect reference design/screenshot.
2. Locate components and styles.
3. Implement changes section by section.
4. Start dev server & capture candidate screenshot using identical viewport size.
5. Use image comparison tool to find differences. Adjust and repeat.

### Runtime Bug & Debugging Playbook
1. Start/reuse dev server.
2. Reproduce the bug in the browser.
3. Inspect console logs and failed network requests.
4. Locate responsible source file, patch it, and verify the console/network errors disappear.

### Build/Test Failure Playbook
1. Inspect package scripts, run failing script/command.
2. Capture concise compiler/test error.
3. Fix minimal source code, re-run command, verify success. Do not launch browser unless needed.

---

## Recommended Validation Sequence

1. Targeted type check or linter on changed files
2. Targeted tests
3. Browser: page loads, no console errors, no failed requests
4. Desktop screenshot
5. Mobile screenshot (if responsive task)
6. Screenshot comparison (if matching a reference)
7. Full production build (if requested or when verifying deploy readiness)

---

## Framework Notes

| Framework | Config file | Typical dev command |
|---|---|---|
| Vite | `vite.config.*` | `npm run dev` |
| Next.js | `next.config.*` | `npm run dev` |
| Nuxt | `nuxt.config.*` | `npm run dev` |
| Angular | `angular.json` | `ng serve` |
| Astro | `astro.config.*` | `npm run dev` |
| SvelteKit | `svelte.config.*` | `npm run dev` |

Always read `package.json scripts` to find the actual configured command. Do not assume defaults.

---

## Claim Verification Rules

| Claim | Required Evidence |
|---|---|
| **"The server is running"** | Process tool reports status `running`, and URL is confirmed. |
| **"The page loads"** | Browser tool successfully navigates to the page without error. |
| **"The bug is fixed"** | Original reproduction steps no longer fail, and lints/tests pass. |
| **"The UI matches the reference"** | Screenshots at matching viewports compared, diff box showing match percentage. |
| **"The page is responsive"** | Viewport resized to Mobile (375x667), Tablet (768x1024), and Desktop (1280x800) with no clipping. |
| **"The build passes"** | Actual successful build command output. |
| **"No console errors"** | Console logs inspected during page flow, returned empty or clean. |
| **"No failed requests"** | Network requests list inspected during page flow, showing only `2xx` / `3xx` codes. |

Never make stronger claims than the evidence supports.

---

## Agent Reach (External Platform Research)

Playwright verifies **your local web app**. [Agent Reach](https://github.com/Panniantong/Agent-Reach) is the preferred path when the task needs **external** platforms (Twitter/X, Reddit, YouTube transcripts, Bilibili, XiaoHongShu, GitHub public data, RSS, free web search) without paid APIs.

**When to use**
- Competitor / social feedback research for a product feature
- Summarize a YouTube tutorial or public GitHub discussion
- Fetch platform content that blocks anonymous/server IPs

**When not to use**
- Localhost UI, console errors, network failures in the app under test → Playwright
- Pixel / responsive verification → screenshots + image tools

**Workflow**
1. Ensure web profile is active (`auvrynt start web` or Playwright enabled).
2. Call `agent_reach_status`. If not installed, return `agent_reach_guide` install one-liner to the user.
3. After install, `agent_reach_doctor` (optionally `json: true`).
4. Call upstream tools directly (`yt-dlp`, `gh`, `twitter`, …) via shell/`bash` — Agent Reach is a router, not a permanent wrapper.
5. Prefer secondary accounts for cookie-based platforms; cookies stay local.

Install one-liner for agents:
```text
Install Agent Reach: https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/install.md
```

---

## Serena (Semantic Code)

Serena provides language-aware symbol navigation for web projects. Start a session and use it selectively.

**Good uses:**
- Find a React component by symbol
- Find all references to a hook
- Inspect a TypeScript class
- Trace a route handler
- Rename an exported function
- Insert code into a known symbol
- Understand frontend/backend dependencies

**Bad uses:**
- Pixel comparison, CSS visual verification, browser interaction
- Console inspection, failed-request inspection
- Package-manager detection, dev-server startup

**Workflow:**
1. Start session: `serena_start_session({ workspaceId })`
2. Use semantic tools: `serena_find_symbol`, `serena_find_referencing_symbols`, `serena_get_symbols_overview`, etc.
3. Edit with Auvrynt edit tools or Serena mutation tools (`serena_replace_symbol_body`, etc.)
4. Run server and verify in browser

Serena does not replace browser verification.

## Do Not Include

- Godot editor bridge calls
- Scene-tree tools
- Game runtime tools
- Collision tools
- Godot export tools
- C# debugger tools (unless the project has a C# backend)
- Blender tools (unless the task involves editing a `.blend` source asset)

---

## Response Format
When ending a web task, use this exact format:
```text
Changes:
- ...

Files:
- ...

Runtime verification:
- ...

Build/test verification:
- ...

Visual verification:
- ...

Notes/blockers:
- ...
```
