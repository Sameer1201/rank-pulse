---
name: Workflow port ownership
description: Port conflicts caused by overlapping parent and artifact-managed workflows.
---

Keep one authoritative launcher for services that share fixed ports; do not start both a parent workflow's child services and separately registered artifact workflows for the same frontend/API.

**Why:** Restarting overlapping workflow groups can leave one process owning a port while another child reports failure with `EADDRINUSE`, even when the application itself is healthy.

**How to apply:** When a project has artifact-managed workflows plus a `.replit` parent workflow, make the primary launcher start each service once, and stop stale entries before restarting after configuration changes.