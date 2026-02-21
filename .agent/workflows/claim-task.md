---
description: How an agent claims and executes a task from the backlog
---

# Claim and Execute a Task

## Prerequisites
- You have been assigned an agent role (check `.agent/config/agents.yaml`)
- You know your agent ID and preferred zones

## Step 1: Find Available Work
// turbo
1. List files in `.agent/tasks/backlog/`
2. Read each task file's metadata section
3. Filter for tasks where:
   - All listed dependencies (in the `Dependencies` field) have a matching file in `.agent/tasks/done/`
   - The target zone is NOT listed in any task file in `.agent/tasks/active/`
   - The task's zone matches your `preferred_zones` in agents.yaml

## Step 2: Claim the Task
1. Move the chosen task file from `backlog/` to `active/`:
   `mv .agent/tasks/backlog/TASK-NNN.md .agent/tasks/active/TASK-NNN.md`
2. Edit the task file:
   - Set `Status: active`
   - Set `Claimed By: {your-agent-id}`
   - Set `Branch: agent/TASK-NNN`
3. Update the zone's `OWNERS.md`:
   - Set `Agent: {your-agent-id}`
   - Set `Since: {current ISO timestamp}`
   - Set `Task: TASK-NNN`
// turbo
4. Create a new git branch: `git checkout -b agent/TASK-NNN`
5. Commit the claim: `git add -A && git commit -m "chore: claim TASK-NNN"`

## Step 3: Read Context (MANDATORY — do this before writing ANY code)
// turbo
1. Read the task file completely (`.agent/tasks/active/TASK-NNN.md`)
2. Read the zone's `CONTRACT.md` (the public API you must honor)
3. Read the zone's `OWNERS.md` (what zones you depend on)
4. Read ALL files in `.agent/knowledge/decisions/` (architecture decisions)
5. Read ALL files in `.agent/knowledge/patterns/` (code style patterns)
6. If this is a retry, read `.agent/feedback/TASK-NNN/` (previous failure details)
7. Read any "Context Files" listed in the task

## Step 4: Implement
1. Write tests FIRST (TDD) based on the task's acceptance criteria
2. Write implementation code following established patterns
3. Use templates from `.agent/templates/` where applicable
4. **CRITICAL: Only modify files within your owned zone's path**
5. Keep total diff under the zone's `max_diff_lines` limit (check zones.yaml)

## Step 5: Self-Verify
// turbo
1. Run: `pnpm lint --filter=@airtr/{zone-name}`
2. Run: `pnpm typecheck --filter=@airtr/{zone-name}`
3. Run: `pnpm test --filter=@airtr/{zone-name} --run`
4. If ANY of these fail, fix the issues before proceeding
5. Do NOT submit work that fails self-verification

## Step 6: Submit for Review
1. Commit with: `git add -A && git commit -m "feat(TASK-NNN): {brief description}"`
// turbo
2. Push: `git push origin agent/TASK-NNN`
3. Move task file: `mv .agent/tasks/active/TASK-NNN.md .agent/tasks/review/TASK-NNN.md`
4. Update task status: `Status: review`
5. CI gates will run automatically on the pushed branch

## Step 7: Handle Results
- **ALL gates pass**: Task auto-merges. Move task to `done/`. Release zone ownership.
- **ANY gate fails**: Read the feedback in `.agent/feedback/TASK-NNN/`. Fix and re-push.
- **After 3 failures**: Move task to `failed/`. Reset zone OWNERS.md. Stop work on this task.
