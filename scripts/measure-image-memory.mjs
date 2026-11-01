// npm run measure:image-memory
// Runs test/image-memory.test.js with garbage collection exposed, so the
// peak memory of an image conversion done inside the Worker is measured
// (the regular test run skips that part). Cross-platform way of setting
// NODE_OPTIONS for the vitest worker processes.
import { spawnSync } from 'node:child_process'

const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'test/image-memory.test.js', '--pool=forks', '--reporter=verbose'],
  { stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --expose-gc`.trim() } }
)
process.exit(result.status ?? 1)
