import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const index = fileURLToPath(new URL('./index.html', import.meta.url))
const port = Number(process.env.PORT ?? 3000)

createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  createReadStream(index).pipe(response)
}).listen(port, '0.0.0.0', () => {
  console.log(`Listening on http://0.0.0.0:${port}`)
})
