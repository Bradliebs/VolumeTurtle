import { startCruiseControl, getCruiseControlState } from './cruise-control-engine'

const globalInit = globalThis as unknown as { __cruiseControlInit?: boolean }

export async function initCruiseControl() {
  if (globalInit.__cruiseControlInit) return
  globalInit.__cruiseControlInit = true

  const state = await getCruiseControlState()
  if (state.isEnabled) {
    console.log('[CRUISE-CONTROL] Resuming daemon — was ON at last shutdown')
    await startCruiseControl()
  } else {
    console.log('[CRUISE-CONTROL] Daemon dormant — OFF state restored from DB')
  }
}
