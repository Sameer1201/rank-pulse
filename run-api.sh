#!/bin/bash
export PATH=/nix/store/bl6iwirn83qj9r8wng43kfdqd5mfahj8-nodejs-22.22.0/bin:$PATH
export PORT=8080
export NODE_ENV=development
cd /home/runner/workspace
corepack pnpm --filter @workspace/api-server run build && corepack pnpm --filter @workspace/api-server run start
