---
wave: 1
depends_on: []
files_modified:
  ["app/services/pipeline.server.ts", "app/services/worker.server.ts"]
autonomous: true
---

# Plan: Pipeline Async Pre-Heating and Idle Enforcers

## Objective

Shift the StartPod initialization routines to the absolute top of the pipeline orchestration flow to absorb network cold-start overheads, inject a concurrency queue check before firing StopPod instructions to avoid trashing parallel processing, and implement an automated 1-hour staleness watcher.

## Tasks

<task>
<description>
Move Pod Start routines to front of pipeline.
</description>
<read_first>
- app/services/pipeline.server.ts
</read_first>
<action>
Move the `runpodApi.startPod` and `runpodApi.waitForPodReady` logic blocks out of Step 5 (SYNTHESIZE) and inject them at Phase 0 (Initialization). Specifically, right after parsing the settings and determining `isCosyVoice` (around Line 79), asynchronously trigger `startPod(env.RUNPOD_POD_ID)` but don't strictly halt the CPU unless the subsequent steps finish *faster* than the boot sequence. Wait, since `waitForPodReady` stalls the Node process, execute `startPod` asynchronously immediately, then await `waitForPodReady` just before Step 5 SYNTHESIZE actually requires it.
</action>
<acceptance_criteria>
- `app/services/pipeline.server.ts` exposes `runpodApi.startPod` without waiting inside the initiation block, and `await`s the ready check before fetching generation URLs.
</acceptance_criteria>
</task>

<task>
<description>
Guard the Shutdown routine with Queue lengths.
</description>
<read_first>
- app/services/pipeline.server.ts
- app/services/worker.server.ts
</read_first>
<action>
Export a function `getQueueLength(QUEUE_NAME)` inside `worker.server.ts` using `SELECT count(*) FROM pgmq.q_translation_process` (or checking the `Translation` Prisma table for `status === "PENDING"`). In the `finally` block of `pipeline.server.ts`, wrap the `stopPod` command with a check. If `pendingCount > 0`, skip the shutdown logic and log `[pipeline] Pending jobs found, keeping GPU warm`.
</action>
<acceptance_criteria>
- Queue checks occur in `pipeline.server` before `stopPod`.
</acceptance_criteria>
</task>

<task>
<description>
Add an hour-long Idle watchdog to the Worker process.
</description>
<read_first>
- app/services/worker.server.ts
- app/services/runpod-api.server.ts
</read_first>
<action>
In `worker.server.ts`, add a `setInterval` that fires every 10 minutes. It should query Prisma: `db.translation.findMany({ where: { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } })`. If any such stale executions exist, log a warning, trigger `runpodApi.stopPod(env.RUNPOD_POD_ID)`, and optionally mark the stalled DB records as `FAILED` with error `Unrecoverable Execution Timeout (1hr) also add a 30min wait if there is no job in the queue before shutting down the pod`.
</action>
<acceptance_criteria>
- `setInterval` cleanly executes staleness checks and fires `stopPod` when thresholds exceed 1 hour.
</acceptance_criteria>
</task>

## Verification

- Confirm that uploading a job immediately triggers the RunPod console status to `RUNNING` before AssemblyAI even finishes transcribing.
- Stacking 2 translation tasks in quick succession handles gracefully without the first job illegally shutting down the Pod while the second job is waiting.
- Forcing a database timestamp artificially past a 1-hour marker successfully intercepts and forces `stopPod` during background maintenance cycles.
