import type { FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import './App.css'

type Participant = {
  id: string
  name: string
  role: string
  joinedAt: string
}

type Room = {
  id: string
  code: string
  roomName: string
  adminName: string
  participants: Participant[]
  createdAt: string
  updatedAt: string
}

type ApiRoomResponse = {
  room: Room
  message?: string
}

type StatusState = { type: 'idle' | 'success' | 'error'; message?: string }

type CurrentUser = {
  id?: string
  name: string
  role: 'admin' | 'participant'
}

type ViewState = 'lobby' | 'planning'

type PendingAction = 'create' | 'join' | 'end' | null

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'

const initialFormState = {
  adminName: '',
  roomName: '',
  participantName: '',
  roomCode: '',
}

function App() {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [view, setView] = useState<ViewState>('lobby')
  const [formValues, setFormValues] = useState(initialFormState)
  const [activeRoom, setActiveRoom] = useState<Room | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [status, setStatus] = useState<StatusState>({ type: 'idle' })
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')

  const participantCount = useMemo(() => activeRoom?.participants.length ?? 0, [activeRoom])
  const guestCount = participantCount > 0 ? participantCount - 1 : 0
  const isAdmin = currentUser?.role === 'admin'

  useEffect(() => {
    setCopyState('idle')
  }, [activeRoom?.code])

  useEffect(() => {
    if (!activeRoom) {
      setView('lobby')
      setCurrentUser(null)
      setStatus({ type: 'idle' })
    }
  }, [activeRoom])

  function updateField(field: keyof typeof initialFormState, value: string) {
    setFormValues((prev) => ({ ...prev, [field]: value }))
  }

  async function request<T>(path: string, options: RequestInit) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    })

    const payload = (await response.json().catch(() => ({}))) as ApiRoomResponse & { message?: string }

    if (!response.ok) {
      throw new Error(payload.message || 'Unexpected server response')
    }

    return payload as T
  }

  function enterPlanning(room: Room, name: string, overrideRole?: 'admin' | 'participant') {
    const cleanName = name.trim()
    const derivedRole =
      overrideRole ||
      (cleanName.toLowerCase() === room.adminName.toLowerCase() ? 'admin' : 'participant')

    const participantMatch = room.participants.find(
      (participant) => participant.name.toLowerCase() === cleanName.toLowerCase(),
    )

    setActiveRoom(room)
    setCurrentUser({
      id: participantMatch?.id,
      name: cleanName || room.adminName,
      role: derivedRole,
    })
    setView('planning')
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPendingAction('create')
    setStatus({ type: 'idle' })

    try {
      const { room, message } = await request<ApiRoomResponse>('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          adminName: formValues.adminName,
          roomName: formValues.roomName,
        }),
      })

      enterPlanning(room, formValues.adminName, 'admin')
      setStatus({ type: 'success', message: message || 'Room is ready' })
      setFormValues((prev) => ({
        ...prev,
        roomCode: room.code,
      }))
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
      const { room, message } = await request<ApiRoomResponse>('/api/rooms/join', {
        method: 'POST',
        body: JSON.stringify({
          code: formValues.roomCode,
          participantName: formValues.participantName,
        }),
      })

      enterPlanning(room, formValues.participantName)
      setStatus({ type: 'success', message: message || 'Welcome to the room' })
    } catch (error) {
      const fallback = error instanceof Error ? error.message : 'Unable to join room'
      setStatus({ type: 'error', message: fallback })
    } finally {
      setPendingAction(null)
    }
  }

  async function handleEndRoom() {
    if (!activeRoom || !currentUser) return

    if (!currentUser.id) {
      setStatus({ type: 'error', message: 'Rejoin the room to refresh your host access.' })
      return
    }

    setPendingAction('end')
    setStatus({ type: 'idle' })

    try {
      const { message } = await request<{ message: string }>(`/api/rooms/${activeRoom.code}`, {
        method: 'DELETE',
        body: JSON.stringify({ adminId: currentUser.id }),
      })

      setStatus({ type: 'success', message: message || 'Room closed' })
      setActiveRoom(null)
      setFormValues(initialFormState)
    } catch (error) {
      const fallback = error instanceof Error ? error.message : 'Unable to end room'
      setStatus({ type: 'error', message: fallback })
    } finally {
      setPendingAction(null)
    }
  }

  async function handleCopyCode() {
    if (!activeRoom?.code) return
    try {
      await navigator.clipboard.writeText(activeRoom.code)
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 1800)
    } catch (error) {
      const fallback = error instanceof Error ? error.message : 'Unable to copy code'
      setStatus({ type: 'error', message: fallback })
    }
  }

  function leavePlanningView() {
    setView('lobby')
  }

  const showLobby = view === 'lobby' || !activeRoom

  return (
    <div className="app-shell">
      {showLobby ? (
        <div className="lobby-view">
          <header>
            <p className="eyebrow">Gather your crew</p>
            <h1>Host a private idea room in seconds</h1>
            <p className="lede">
              Share a five-letter key, welcome everyone into the same space, and glide straight into
              planning once the door closes.
            </p>
          </header>

          <div className="mode-toggle" role="tablist" aria-label="Room mode">
            <button
              type="button"
              className={mode === 'create' ? 'is-active' : ''}
              onClick={() => setMode('create')}
            >
              Create room
            </button>
            <button
              type="button"
              className={mode === 'join' ? 'is-active' : ''}
              onClick={() => setMode('join')}
            >
              Join room
            </button>
          </div>

          <section className="panel-grid">
            <form className="panel" onSubmit={mode === 'create' ? handleCreate : handleJoin}>
              {mode === 'create' ? (
                <>
                  <label>
                    <span>Your name</span>
                    <input
                      type="text"
                      value={formValues.adminName}
                      onChange={(event) => updateField('adminName', event.target.value)}
                      placeholder="Jessie (host)"
                      required
                    />
                  </label>
                  <label>
                    <span>Room title (optional)</span>
                    <input
                      type="text"
                      value={formValues.roomName}
                      onChange={(event) => updateField('roomName', event.target.value)}
                      placeholder="Lightning brainstorm"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    <span>Room key</span>
                    <input
                      type="text"
                      value={formValues.roomCode}
                      onChange={(event) =>
                        updateField(
                          'roomCode',
                          event.target.value.toUpperCase().slice(0, 5),
                        )
                      }
                      minLength={5}
                      maxLength={5}
                      placeholder="ABCDE"
                      required
                    />
                  </label>
                  <label>
                    <span>Your name</span>
                    <input
                      type="text"
                      value={formValues.participantName}
                      onChange={(event) => updateField('participantName', event.target.value)}
                      placeholder="Taylor"
                      required
                    />
                  </label>
                </>
              )}

              <button type="submit" className="cta" disabled={pendingAction !== null}>
                {pendingAction === mode ? 'Working…' : mode === 'create' ? 'Open the room' : 'Step in'}
              </button>
              {status.message && (
                <p className={`status ${status.type}`}>{status.message}</p>
              )}
            </form>

            <aside className="panel room-summary">
              {activeRoom ? (
                <div className="room-card">
                  <div className="details-head">
                    <div>
                      <p className="eyebrow">Now hosting</p>
                      <p className="room-name">{activeRoom.roomName}</p>
                    </div>
                    <span className="pill">{participantCount} inside</span>
                  </div>
                  <div className="code-chip" aria-live="polite">
                    <span>{activeRoom.code.split('').join(' ')}</span>
                    <button type="button" onClick={handleCopyCode}>
                      {copyState === 'copied' ? 'Copied' : 'Copy key'}
                    </button>
                  </div>
                  <p className="room-meta">
                    Host · {activeRoom.adminName}
                    <br />
                    Guests · {guestCount}
                  </p>
                  <ul>
                    {activeRoom.participants.map((participant) => (
                      <li key={participant.id}>
                        <span>{participant.name}</span>
                        <span className="role-chip">{participant.role}</span>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="subtle" onClick={() => setView('planning')}>
                    Go to planning view
                  </button>
                </div>
              ) : (
                <div className="empty-card">
                  <p className="eyebrow">Waiting on a room</p>
                  <h3>Open or join one to see details here.</h3>
                  <p>Once a space is live, we’ll keep its code and roster on this card.</p>
                </div>
              )}
            </aside>
          </section>
        </div>
      ) : (
        <div className="planning-view">
          <div className="planning-head">
            <div>
              <p className="eyebrow">Planning lounge</p>
              <h1>{activeRoom?.roomName || 'Idea room'}</h1>
              <p className="lede">
                Keep everyone focused on the same idea stream. Sub ideas, next steps, and voting
                rounds will layer in here.
              </p>
            </div>
            <div className="code-display">
              <span>Room key</span>
              <p>{activeRoom?.code.split('').join(' ')}</p>
              <button type="button" onClick={handleCopyCode}>
                {copyState === 'copied' ? 'Copied' : 'Copy key'}
              </button>
            </div>
          </div>

          {status.message && (
            <p className={`status ${status.type}`}>{status.message}</p>
          )}

          <div className="planning-actions">
            <button type="button" className="subtle" onClick={leavePlanningView}>
              Back to lobby
            </button>
            {isAdmin ? (
              <button
                type="button"
                className="danger"
                onClick={handleEndRoom}
                disabled={pendingAction === 'end'}
              >
                {pendingAction === 'end' ? 'Ending…' : 'End this room'}
              </button>
            ) : (
              <div className="badge">Waiting for host to wrap up</div>
            )}
          </div>

          <section className="planning-grid">
            <article className="panel participants">
              <header>
                <h2>People inside</h2>
                <span>{participantCount} {participantCount === 1 ? 'person' : 'people'}</span>
              </header>
              <ul>
                {activeRoom?.participants.map((participant) => (
                  <li key={participant.id}>
                    <div>
                      <p>{participant.name}</p>
                      <small>{participant.role === 'admin' ? 'Host' : 'Guest'}</small>
                    </div>
                    {participant.id && participant.id === currentUser?.id && (
                      <span className="you-pill">You</span>
                    )}
                  </li>
                ))}
              </ul>
            </article>

            <article className="panel planning-canvas">
              <h2>Planning canvas</h2>
              <p>
                This space will host brainstorming timers, sub-idea threads, and decision trees. For
                now, it confirms that everyone lands here right after joining.
              </p>
              <div className="flow-hint">
                <p>Upcoming flow</p>
                <ol>
                  <li>Rapid idea burst (30s)</li>
                  <li>Vote + shortlist (5 min)</li>
                  <li>Prompted deep dive</li>
                  <li>Sub-idea expansion</li>
                  <li>Summary & kanban handoff</li>
                </ol>
              </div>
            </article>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
