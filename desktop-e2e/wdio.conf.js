import { resolve } from 'node:path'

export const config = {
  runner: 'local',
  specs: ['./specs/**/*.e2e.js'],
  maxInstances: 1,
  capabilities: [{
    maxInstances: 1,
    'tauri:options': {
      application: resolve('src-tauri/target/debug/tiny-app')
    }
  }],
  hostname: '127.0.0.1',
  port: 4444,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { timeout: 60000 }
}
