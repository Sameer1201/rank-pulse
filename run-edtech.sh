#!/bin/bash
export PATH=/nix/store/bl6iwirn83qj9r8wng43kfdqd5mfahj8-nodejs-22.22.0/bin:$PATH
export PORT=5000
cd /home/runner/workspace
corepack pnpm --filter @workspace/edtech run dev
