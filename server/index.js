import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { randomUUID } from 'crypto'
import { MongoClient } from 'mongodb'

dotenv.config()

const PORT = Number(process.env.PORT) || 4000
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017'
const MONGO_DB = process.env.MONGO_DB || 'idea_planner'

const app = express()
app.use(cors())
app.use(express.json())

let client
let roomsCollection

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateRoomCode(length = 5) {
  let code = ''
  for (let i = 0; i < length; i += 1) {
    const randomIndex = Math.floor(Math.random() * LETTERS.length)
    code += LETTERS[randomIndex]
  }
  return code
}

function sanitizeName(value = '') {
  return value.trim().slice(0, 64)
}

function normalizeCode(value = '') {
  return sanitizeName(value).toUpperCase()
}

function sanitizeId(value = '') {
  return String(value ?? '').trim()
}

function formatRoom(roomDoc) {
  return {
    id: roomDoc._id.toString(),
    code: roomDoc.code,
    roomName: roomDoc.roomName,
    adminName: roomDoc.adminName,
    participants: roomDoc.participants ?? [],
    createdAt: roomDoc.createdAt,
    updatedAt: roomDoc.updatedAt,
  }
}

async function createRoomDocument({ adminName, roomName }) {
  const normalizedRoomName = roomName || 'Untitled Room'
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateRoomCode()
    const now = new Date()
    const doc = {
      code,
      roomName: normalizedRoomName,
      adminName,
      participants: [
        {
          id: randomUUID(),
          name: adminName,
          role: 'admin',
          joinedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    }

    try {
      const { insertedId } = await roomsCollection.insertOne(doc)
      return { ...doc, _id: insertedId }
    } catch (error) {
      const isDuplicateCode = error?.code === 11000
      if (!isDuplicateCode) {
        throw error
      }
    }
  }
  throw new Error('Failed to create unique room code, please retry')
}

app.post('/api/rooms', async (req, res) => {
  try {
    const rawAdminName = sanitizeName(req.body?.adminName)
    const rawRoomName = sanitizeName(req.body?.roomName)

    if (!rawAdminName) {
      return res.status(400).json({ message: 'Admin name is required' })
    }

    const room = await createRoomDocument({
      adminName: rawAdminName,
      roomName: rawRoomName || undefined,
    })

    return res.status(201).json({
      room: formatRoom(room),
      message: 'Room created successfully',
    })
  } catch (error) {
    console.error('Error creating room', error)
    return res
      .status(500)
      .json({ message: 'Unable to create room, please try again later' })
  }
})

app.post('/api/rooms/join', async (req, res) => {
  try {
    const normalizedCode = normalizeCode(req.body?.code)
    const participantName = sanitizeName(req.body?.participantName)

    if (!normalizedCode || normalizedCode.length !== 5) {
      return res.status(400).json({ message: 'Enter a valid 5-letter room code' })
    }

    if (!participantName) {
      return res.status(400).json({ message: 'Your name is required to join' })
    }

    const room = await roomsCollection.findOne({ code: normalizedCode })

    if (!room) {
      return res.status(404).json({ message: 'Room not found' })
    }

    const alreadyParticipant = (room.participants ?? []).some(
      (participant) => participant.name.toLowerCase() === participantName.toLowerCase(),
    )

    if (!alreadyParticipant) {
      const newParticipant = {
        id: randomUUID(),
        name: participantName,
        role: 'participant',
        joinedAt: new Date(),
      }

      await roomsCollection.updateOne(
        { _id: room._id },
        {
          $push: { participants: newParticipant },
          $set: { updatedAt: new Date() },
        },
      )

      room.participants = [...(room.participants ?? []), newParticipant]
    }

    return res.status(200).json({
      room: formatRoom(room),
      message: alreadyParticipant ? 'You are already in this room' : 'Joined room successfully',
    })
  } catch (error) {
    console.error('Error joining room', error)
    return res
      .status(500)
      .json({ message: 'Unable to join room, please try again later' })
  }
})

app.get('/api/rooms/:code', async (req, res) => {
  try {
    const normalizedCode = normalizeCode(req.params.code)

    if (!normalizedCode || normalizedCode.length !== 5) {
      return res.status(400).json({ message: 'Enter a valid 5-letter room code' })
    }

    const room = await roomsCollection.findOne({ code: normalizedCode })

    if (!room) {
      return res.status(404).json({ message: 'Room not found' })
    }

    return res.status(200).json({ room: formatRoom(room) })
  } catch (error) {
    console.error('Error fetching room', error)
    return res.status(500).json({ message: 'Unable to load room' })
  }
})

app.delete('/api/rooms/:code', async (req, res) => {
  try {
    const normalizedCode = normalizeCode(req.params.code)
    const adminId = sanitizeId(req.body?.adminId)

    if (!normalizedCode || normalizedCode.length !== 5) {
      return res.status(400).json({ message: 'Enter a valid 5-letter room code' })
    }

    if (!adminId) {
      return res.status(400).json({ message: 'Admin id is required' })
    }

    const room = await roomsCollection.findOne({ code: normalizedCode })

    if (!room) {
      return res.status(404).json({ message: 'Room not found' })
    }

    const hostParticipant = (room.participants ?? []).find(
      (participant) => participant.role === 'admin',
    )

    if (hostParticipant?.id !== adminId) {
      return res.status(403).json({ message: 'Only the host can end this room' })
    }

    await roomsCollection.deleteOne({ _id: room._id })

    return res.status(200).json({ message: 'Room ended and removed' })
  } catch (error) {
    console.error('Error ending room', error)
    return res.status(500).json({ message: 'Unable to end room, try again later' })
  }
})

async function start() {
  try {
    client = new MongoClient(MONGO_URI)
    await client.connect()
    const db = client.db(MONGO_DB)
    roomsCollection = db.collection('rooms')
    await roomsCollection.createIndex({ code: 1 }, { unique: true })

    app.listen(PORT, () => {
      console.log(`Idea Planner API running on http://localhost:${PORT}`)
    })
  } catch (error) {
    console.error('Failed to start server', error)
    process.exit(1)
  }
}

start()

process.on('SIGINT', async () => {
  await client?.close()
  process.exit(0)
})
