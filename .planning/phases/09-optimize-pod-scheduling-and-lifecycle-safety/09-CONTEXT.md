# Phase 9: Optimize Pod Scheduling and Lifecycle Safety - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning
**Source:** User Directive (Issue Triage)

<domain>
## Phase Boundary

Optimize the execution pipeline for RunPod On-Demand Pods to maximize performance (masking boot times) and enforce strict cost constraints (idle shutdown thresholds and concurrency safety bounds).
</domain>

<decisions>
## Implementation Decisions

### Asynchronous Pre-Heating
- **Move Pod Resume:** The `startPod` operation and `waitForPodReady` validation must happen at the absolute beginning of the pipeline loop. This allows the GPU pod to boot up concurrently while the backend downloads source files, extracts audio, and hits the AssemblyAI transcription APIs, effectively masking the cold start.

### Queue Concurrency Safeties
- **Queue Check Before Shutdown:** The `finally` block of the pipeline cannot simply run `stopPod(podId)`. It must first check the queue to verify if there are other pending jobs for that specific engine. If there are other waiting jobs, leaving the compute node alive is necessary; otherwise, if the queue is strictly zero, shut it down.

### Idle State Timeout Enforcement
- **1-Hour Processing Cleanup:** Implement a background watchdog or timeout script that routinely checks the database for any jobs stuck in `PROCESSING` or stalled for more than 1 hour.
- **Fail-Safe Halts:** If a job exceeds the 1-hour margin, automatically shut down the associated Pod to prevent unbilled infinite loops.

</decisions>
