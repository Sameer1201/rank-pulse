---
name: Workflow startup permissions
description: A Replit workflow startup constraint for shell entrypoint scripts.
---

Workflow entrypoint scripts need executable permissions in this environment, or the workflow command must invoke them through `bash`.

**Why:** A configured workflow can exist and still fail immediately with `Permission denied` before any application logs are produced.

**How to apply:** Check script permissions when a newly configured workflow fails before startup; prefer an explicit `bash` invocation when the script mode cannot be relied on.