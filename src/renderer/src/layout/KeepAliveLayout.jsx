import { useLocation, useOutlet } from 'react-router-dom'
import { KeepAlive } from 'keepalive-for-react'

export default function KeepAliveLayout() {
  const location = useLocation()
  const outlet = useOutlet()
  const currentCacheKey = location.pathname

  return (
    <KeepAlive activeCacheKey={currentCacheKey} max={5}>
      {outlet}
    </KeepAlive>
  )
}
