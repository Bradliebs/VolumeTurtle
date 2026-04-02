'use client'

import { useState, useEffect } from 'react'

interface CruiseControlState {
  isEnabled: boolean
  lastPollAt: string | null
  nextPollAt: string | null
  pollCount: number
  totalRatchets: number
}

interface RatchetEvent {
  id: number
  ticker: string
  positionType: string
  oldStop: number
  newStop: number
  ratchetPct: number
  currentPrice: number
  profitPct: number
  pollTimestamp: string
}

interface Alert {
  id: number
  alertType: string
  message: string
  createdAt: string
}

export default function CruiseControlPanel() {
  const [state, setState] = useState<CruiseControlState | null>(null)
  const [activity, setActivity] = useState<RatchetEvent[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [toggling, setToggling] = useState(false)
  const [polling, setPolling] = useState(false)

  const fetchState = async () => {
    const res = await fetch('/api/cruise-control/state')
    const data = await res.json()
    setState(data)
  }

  const fetchActivity = async () => {
    const res = await fetch('/api/cruise-control/activity?hours=24')
    const data = await res.json()
    setActivity(data.slice(0, 10))
  }

  const fetchAlerts = async () => {
    const res = await fetch('/api/cruise-control/alerts?type=critical&hours=24')
    const data = await res.json()
    setAlerts(data)
  }

  const acknowledgeAlert = async (id: number) => {
    await fetch('/api/cruise-control/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setAlerts(prev => prev.filter(a => a.id !== id))
  }

  const acknowledgeAll = async () => {
    await fetch('/api/cruise-control/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
    setAlerts([])
  }

  const fetchAll = () => {
    fetchState()
    fetchActivity()
    fetchAlerts()
  }

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const handleToggle = async () => {
    setToggling(true)
    await fetch('/api/cruise-control/toggle', { method: 'POST' })
    await fetchState()
    setToggling(false)
  }

  const handlePollNow = async () => {
    setPolling(true)
    const res = await fetch('/api/cruise-control/poll-now', { method: 'POST' })
    const result = await res.json()
    await fetchAll()
    setPolling(false)
    console.log('[CRUISE CONTROL] Manual poll result:', result)
  }

  if (!state) return <div className="p-4 text-gray-400">Loading cruise control...</div>

  return (
    <div className="rounded-2xl border border-gray-700 bg-gray-900 p-6 space-y-6">

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Cruise Control</h2>
          <p className="text-sm text-gray-400">Intraday stop ratchet daemon</p>
        </div>

        <button
          onClick={handleToggle}
          disabled={toggling}
          className={`
            relative w-20 h-10 rounded-full transition-all duration-300 focus:outline-none
            ${state.isEnabled ? 'bg-green-500' : 'bg-gray-600'}
            ${toggling ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <span className={`
            absolute top-1 w-8 h-8 bg-white rounded-full shadow transition-all duration-300 pointer-events-none
            ${state.isEnabled ? 'left-11' : 'left-1'}
          `} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="bg-gray-800 rounded-xl p-3">
          <p className="text-gray-400">Status</p>
          <p className={`font-bold text-lg ${state.isEnabled ? 'text-green-400' : 'text-gray-500'}`}>
            {state.isEnabled ? '● ACTIVE' : '○ DORMANT'}
          </p>
        </div>
        <div className="bg-gray-800 rounded-xl p-3">
          <p className="text-gray-400">Total ratchets</p>
          <p className="font-bold text-lg text-white">{state.totalRatchets}</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-3">
          <p className="text-gray-400">Last poll</p>
          <p className="text-white text-xs">
            {state.lastPollAt
              ? new Date(state.lastPollAt).toLocaleTimeString('en-GB')
              : '—'}
          </p>
        </div>
        <div className="bg-gray-800 rounded-xl p-3">
          <p className="text-gray-400">Next poll</p>
          <p className="text-white text-xs">
            {state.nextPollAt
              ? new Date(state.nextPollAt).toLocaleTimeString('en-GB')
              : '—'}
          </p>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-red-400">⚠ Active Alerts</p>
            <button
              onClick={acknowledgeAll}
              className="text-xs text-gray-500 hover:text-white transition-colors"
            >
              Clear All
            </button>
          </div>
          {alerts.map(alert => (
            <div key={alert.id} className="flex items-start gap-2 bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-sm text-red-300">
              <span className="flex-1">
                {alert.message}
                <span className="ml-2 text-xs text-red-500">
                  {new Date(alert.createdAt).toLocaleTimeString('en-GB')}
                </span>
              </span>
              <button
                onClick={() => acknowledgeAlert(alert.id)}
                className="text-red-500 hover:text-white shrink-0 ml-1"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-semibold text-gray-300">Recent Stop Ratchets</p>
        {activity.length === 0 && (
          <p className="text-xs text-gray-500">No ratchets in the last 24 hours</p>
        )}
        {activity.map(event => (
          <div key={event.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2 text-xs">
            <span className="font-mono text-white">{event.ticker}</span>
            <span className="text-gray-400 capitalize">{event.positionType}</span>
            <span className="text-gray-400">
              {event.oldStop.toFixed(2)} → <span className="text-green-400">{event.newStop.toFixed(2)}</span>
            </span>
            <span className="text-green-400">+{event.ratchetPct.toFixed(2)}%</span>
            <span className="text-gray-500">
              {new Date(event.pollTimestamp).toLocaleTimeString('en-GB')}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={handlePollNow}
        disabled={polling || !state.isEnabled}
        className={`
          w-full py-2 rounded-xl text-sm font-semibold transition-all
          ${state.isEnabled
            ? 'bg-blue-600 hover:bg-blue-500 text-white'
            : 'bg-gray-700 text-gray-500 cursor-not-allowed'}
          ${polling ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        {polling ? 'Polling...' : 'Poll Now'}
      </button>

    </div>
  )
}
