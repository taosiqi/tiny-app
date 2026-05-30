import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stdout } from 'node:process'

const output = readFileSync(resolve('.tmp/tinypress-fixtures/sample.png'))
const server = createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/shrink') {
    request.resume()
    response.writeHead(201, { 'content-type': 'application/json', 'compression-count': '12' })
    response.end(JSON.stringify({
      input: { size: output.length + 1024 },
      output: { size: output.length, url: 'http://127.0.0.1:18765/output.png' }
    }))
    return
  }
  if (request.method === 'GET' && request.url === '/output.png') {
    response.writeHead(200, { 'content-type': 'image/png' })
    response.end(output)
    return
  }
  response.writeHead(404)
  response.end()
})

server.listen(18765, '127.0.0.1', () => stdout.write('tinify mock ready\n'))
