import express from 'express'
import { WebSocketServer } from './src/network/WebSocketServer.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(express.json())

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

const wss = new WebSocketServer(server)

process.on('SIGTERM', () => {
  wss.close()
  server.close(() => process.exit(0))
})