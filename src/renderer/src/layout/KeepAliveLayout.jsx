import { useMemo } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'
import { KeepAlive } from 'keepalive-for-react'

export default function KeepAliveLayout() {
  const location = useLocation()
  const outlet = useOutlet()
  const currentCacheKey = useMemo(
    () => location.pathname + location.search,
    [location.pathname, location.search]
  )

  return (
    <KeepAlive activeCacheKey={currentCacheKey} max={5}>
      {outlet}
    </KeepAlive>
  )
}
