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
const PHASES = ['ideate', 'ended']

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

function sanitizeText(value = '', limit = 512) {
  return value.trim().slice(0, limit)
}

function isAdminParticipant(participant) {
  return participant?.role === 'admin'
}

function generateId() {
  return randomUUID()
}

function ensureParticipant(room, participantId) {
  return (room.participants ?? []).find((participant) => participant.id === participantId)
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
    topic: roomDoc.topic ?? null,
    phase: roomDoc.phase ?? 'ideate',
    phaseEndsAt: roomDoc.phaseEndsAt ?? null,
    ideas: roomDoc.ideas ?? [],
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
          id: generateId(),
          name: adminName,
          role: 'admin',
          joinedAt: now,
        },
      ],
      topic: {
        title: 'Untitled ideation',
        createdAt: now,
        createdById: null,
      },
      phase: 'ideate',
      phaseEndsAt: null,
      ideas: [],
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
        id: generateId(),
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

app.get('/api/rooms/:code/stream', async (req, res) => {
  try {
    const normalizedCode = normalizeCode(req.params.code)
    const participantId = sanitizeId(req.query?.participantId)

    if (!participantId) {
      return res.status(400).json({ message: 'Participant id required' })
    }

    const room = await roomsCollection.findOne({ code: normalizedCode })

    if (!room) {
      return res.status(404).json({ message: 'Room not found' })
    }

    const member = (room.participants ?? []).find((participant) => participant.id === participantId)

    if (!member) {
      return res.status(403).json({ message: 'Not part of this room' })
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const sendEvent = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    sendEvent({ type: 'init', room: formatRoom(room) })

    let latestAdminName = room.adminName

    const pipeline = [{ $match: { 'fullDocument._id': room._id } }]
    const changeStream = roomsCollection.watch(pipeline, { fullDocument: 'updateLookup' })

    changeStream.on('change', (change) => {
      if (change.operationType === 'delete') {
        sendEvent({ type: 'closed', adminName: latestAdminName })
        changeStream.close()
        res.end()
        return
      }

      if (change.fullDocument) {
        latestAdminName = change.fullDocument.adminName
        sendEvent({ type: 'update', room: formatRoom(change.fullDocument) })
      }
    })

    changeStream.on('error', (error) => {
      console.error('Stream error', error)
      sendEvent({ type: 'error', message: 'Stream disconnected' })
      changeStream.close()
      res.end()
    })

    req.on('close', () => {
      changeStream.close()
    })
  } catch (error) {
    console.error('Error establishing room stream', error)
    return res.status(500).json({ message: 'Unable to stream room updates' })
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

    const hostParticipant = (room.participants ?? []).find(isAdminParticipant)

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

app.delete('/api/rooms/:code/participants/:participantId', async (req, res) => {
  try {
    const normalizedCode = normalizeCode(req.params.code)
    const participantId = sanitizeId(req.params.participantId)
    const adminId = sanitizeId(req.body?.adminId)

    if (!participantId) {
      return res.status(400).json({ message: 'Participant id required' })
    }

    if (!adminId) {
      return res.status(400).json({ message: 'Admin id required' })
    }

    const room = await roomsCollection.findOne({ code: normalizedCode })

    if (!room) {
      return res.status(404).json({ message: 'Room not found' })
    }

    const hostParticipant = (room.participants ?? []).find(isAdminParticipant)

    if (hostParticipant?.id !== adminId) {
      return res.status(403).json({ message: 'Only the host can remove participants' })
    }

    if (participantId === adminId) {
      return res.status(400).json({ message: 'Host cannot remove themselves here' })
    }

    const updateResult = await roomsCollection.updateOne(
      { _id: room._id },
      {
        $pull: { participants: { id: participantId } },
        $set: { updatedAt: new Date() },
      },
    )

    if (updateResult.modifiedCount === 0) {
      return res.status(404).json({ message: 'Participant not found in room' })
    }

    return res.status(200).json({ message: 'Participant removed' })
  } catch (error) {
    console.error('Error removing participant', error)
    return res.status(500).json({ message: 'Unable to remove participant' })
  }
})

app.post('/api/rooms/:code/topic', async (req, res) => {
  try {
    const normalizedCode = normalizeCode(req.params.code)
    const adminId = sanitizeId(req.body?.adminId)
    const topicTitle = sanitizeText(req.body?.title, 140)

    if (!adminId || !topicTitle) {
      return res.status(400).json({ message: 'Admin id and topic title are required' })
    }

    const room = await roomsCollection.findOne({ code: normalizedCode })
    if (!room) {
      return res.status(404).json({ message: 'Room not found' })
    }

    const hostParticipant = (room.participants ?? []).find(isAdminParticipant)
    if (hostParticipant?.id !== adminId) {
      return res.status(403).json({ message: 'Only the host can set the topic' })
    }

    await roomsCollection.updateOne(
      { _id: room._id },
      {
        $set: {
          topic: {
            title: topicTitle,
            createdAt: new Date(),
            createdById: adminId,
          },
          updatedAt: new Date(),
        },
      },
    )

    const updatedRoom = await roomsCollection.findOne({ _id: room._id })
    return res.status(200).json({ room: formatRoom(updatedRoom), message: 'Topic updated' })
  } catch (error) {
    console.error('Error updating topic', error)
    return res.status(500).json({ message: 'Unable to update topic' })
  }
})

app.post('/api/rooms/:code/ideas', async (req, res) => {
  try {
    const normalizedCode = normalizeCode(req.params.code)
    const participantId = sanitizeId(req.body?.participantId)
    const ideaTitle = sanitizeText(req.body?.title, 140)
    const ideaDescription = sanitizeText(req.body?.description, 1000)

    if (!participantId || !ideaTitle || !ideaDescription) {
      return res.status(400).json({ message: 'Participant, title, and description are required' })
    }

    const room = await roomsCollection.findOne({ code: normalizedCode })
    if (!room) {
      return res.status(404).json({ message: 'Room not found' })
    }

    const participant = ensureParticipant(room, participantId)
    if (!participant) {
      return res.status(403).json({ message: 'You are not part of this room' })
    }

    if (room.phase === 'ended') {
      return res.status(400).json({ message: 'Session ended, details locked' })
    }

    if (room.phase === 'ended') {
      return res.status(400).json({ message: 'This session has ended' })
    }

    const participantIsAdmin = participant.role === 'admin'
    const participantIdeaCount = (room.ideas ?? []).filter((idea) => idea.authorId === participantId).length

    if (!participantIsAdmin && participantIdeaCount >= 3) {
      return res.status(400).json({ message: 'You already submitted 3 ideas' })
    }

    const idea = {
      id: generateId(),
      title: ideaTitle,
      description: ideaDescription,
      authorId: participantId,
      authorName: participant.name,
      createdAt: new Date(),
      votes: [],
      details: [],
    }

    await roomsCollection.updateOne(
      { _id: room._id },
      {
        $push: { ideas: idea },
        $set: { updatedAt: new Date() },
      },
    )

    const updatedRoom = await roomsCollection.findOne({ _id: room._id })
    return res.status(201).json({ room: formatRoom(updatedRoom), message: 'Idea captured' })
  } catch (error) {
    console.error('Error adding idea', error)
    return res.status(500).json({ message: 'Unable to add idea' })
  }
})

app.post('/api/rooms/:code/ideas/:ideaId/vote', async (req, res) => {
  try {
    const normalizedCode = normalizeCode(req.params.code)
    const ideaId = sanitizeId(req.params.ideaId)
    const participantId = sanitizeId(req.body?.participantId)

    if (!participantId) {
      return res.status(400).json({ message: 'Participant id is required' })
    }

    const room = await roomsCollection.findOne({ code: normalizedCode })
    if (!room) {
      return res.status(404).json({ message: 'Room not found' })
    }

    if (!ensureParticipant(room, participantId)) {
      return res.status(403).json({ message: 'You are not part of this room' })
    }

    if (room.phase === 'ended') {
      return res.status(400).json({ message: 'Voting closed' })
    }

    const idea = (room.ideas ?? []).find((entry) => entry.id === ideaId)
    if (!idea) {
      return res.status(404).json({ message: 'Idea not found' })
    }

    if ((idea.votes ?? []).includes(participantId)) {
      return res.status(400).json({ message: 'You already voted on this idea' })
    }

    await roomsCollection.updateOne(
      { _id: room._id, 'ideas.id': ideaId },
      {
        $push: { 'ideas.$.votes': participantId },
        $set: { updatedAt: new Date() },
      },
    )

    const updatedRoom = await roomsCollection.findOne({ _id: room._id })
    return res.status(200).json({ room: formatRoom(updatedRoom), message: 'Vote recorded' })
  } catch (error) {
    console.error('Error voting for idea', error)
    return res.status(500).json({ message: 'Unable to vote for idea' })
  }
})

app.post('/api/rooms/:code/ideas/:ideaId/details', async (req, res) => {
  try {
    const normalizedCode = normalizeCode(req.params.code)
    const ideaId = sanitizeId(req.params.ideaId)
    const participantId = sanitizeId(req.body?.participantId)
    const detailText = sanitizeText(req.body?.text, 280)

    if (!participantId || !detailText) {
      return res.status(400).json({ message: 'Participant and detail text are required' })
    }

    const room = await roomsCollection.findOne({ code: normalizedCode })
    if (!room) {
      return res.status(404).json({ message: 'Room not found' })
    }

    const participant = ensureParticipant(room, participantId)
    if (!participant) {
      return res.status(403).json({ message: 'You are not part of this room' })
    }

    const detail = {
      id: generateId(),
      text: detailText,
      authorId: participantId,
      authorName: participant.name,
      createdAt: new Date(),
    }

    await roomsCollection.updateOne(
      { _id: room._id, 'ideas.id': ideaId },
      {
        $push: { 'ideas.$.details': detail },
        $set: { updatedAt: new Date() },
      },
    )

    const updatedRoom = await roomsCollection.findOne({ _id: room._id })
    return res.status(200).json({ room: formatRoom(updatedRoom), message: 'Detail added' })
  } catch (error) {
    console.error('Error adding idea detail', error)
    return res.status(500).json({ message: 'Unable to add detail' })
  }
})

app.post('/api/rooms/:code/phase', async (req, res) => {
  try {
    const normalizedCode = normalizeCode(req.params.code)
    const adminId = sanitizeId(req.body?.adminId)
    const requestedPhase = sanitizeName(req.body?.phase).toLowerCase()

    if (!adminId || !PHASES.includes(requestedPhase)) {
      return res.status(400).json({ message: 'Valid phase and admin id are required' })
    }

    const room = await roomsCollection.findOne({ code: normalizedCode })
    if (!room) {
      return res.status(404).json({ message: 'Room not found' })
    }

    const hostParticipant = (room.participants ?? []).find(isAdminParticipant)
    if (hostParticipant?.id !== adminId) {
      return res.status(403).json({ message: 'Only the host can change the phase' })
    }

    await roomsCollection.updateOne(
      { _id: room._id },
      {
        $set: {
          phase: requestedPhase,
          phaseEndsAt: req.body?.phaseEndsAt ? new Date(req.body.phaseEndsAt) : null,
          updatedAt: new Date(),
        },
      },
    )

    const updatedRoom = await roomsCollection.findOne({ _id: room._id })
    return res.status(200).json({ room: formatRoom(updatedRoom), message: 'Phase updated' })
  } catch (error) {
    console.error('Error updating phase', error)
    return res.status(500).json({ message: 'Unable to update phase' })
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
