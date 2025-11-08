import type { FormEvent } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { UserMinus, Clock, ShieldAlert, Download, Timer, Trophy, TrendingUp, CheckCircle2, ListTodo, Target, Users, Tag, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

type Participant = {
  id: string
  name: string
  role: string
  joinedAt: string
}

type RoomPhase = 'ideate' | 'ended' | 'planning'

type Topic = {
  title: string
  createdAt: string
  createdById: string | null
}

type IdeaDetail = {
  id: string
  text: string
  authorId: string
  authorName: string
  createdAt: string
}

type ActionItem = {
  id: string
  text: string
  completed: boolean
  assignedTo: string | null
  assignedToName: string | null
  tags: string[]
  createdBy: string
  createdByName: string
  createdAt: string
}

type BrainstormIdea = {
  id: string
  title: string
  description: string
  authorId: string
  authorName: string
  createdAt: string
  votes: string[]
  details: IdeaDetail[]
  actions: ActionItem[]
}

type Room = {
  id: string
  code: string
  roomName: string
  adminName: string
  participants: Participant[]
  createdAt: string
  updatedAt: string
  topic: Topic | null
  phase: RoomPhase
  phaseEndsAt?: string | null
  ideas: BrainstormIdea[]
}

type ApiRoomResponse = {
  room: Room
  message?: string
}

type StatusState = { type: 'idle' | 'success' | 'error'; message?: string }

type Session = {
  roomCode: string
  participantId: string
  name: string
  role: 'admin' | 'participant'
}

type SessionContextValue = {
  session: Session | null
  setSession: (value: Session | null) => void
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'
const SESSION_KEY = 'idea-planner-session'

const initialFormState = {
  adminName: '',
  roomName: '',
  participantName: '',
  roomCode: '',
}

const SessionContext = createContext<SessionContextValue>({
  session: null,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setSession: () => {},
})

function useSession() {
  return useContext(SessionContext)
}

async function apiRequest<T>(path: string, options?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  })

  const payload = (await response.json().catch(() => ({}))) as ApiRoomResponse & {
    message?: string
  }

  if (!response.ok) {
    throw new Error(payload.message || 'Unexpected server response')
  }

  return payload as T
}

function readStoredSession(): Session | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Session
  } catch (error) {
    console.warn('Failed to parse stored session', error)
    return null
  }
}

function persistSession(next: Session | null) {
  if (typeof window === 'undefined') return
  if (!next) {
    window.localStorage.removeItem(SESSION_KEY)
    return
  }
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(next))
}

function normalizeName(value: string) {
  return value.trim().toLowerCase()
}

function findParticipantIdentity(room: Room, name: string, roleHint?: 'admin' | 'participant') {
  const targetName = normalizeName(name)
  const participants = room.participants ?? []

  if (roleHint) {
    const targeted = participants.find(
      (participant) => normalizeName(participant.name) === targetName && participant.role === roleHint,
    )
    if (targeted) {
      return targeted
    }
  }

  return participants.find((participant) => normalizeName(participant.name) === targetName)
}

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/)
  const fallback = parts.slice(0, 2).map((segment) => segment.at(0)?.toUpperCase() ?? '').join('')
  return fallback || '•'
}

function InputField(
  props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; id: string },
) {
  const { label, id, ...rest } = props
  return (
    <label className="flex flex-col gap-2 text-left text-sm font-medium text-muted-foreground" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        className="h-11 rounded-xl border border-border bg-background px-4 text-base text-foreground shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        {...rest}
      />
    </label>
  )
}

function Lobby() {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [formValues, setFormValues] = useState(initialFormState)
  const [status, setStatus] = useState<StatusState>({ type: 'idle' })
  const [pendingAction, setPendingAction] = useState<'create' | 'join' | null>(null)
  const navigate = useNavigate()
  const { setSession } = useSession()

  function updateField(field: keyof typeof initialFormState, value: string) {
    setFormValues((prev) => ({ ...prev, [field]: value }))
  }

  function storeSession(room: Room, name: string, role: 'admin' | 'participant') {
    const identity = findParticipantIdentity(room, name, role)
    if (!identity) {
      throw new Error('Unable to locate your participant record')
    }

    const nextSession: Session = {
      roomCode: room.code,
      participantId: identity.id,
      name: identity.name,
      role: identity.role === 'admin' ? 'admin' : 'participant',
    }

    setSession(nextSession)
    navigate(`/rooms/${room.code}`)
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPendingAction('create')
    setStatus({ type: 'idle' })

    try {
      const { room, message } = await apiRequest<ApiRoomResponse>('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          adminName: formValues.adminName,
          roomName: formValues.roomName,
        }),
      })

      storeSession(room, formValues.adminName, 'admin')
      setStatus({ type: 'success', message: message || 'Room ready. Redirecting…' })
    } catch (error) {
      const fallback = error instanceof Error ? error.message : 'Unable to create room'
      setStatus({ type: 'error', message: fallback })
    } finally {
      setPendingAction(null)
    }
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPendingAction('join')
    setStatus({ type: 'idle' })

    try {
      const { room, message } = await apiRequest<ApiRoomResponse>('/api/rooms/join', {
        method: 'POST',
        body: JSON.stringify({
          code: formValues.roomCode,
          participantName: formValues.participantName,
        }),
      })

      storeSession(room, formValues.participantName, 'participant')
      setStatus({ type: 'success', message: message || 'Joining room…' })
    } catch (error) {
      const fallback = error instanceof Error ? error.message : 'Unable to join room'
      setStatus({ type: 'error', message: fallback })
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-10 px-4 py-12">
      <div className="space-y-4 text-center">
        <Badge variant="secondary" className="rounded-full px-4 py-1 text-xs uppercase tracking-wide">
          Phase one · Rooms
        </Badge>
        <div className="space-y-3">
          <h1 className="text-4xl font-semibold text-foreground">Host a private ideation room in seconds</h1>
          <p className="text-lg text-muted-foreground">
            Generate a five-letter key, invite your collaborators, and jump straight into planning when everyone arrives.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <Card className="border-white/10 bg-black/30 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-2xl">
              {mode === 'create' ? 'Create a new room' : 'Join with a room key'}
            </CardTitle>
            <CardDescription>
              {mode === 'create' ? 'Share the generated code with your team.' : 'Enter the code and your display name to join instantly.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex gap-2 rounded-lg bg-muted/40 p-1 text-sm text-muted-foreground">
              <Button
                type="button"
                variant={mode === 'create' ? 'default' : 'ghost'}
                className="flex-1"
                onClick={() => setMode('create')}
              >
                Host room
              </Button>
              <Button
                type="button"
                variant={mode === 'join' ? 'default' : 'ghost'}
                className="flex-1"
                onClick={() => setMode('join')}
              >
                Join room
              </Button>
            </div>

            <form className="space-y-4" onSubmit={mode === 'create' ? handleCreate : handleJoin}>
              {mode === 'create' ? (
                <>
                  <InputField
                    id="adminName"
                    label="Your name"
                    value={formValues.adminName}
                    onChange={(event) => updateField('adminName', event.target.value)}
                    placeholder="Jessie (host)"
                    required
                  />
                  <InputField
                    id="roomName"
                    label="Room title"
                    value={formValues.roomName}
                    onChange={(event) => updateField('roomName', event.target.value)}
                    placeholder="Lightning brainstorm"
                  />
                </>
              ) : (
                <>
                  <InputField
                    id="roomCode"
                    label="Room code"
                    value={formValues.roomCode}
                    onChange={(event) =>
                      updateField('roomCode', event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))
                    }
                    minLength={5}
                    maxLength={5}
                    placeholder="ABCDE"
                    required
                  />
                  <InputField
                    id="participantName"
                    label="Your name"
                    value={formValues.participantName}
                    onChange={(event) => updateField('participantName', event.target.value)}
                    placeholder="Taylor"
                    required
                  />
                </>
              )}

              <Button type="submit" className="w-full" disabled={pendingAction !== null}>
                {pendingAction === mode
                  ? 'Working…'
                  : mode === 'create'
                    ? 'Open the room'
                    : 'Join room'}
              </Button>

              {status.message && (
                <p className={cn('text-sm', status.type === 'error' ? 'text-destructive' : 'text-emerald-400')}>
                  {status.message}
                </p>
              )}
            </form>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-black/40 backdrop-blur">
          <CardHeader>
            <CardTitle>How it flows</CardTitle>
            <CardDescription>Everyone lands inside the same planning canvas once the room is open.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div>
              <p className="font-semibold text-foreground">30-second spark</p>
              <p>Kick off with rapid-fire ideas seeded by the host prompt.</p>
            </div>
            <Separator className="border-border/40" />
            <div>
              <p className="font-semibold text-foreground">Voting & clustering</p>
              <p>Pick top ideas, merge duplicates, and spotlight what matters.</p>
            </div>
            <Separator className="border-border/40" />
            <div>
              <p className="font-semibold text-foreground">Deep dive canvas</p>
              <p>Expand sub-ideas, assign owners, and prep the summary handoff.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function RoomScreen() {
  const { session, setSession } = useSession()
  const navigate = useNavigate()
  const params = useParams<{ code: string }>()
  const normalizedCode = (params.code ?? '').toUpperCase()
  const [room, setRoom] = useState<Room | null>(null)
  const [status, setStatus] = useState<StatusState>({ type: 'idle' })
  const [loading, setLoading] = useState(true)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [pendingAction, setPendingAction] = useState<'end' | 'leave' | null>(null)
  const [removalTarget, setRemovalTarget] = useState<string | null>(null)
  const [modalNotice, setModalNotice] = useState<{ title: string; message: string } | null>(null)
  const [latestHost, setLatestHost] = useState<string>('the host')
  const [currentTime, setCurrentTime] = useState(() => new Date())
  const [ideaInputs, setIdeaInputs] = useState({ title: '', description: '' })
  const [detailDrafts, setDetailDrafts] = useState<Record<string, string>>({})
  const [actionDrafts, setActionDrafts] = useState<Record<string, { text: string; assignedTo: string; tags: string[] }>>({})
  const [ideaPending, setIdeaPending] = useState(false)
  const [phasePending, setPhasePending] = useState(false)
  const [voteTarget, setVoteTarget] = useState<string | null>(null)
  const [detailTarget, setDetailTarget] = useState<string | null>(null)
  const [actionTarget, setActionTarget] = useState<string | null>(null)

  const invalidSession = !session || session.roomCode !== normalizedCode
  const participants = room?.participants ?? []
  const participantCount = participants.length
  const isAdmin = session?.role === 'admin'
  const ideas = room?.ideas ?? []
  const phase = (room?.phase ?? 'ideate') as RoomPhase
  const topicTitle = room?.topic?.title ?? 'Untitled ideation'
  const userIdeaCount = session ? ideas.filter((idea) => idea.authorId === session.participantId).length : 0
  const userIdeaLimitReached = !isAdmin && userIdeaCount >= 3

  const formattedTime = useMemo(
    () => currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    [currentTime],
  )

  const topIdea = useMemo(() => {
    if (!ideas.length) return null
    return [...ideas].sort((a, b) => b.votes.length - a.votes.length)[0]
  }, [ideas])

  const votingStats = useMemo(() => {
    const totalVotes = ideas.reduce((sum, idea) => sum + idea.votes.length, 0)
    const sortedIdeas = [...ideas].sort((a, b) => b.votes.length - a.votes.length)
    const maxVotes = sortedIdeas[0]?.votes.length || 0
    
    return {
      totalVotes,
      sortedIdeas,
      maxVotes,
      participantVoteCount: ideas.filter(idea => 
        idea.votes.includes(session?.participantId ?? '')
      ).length,
    }
  }, [ideas, session?.participantId])

  useEffect(() => {
    if (room?.adminName) {
      setLatestHost(room.adminName)
    }
  }, [room?.adminName])

  useEffect(() => {
    if (modalNotice) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [modalNotice])

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])


  useEffect(() => {
    if (invalidSession || !normalizedCode) return

    let cancelled = false
    async function loadRoom() {
      setLoading(true)
      try {
        const { room: fetchedRoom } = await apiRequest<ApiRoomResponse>(`/api/rooms/${normalizedCode}`)

        if (session && !fetchedRoom.participants.some((participant) => participant.id === session.participantId)) {
          setStatus({ type: 'error', message: 'You are no longer part of this room.' })
          setSession(null)
          navigate('/', { replace: true })
          return
        }

        if (!cancelled) {
          setRoom(fetchedRoom)
          setLoading(false)
        }
      } catch (error) {
        const fallback = error instanceof Error ? error.message : 'Unable to load room'
        setStatus({ type: 'error', message: fallback })
        setLoading(false)
      }
    }

    loadRoom()

    return () => {
      cancelled = true
    }
  }, [invalidSession, navigate, normalizedCode, session?.participantId, setSession])

  useEffect(() => {
    if (!session?.participantId || invalidSession) return

    const streamUrl = new URL(`${API_BASE_URL}/api/rooms/${normalizedCode}/stream`)
    streamUrl.searchParams.set('participantId', session.participantId)

    const eventSource = new EventSource(streamUrl.toString())

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          type?: string
          room?: Room
          message?: string
          adminName?: string
        }

        if (payload.room?.adminName) {
          setLatestHost(payload.room.adminName)
        }

        if (payload.type === 'closed') {
          setModalNotice({
            title: 'Room ended',
            message: `${payload.adminName || latestHost || 'The host'} closed this room.`,
          })
          eventSource.close()
          return
        }

        if (payload.room) {
          const stillPresent = payload.room.participants.some(
            (participant) => participant.id === session?.participantId,
          )

          if (!stillPresent) {
            setModalNotice({
              title: 'Removed from room',
              message: `${payload.room.adminName || latestHost || 'The host'} removed you from this room.`,
            })
            eventSource.close()
            return
          }

          setRoom(payload.room)
          setCopyState('idle')
        }
      } catch (streamError) {
        console.error('Failed to parse stream payload', streamError)
      }
    }

    eventSource.onerror = () => {
      setStatus({ type: 'error', message: 'Connection hiccup. Reconnecting…' })
    }

    return () => {
      eventSource.close()
    }
  }, [invalidSession, latestHost, navigate, normalizedCode, session?.participantId, setSession])

  if (invalidSession) {
    return null
  }

  async function handleCopyCode() {
    if (!room) return
    try {
      await navigator.clipboard.writeText(room.code)
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 1800)
    } catch (error) {
      const fallback = error instanceof Error ? error.message : 'Unable to copy code'
      setStatus({ type: 'error', message: fallback })
    }
  }

  async function handleEndRoom() {
    if (!room || !session) return
    setPendingAction('end')
    setStatus({ type: 'idle' })

    try {
      const { message } = await apiRequest<{ message: string }>(`/api/rooms/${room.code}`, {
        method: 'DELETE',
        body: JSON.stringify({ adminId: session.participantId }),
      })

      setStatus({ type: 'success', message: message || 'Room closed' })
      setSession(null)
      navigate('/', { replace: true })
    } catch (error) {
      const fallback = error instanceof Error ? error.message : 'Unable to end room'
      setStatus({ type: 'error', message: fallback })
    } finally {
      setPendingAction(null)
    }
  }

  async function handleLeaveMeeting() {
    if (!room || !session) return
    setPendingAction('leave')
    setStatus({ type: 'idle' })

    try {
      setStatus({ type: 'success', message: 'Left the session' })
      setSession(null)
      navigate('/', { replace: true })
    } catch (error) {
      const fallback = error instanceof Error ? error.message : 'Unable to leave meeting'
      setStatus({ type: 'error', message: fallback })
    } finally {
      setPendingAction(null)
    }
  }

  async function handleRemoveParticipant(participantId: string) {
    if (!room || !session) return
    setRemovalTarget(participantId)
    setStatus({ type: 'idle' })

    try {
      await apiRequest<{ message: string }>(`/api/rooms/${room.code}/participants/${participantId}`, {
        method: 'DELETE',
        body: JSON.stringify({ adminId: session.participantId }),
      })
    } catch (error) {
      const fallback = error instanceof Error ? error.message : 'Unable to remove participant'
      setStatus({ type: 'error', message: fallback })
    } finally {
      setRemovalTarget(null)
    }
  }

  // Topic update controls removed from UI; handler no longer needed.

  async function handleAddIdea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!room || !session) return
    setIdeaPending(true)
    try {
      const { room: updated } = await apiRequest<ApiRoomResponse>(`/api/rooms/${room.code}/ideas`, {
        method: 'POST',
        body: JSON.stringify({
          participantId: session.participantId,
          title: ideaInputs.title,
          description: ideaInputs.description,
        }),
      })
      setIdeaInputs({ title: '', description: '' })
      setRoom(updated)
    } catch (error) {
      const fallback = error instanceof Error ? error.message : 'Unable to submit idea'
      setStatus({ type: 'error', message: fallback })
    } finally {
      setIdeaPending(false)
    }
  }

  async function handleIdeaVote(ideaId: string) {
    if (!room || !session) return
    setVoteTarget(ideaId)
    try {
      const { room: updated } = await apiRequest<ApiRoomResponse>(`/api/rooms/${room.code}/ideas/${ideaId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ participantId: session.participantId }),
      })
      setRoom(updated)
    } catch (error) {
      const fallback = error instanceof Error ? error.message : 'Unable to vote on idea'
      setStatus({ type: 'error', message: fallback })
    } finally {
      setVoteTarget(null)
    }
  }

  async function handleAddDetail(ideaId: string) {
    if (!room || !session) return
    const draft = detailDrafts[ideaId]?.trim()
    if (!draft) return
    setDetailTarget(ideaId)
    try {
      const { room: updated } = await apiRequest<ApiRoomResponse>(`/api/rooms/${room.code}/ideas/${ideaId}/details`, {
        method: 'POST',
        body: JSON.stringify({ participantId: session.participantId, text: draft }),
      })
      setDetailDrafts((prev) => ({ ...prev, [ideaId]: '' }))
      setRoom(updated)
    } catch (error) {
      const fallback = error instanceof Error ? error.message : 'Unable to add detail'
      setStatus({ type: 'error', message: fallback })
    } finally {
      setDetailTarget(null)
    }
  }

  async function handleAddAction(ideaId: string) {
    if (!room || !session) return
    const draft = actionDrafts[ideaId]
    if (!draft?.text?.trim()) return
    setActionTarget(ideaId)
    try {
      const { room: updated } = await apiRequest<ApiRoomResponse>(`/api/rooms/${room.code}/ideas/${ideaId}/actions`, {
        method: 'POST',
        body: JSON.stringify({ 
          participantId: session.participantId, 
          text: draft.text,
          assignedTo: draft.assignedTo || null,
          tags: draft.tags.filter(t => t.trim())
        }),
      })
      setActionDrafts((prev) => ({ ...prev, [ideaId]: { text: '', assignedTo: '', tags: [] } }))
      setRoom(updated)
    } catch (error) {
      const fallback = error instanceof Error ? error.message : 'Unable to add action item'
      setStatus({ type: 'error', message: fallback })
    } finally {
      setActionTarget(null)
    }
  }

  async function handleToggleAction(ideaId: string, actionId: string) {
    if (!room || !session) return
    try {
      const { room: updated } = await apiRequest<ApiRoomResponse>(
        `/api/rooms/${room.code}/ideas/${ideaId}/actions/${actionId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ participantId: session.participantId }),
        }
      )
      setRoom(updated)
    } catch (error) {
      const fallback = error instanceof Error ? error.message : 'Unable to toggle action item'
      setStatus({ type: 'error', message: fallback })
    }
  }

  async function handlePhaseChange(nextPhase: RoomPhase, durationMinutes?: number) {
    if (!room || !session) return
    setPhasePending(true)
    try {
      const payload: { adminId: string; phase: RoomPhase; phaseEndsAt?: string } = {
        adminId: session.participantId,
        phase: nextPhase,
      }
      
      if (durationMinutes && durationMinutes > 0) {
        const endsAt = new Date(Date.now() + durationMinutes * 60 * 1000)
        payload.phaseEndsAt = endsAt.toISOString()
      }
      
      const { room: updated } = await apiRequest<ApiRoomResponse>(`/api/rooms/${room.code}/phase`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setRoom(updated)
    } catch (error) {
      const fallback = error instanceof Error ? error.message : 'Unable to change phase'
      setStatus({ type: 'error', message: fallback })
    } finally {
      setPhasePending(false)
    }
  }

  async function handleExportSummary() {
    if (!room) return
    try {
      window.open(`${API_BASE_URL}/api/rooms/${room.code}/export`, '_blank')
    } catch (error) {
      const fallback = error instanceof Error ? error.message : 'Unable to export summary'
      setStatus({ type: 'error', message: fallback })
    }
  }

  const timeRemaining = useMemo(() => {
    if (!room?.phaseEndsAt) return null
    const now = currentTime.getTime()
    const end = new Date(room.phaseEndsAt).getTime()
    const diff = end - now
    
    if (diff <= 0) return 'Time expired'
    
    const minutes = Math.floor(diff / 60000)
    const seconds = Math.floor((diff % 60000) / 1000)
    
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }, [room?.phaseEndsAt, currentTime])

  const stageTimeline = [
    { label: 'Ideate', value: 'ideate', description: 'Share ideas with a title and description', defaultMinutes: 5 },
    { label: 'Vote', value: 'ended', description: 'Ideas locked, voting only', defaultMinutes: 3 },
    { label: 'Plan', value: 'planning', description: 'Break down winner into action items', defaultMinutes: 10 },
  ] as const

  const canSubmitIdea =
    Boolean(session) &&
    ideaInputs.title.trim().length > 0 &&
    ideaInputs.description.trim().length > 0 &&
    (isAdmin || !userIdeaLimitReached) &&
    phase === 'ideate' &&
    !ideaPending

  const ideaHelperText = (() => {
    if (phase !== 'ideate') {
      return 'Idea submission is paused because the session ended.'
    }
    if (userIdeaLimitReached && !isAdmin) {
      return 'You have shared the maximum of 3 ideas for this session.'
    }
    return ''
  })()

  if (loading && !room) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading your room…</p>
      </div>
    )
  }

  // Controls toolbar icons removed per request.

  return (
    <>
      <div
        className={cn(
          'flex min-h-screen w-full flex-col gap-0 p-0',
          modalNotice && 'pointer-events-none blur-sm',
        )}
      >
        <div className="flex flex-1 flex-col gap-6 bg-black/30 p-6 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Room · {room?.code}</p>
              <h1 className="text-3xl font-semibold text-foreground">{topicTitle}</h1>
              <p className="text-sm text-muted-foreground">
                {room?.roomName || 'Keep everyone focused on the same ideation board.'}
              </p>
              {isAdmin ? null : (
                <p className="text-xs text-muted-foreground">Topic set by the host.</p>
              )}
            </div>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">People ({participantCount})</Button>
              </SheetTrigger>
              <SheetContent side="right" className="flex h-full flex-col gap-4 sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>People</SheetTitle>
                  <SheetDescription>{participantCount} in this room</SheetDescription>
                </SheetHeader>
                <Separator />
                <ScrollArea className="flex-1 pr-4">
                  <div className="space-y-3">
                    {participants.map((participant) => (
                      <Card
                        key={participant.id}
                        className={cn(
                          'border border-border/40 bg-background/60',
                          participant.id === session?.participantId && 'ring-1 ring-primary',
                        )}
                      >
                        <CardContent className="flex items-center justify-between gap-3 py-4">
                          <div className="flex items-center gap-4">
                            <Avatar className="h-12 w-12 border border-border/60">
                              <AvatarFallback>{initialsFromName(participant.name)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-sm font-medium leading-tight">{participant.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {participant.role === 'admin' ? 'Meeting host' : 'Contributor'}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {participant.id === session?.participantId && (
                              <Badge variant="secondary">You</Badge>
                            )}
                            {isAdmin && participant.id !== session?.participantId && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="gap-2 text-muted-foreground"
                                onClick={() => handleRemoveParticipant(participant.id)}
                                disabled={removalTarget === participant.id}
                              >
                                <UserMinus className="h-4 w-4" />
                                {removalTarget === participant.id ? 'Removing…' : 'Remove'}
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </SheetContent>
            </Sheet>
          </div>

        {status.message && status.type !== 'idle' && (
          <div
            className={cn(
              'rounded-full px-4 py-1 text-xs font-medium',
              status.type === 'error' ? 'bg-destructive/20 text-destructive' : 'bg-emerald-500/10 text-emerald-300',
            )}
          >
            {status.message}
          </div>
        )}

        <div className="flex flex-1 flex-col gap-6 min-h-0">
          <div className="grid flex-1 min-h-0 gap-6 items-stretch xl:grid-cols-2 xl:grid-rows-1">
          
          {/* Left Column - Voting Results (when ended) or Brainstorming Console */}
          {phase === 'ended' ? (
            <Card className="flex h-full flex-col rounded-[32px] border border-white/10 bg-black/40 backdrop-blur">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-primary" />
                      Voting Results
                    </CardTitle>
                    <CardDescription>Live leaderboard with vote distribution</CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="secondary" className="text-xs">
                      {votingStats.totalVotes} total vote{votingStats.totalVotes !== 1 ? 's' : ''}
                    </Badge>
                    {session && (
                      <span className="text-xs text-muted-foreground">
                        You voted {votingStats.participantVoteCount}×
                      </span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto space-y-3">
                {votingStats.sortedIdeas.length > 0 ? (
                  <>
                    {votingStats.sortedIdeas.map((idea, index) => {
                      const isWinner = index === 0 && idea.votes.length > 0
                      const votePercentage = votingStats.totalVotes > 0 
                        ? Math.round((idea.votes.length / votingStats.totalVotes) * 100) 
                        : 0
                      const hasVoted = idea.votes.includes(session?.participantId ?? '')
                      
                      return (
                        <div
                          key={idea.id}
                          className={cn(
                            'group relative overflow-hidden rounded-2xl border p-4 transition-all duration-300',
                            isWinner
                              ? 'border-yellow-500/50 bg-gradient-to-br from-yellow-500/20 via-yellow-500/10 to-transparent shadow-lg shadow-yellow-500/20'
                              : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                          )}
                        >
                          {/* Vote percentage bar background */}
                          <div
                            className={cn(
                              'absolute inset-0 transition-all duration-500',
                              isWinner ? 'bg-yellow-500/10' : 'bg-primary/5'
                            )}
                            style={{ 
                              width: `${votePercentage}%`,
                              opacity: 0.5 
                            }}
                          />
                          
                          <div className="relative flex items-start justify-between gap-4">
                            <div className="flex-1 space-y-2">
                              <div className="flex items-center gap-2">
                                {isWinner && (
                                  <Trophy className="h-5 w-5 text-yellow-500 animate-pulse" />
                                )}
                                <div className="flex items-center gap-2">
                                  <Badge 
                                    variant={index < 3 ? "default" : "secondary"} 
                                    className={cn(
                                      "h-6 w-6 rounded-full p-0 flex items-center justify-center",
                                      index === 0 && "bg-yellow-500 text-yellow-950",
                                      index === 1 && "bg-slate-400 text-slate-950",
                                      index === 2 && "bg-amber-700 text-amber-50"
                                    )}
                                  >
                                    {index + 1}
                                  </Badge>
                                  <h4 className="font-semibold text-foreground">
                                    {idea.title}
                                  </h4>
                                </div>
                              </div>
                              
                              <p className="text-xs text-muted-foreground">
                                by {idea.authorName} · {new Date(idea.createdAt).toLocaleTimeString([], { 
                                  hour: '2-digit', 
                                  minute: '2-digit' 
                                })}
                              </p>

                              {idea.details.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {idea.details.slice(0, 2).map((detail) => (
                                    <p key={detail.id} className="text-xs text-muted-foreground">
                                      <span className="font-medium text-foreground">{detail.authorName}:</span> {detail.text}
                                    </p>
                                  ))}
                                  {idea.details.length > 2 && (
                                    <p className="text-xs italic text-muted-foreground">
                                      +{idea.details.length - 2} more detail{idea.details.length - 2 !== 1 ? 's' : ''}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="flex flex-col items-end gap-2">
                              <div className="flex flex-col items-end">
                                <div className="flex items-center gap-2">
                                  <span className="text-2xl font-bold text-foreground">
                                    {idea.votes.length}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    vote{idea.votes.length !== 1 ? 's' : ''}
                                  </span>
                                </div>
                                {votePercentage > 0 && (
                                  <Badge variant="outline" className="text-xs">
                                    {votePercentage}%
                                  </Badge>
                                )}
                              </div>
                              
                              <Button
                                type="button"
                                size="sm"
                                variant={hasVoted ? "default" : "outline"}
                                className={cn(
                                  "gap-2 transition-all",
                                  hasVoted && "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border-emerald-500/50"
                                )}
                                disabled={voteTarget === idea.id || hasVoted}
                                onClick={() => handleIdeaVote(idea.id)}
                              >
                                {hasVoted ? (
                                  <>
                                    <CheckCircle2 className="h-3 w-3" />
                                    Voted
                                  </>
                                ) : (
                                  '+1 Vote'
                                )}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })}

                    {topIdea && topIdea.votes.length > 0 && (
                      <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                        <p className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
                          <Trophy className="h-4 w-4" />
                          Next Steps
                        </p>
                        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                          <li>Convert "{topIdea.title}" into actionable Kanban cards</li>
                          <li>Assign owners and break down implementation tasks</li>
                          <li>Schedule follow-up session to track progress</li>
                        </ol>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-2xl border border-white/5 bg-black/30 p-8 text-center">
                    <p className="text-muted-foreground">No ideas submitted yet. Start brainstorming to see the leaderboard!</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
          <Card className="flex h-full flex-col rounded-[32px] border border-white/10 bg-black/40 text-sm backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>Brainstorming console</span>
                <div className="flex items-center gap-2">
                  {timeRemaining && (
                    <Badge variant="outline" className="gap-1 text-xs">
                      <Timer className="h-3 w-3" />
                      {timeRemaining}
                    </Badge>
                  )}
                  <span className="rounded-full bg-primary/20 px-3 py-1 text-xs text-primary-foreground">
                    {phase === 'ideate' ? 'Ideating' : phase === 'ended' ? 'Voting' : 'Planning'}
                  </span>
                </div>
              </CardTitle>
              <CardDescription>
                {phase === 'ideate'
                  ? 'Collect raw ideas with a clear title and short description.'
                  : phase === 'ended'
                  ? 'Voting only – idea submission is locked.'
                  : 'Break down the winning idea into actionable tasks.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 flex-1 overflow-auto">
              <div className="grid gap-3 sm:grid-cols-3">
                {stageTimeline.map(({ label, value, description }) => (
                  <div
                    key={value}
                    className={cn(
                      'rounded-2xl border px-4 py-3',
                      phase === value
                        ? 'border-primary bg-primary/10 text-primary-foreground'
                        : 'border-white/10 bg-white/5 text-muted-foreground',
                    )}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
                    <p className="text-[0.8rem]">{description}</p>
                  </div>
                ))}
              </div>

              <form className="space-y-3" onSubmit={handleAddIdea}>
                <input
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  placeholder="Idea title"
                  value={ideaInputs.title}
                  onChange={(event) => setIdeaInputs((s) => ({ ...s, title: event.target.value }))}
                  disabled={phase !== 'ideate'}
                />
                <textarea
                  className="min-h-[120px] w-full rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  placeholder="Short description"
                  value={ideaInputs.description}
                  onChange={(event) => setIdeaInputs((s) => ({ ...s, description: event.target.value }))}
                  disabled={phase !== 'ideate'}
                />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="submit" disabled={!canSubmitIdea}>
                      {ideaPending ? 'Submitting…' : 'Submit idea'}
                    </Button>
                    {isAdmin && (
                      <div className="flex flex-wrap gap-2">
                        {stageTimeline.map(({ value, label, defaultMinutes }) => (
                        <Button
                          key={value}
                          type="button"
                          variant={phase === value ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => handlePhaseChange(value, defaultMinutes)}
                          disabled={phasePending}
                          className="gap-1"
                        >
                          {label} ({defaultMinutes}m)
                        </Button>
                      ))}
                    </div>
                  )}
                  {ideaHelperText && <span className="text-xs text-muted-foreground">{ideaHelperText}</span>}
                    {!isAdmin && (
                      <span className="text-xs text-muted-foreground">
                        {userIdeaCount}/3 ideas submitted
                      </span>
                    )}
                    {isAdmin && <span className="text-xs text-muted-foreground">Hosts can add unlimited ideas.</span>}
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
            
            {/* Right Column - Idea Vault */}
            <Card className="flex h-full flex-col rounded-[32px] border border-white/10 bg-black/40 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">Idea vault</CardTitle>
                <CardDescription>
                  Track every idea, add sub-details, and tap to vote during the decision round.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto">
                {ideas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ideas you add will show up here for everyone to react to.</p>
                ) : (
                  <div className="space-y-4">
                    {ideas.map((idea) => (
                      <div key={idea.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-base font-medium text-foreground">{idea.title}</p>
                            <p className="text-sm text-muted-foreground">{idea.description}</p>
                            <p className="text-xs text-muted-foreground">
                              {idea.authorName} · {new Date(idea.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                          {phase === 'ended' && (
                            <Badge 
                              variant="secondary" 
                              className="gap-1 whitespace-nowrap"
                            >
                              <TrendingUp className="h-3 w-3" />
                              {idea.votes.length} vote{idea.votes.length !== 1 ? 's' : ''}
                            </Badge>
                          )}
                        </div>
                        {idea.details.length > 0 && (
                          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                            {idea.details.map((detail) => (
                              <li key={detail.id}>
                                <span className="font-medium text-foreground">{detail.authorName}:</span> {detail.text}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <input
                            className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                            placeholder="Add sub-detail, attachment, or follow-up"
                            value={detailDrafts[idea.id] ?? ''}
                            onChange={(event) =>
                              setDetailDrafts((prev) => ({
                                ...prev,
                                [idea.id]: event.target.value,
                              }))
                            }
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!detailDrafts[idea.id]?.trim() || detailTarget === idea.id}
                            onClick={() => handleAddDetail(idea.id)}
                          >
                            {detailTarget === idea.id ? 'Adding…' : 'Add detail'}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Planning Phase - Action Plan for Winner */}
          {phase === 'planning' && topIdea && (
            <Card className="rounded-[32px] border-white/10 bg-black/40 backdrop-blur">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="h-5 w-5 text-primary" />
                      Action Plan: {topIdea.title}
                    </CardTitle>
                    <CardDescription>Break down the winning idea into actionable tasks</CardDescription>
                  </div>
                  <Badge variant="secondary" className="gap-1">
                    <Trophy className="h-3 w-3 text-yellow-500" />
                    Winner ({topIdea.votes.length} votes)
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Idea Summary */}
                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                  <h4 className="mb-2 font-semibold text-foreground">Summary</h4>
                  <p className="text-sm text-muted-foreground">{topIdea.description}</p>
                  {topIdea.details.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {topIdea.details.map((detail) => (
                        <p key={detail.id} className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{detail.authorName}:</span> {detail.text}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action Items */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="flex items-center gap-2 font-semibold text-foreground">
                      <ListTodo className="h-4 w-4" />
                      Action Items ({topIdea.actions?.length || 0})
                    </h4>
                  </div>

                  {topIdea.actions && topIdea.actions.length > 0 && (
                    <div className="space-y-2">
                      {topIdea.actions.map((action) => (
                        <div
                          key={action.id}
                          className={cn(
                            'group rounded-xl border border-white/10 bg-white/5 p-3 transition-all',
                            action.completed && 'opacity-60'
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <button
                              type="button"
                              onClick={() => handleToggleAction(topIdea.id, action.id)}
                              className={cn(
                                'mt-0.5 h-5 w-5 rounded border-2 transition-all flex items-center justify-center',
                                action.completed
                                  ? 'border-emerald-500 bg-emerald-500'
                                  : 'border-muted-foreground hover:border-primary'
                              )}
                            >
                              {action.completed && <CheckCircle2 className="h-3 w-3 text-white" />}
                            </button>
                            
                            <div className="flex-1 space-y-1">
                              <p className={cn(
                                'text-sm text-foreground',
                                action.completed && 'line-through'
                              )}>
                                {action.text}
                              </p>
                              
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>by {action.createdByName}</span>
                                {action.assignedToName && (
                                  <Badge variant="outline" className="gap-1 text-xs">
                                    <Users className="h-3 w-3" />
                                    {action.assignedToName}
                                  </Badge>
                                )}
                                {action.tags && action.tags.length > 0 && (
                                  <div className="flex gap-1">
                                    {action.tags.map((tag, i) => (
                                      <Badge key={i} variant="secondary" className="gap-1 text-xs">
                                        <Tag className="h-2 w-2" />
                                        {tag}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add Action Item Form */}
                  <div className="rounded-xl border border-white/10 bg-black/30 p-4 space-y-3">
                    <input
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                      placeholder="Action item description..."
                      value={actionDrafts[topIdea.id]?.text ?? ''}
                      onChange={(event) =>
                        setActionDrafts((prev) => ({
                          ...prev,
                          [topIdea.id]: {
                            ...prev[topIdea.id],
                            text: event.target.value,
                            assignedTo: prev[topIdea.id]?.assignedTo ?? '',
                            tags: prev[topIdea.id]?.tags ?? [],
                          },
                        }))
                      }
                    />
                    
                    <div className="flex flex-wrap gap-2">
                      <select
                        className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                        value={actionDrafts[topIdea.id]?.assignedTo ?? ''}
                        onChange={(event) =>
                          setActionDrafts((prev) => ({
                            ...prev,
                            [topIdea.id]: {
                              ...prev[topIdea.id],
                              text: prev[topIdea.id]?.text ?? '',
                              assignedTo: event.target.value,
                              tags: prev[topIdea.id]?.tags ?? [],
                            },
                          }))
                        }
                      >
                        <option value="">Assign to...</option>
                        {participants.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>

                      <Button
                        type="button"
                        size="sm"
                        disabled={!actionDrafts[topIdea.id]?.text?.trim() || actionTarget === topIdea.id}
                        onClick={() => handleAddAction(topIdea.id)}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        {actionTarget === topIdea.id ? 'Adding…' : 'Add Task'}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Statistics */}
                <div className="grid grid-cols-3 gap-4 rounded-xl border border-white/10 bg-black/30 p-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground">
                      {topIdea.actions?.length || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Total Tasks</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-emerald-400">
                      {topIdea.actions?.filter(a => a.completed).length || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Completed</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-primary">
                      {topIdea.actions?.filter(a => !a.completed).length || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Remaining</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          </div>

        </div>
        <div className="bg-black/40 p-4 backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>{formattedTime}</span>
              {room?.code && (
                <Button type="button" variant="ghost" size="sm" onClick={handleCopyCode} className="gap-2">
                  {copyState === 'copied' ? 'Copied' : 'Copy key'}
                  <Badge variant="secondary" className="text-xs uppercase tracking-[0.2em]">
                    {room.code}
                  </Badge>
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {ideas.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={handleExportSummary}
                >
                  <Download className="h-4 w-4" />
                  Export Summary
                </Button>
              )}
              {isAdmin && (
                <Button
                  type="button"
                  variant="destructive"
                  className="gap-2"
                  onClick={handleEndRoom}
                  disabled={pendingAction === 'end'}
                >
                  <ShieldAlert className="h-4 w-4" />
                  {pendingAction === 'end' ? 'Ending room…' : 'End room for everyone'}
                </Button>
              )}
              {!isAdmin && (
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2 border-destructive/50 text-destructive hover:bg-destructive/10"
                  onClick={handleLeaveMeeting}
                  disabled={pendingAction === 'leave'}
                >
                  <UserMinus className="h-4 w-4" />
                  {pendingAction === 'leave' ? 'Leaving…' : 'Leave meeting'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      {modalNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4" role="alertdialog" aria-modal="true">
          <Card className="w-full max-w-md border border-white/15 bg-background/95 p-8 shadow-2xl">
            <div className="space-y-4 text-left">
              <Badge variant="secondary" className="w-fit">
                {modalNotice.title}
              </Badge>
              <h3 className="text-2xl font-semibold text-foreground">{modalNotice.message}</h3>
              <p className="text-sm text-muted-foreground">
                You will return to the lobby once you acknowledge this message.
              </p>
              <Button
                className="w-full"
                onClick={() => {
                  setSession(null)
                  setModalNotice(null)
                  navigate('/', { replace: true })
                }}
              >
                Back to lobby
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  )
}

export default function App() {
  const [sessionState, setSessionState] = useState<Session | null>(() => readStoredSession())

  const handleSessionChange = useCallback((next: Session | null) => {
    setSessionState(next)
    persistSession(next)
  }, [])

  return (
    <SessionContext.Provider value={{ session: sessionState, setSession: handleSessionChange }}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Lobby />} />
          <Route path="/rooms/:code" element={<RoomScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionContext.Provider>
  )
}
