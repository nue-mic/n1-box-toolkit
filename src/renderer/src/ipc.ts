import { useEffect } from 'react'
import { useStore } from './store'

export const api = window.api

/** 订阅主进程的实时日志 / 状态事件，灌入 store。在 App 根挂载一次。 */
export function useIpcBridge(): void {
  const addLog = useStore((s) => s.addLog)
  const setStatus = useStore((s) => s.setStatus)

  useEffect(() => {
    const offLog = api.onLog((e) => addLog(e))
    const offStatus = api.onStatus((s) => setStatus(s))
    return () => {
      offLog()
      offStatus()
    }
  }, [addLog, setStatus])
}
