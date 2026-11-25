/**
 * The egress proxy for INSTALL steps (AD-7), run with Node inside its own container. It allows only HTTPS CONNECT
 * to the allow-listed registry hosts (PRR_ALLOW, comma-separated); everything else is refused. Product code,
 * passed inline with `node -e`.
 */
export const PROXY_SCRIPT = `import http from 'node:http'
import net from 'node:net'
const port = process.env.PRR_PORT || '3128'
const allow = new Set(String(process.env.PRR_ALLOW || '').split(',').filter(Boolean))
const server = http.createServer((req, res) => {
  res.writeHead(403)
  res.end('pr-reviewer sandbox: only HTTPS to the package registry is allowed\\n')
})
server.on('connect', (req, client, head) => {
  const [host, p] = String(req.url).split(':')
  if (!allow.has(host) || p !== '443') {
    client.end('HTTP/1.1 403 Forbidden\\r\\n\\r\\n')
    return
  }
  const upstream = net.connect(443, host, () => {
    client.write('HTTP/1.1 200 Connection Established\\r\\n\\r\\n')
    upstream.write(head)
    upstream.pipe(client)
    client.pipe(upstream)
  })
  upstream.on('error', () => client.destroy())
  client.on('error', () => upstream.destroy())
})
server.listen(Number(port), '0.0.0.0', () => console.log('ready'))
`
