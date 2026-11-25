/**
 * hash 路由（CONTRACT §8）。**不引入 vue-router**：四条路由、一个 `hashchange` 监听就够。
 *
 * 为什么要解析成对象而不是在各页面里切字符串：页面只关心「我是谁、我的 id 是什么」，
 * 而「这个 hash 到底认不认」只有一处需要判断。
 */
export type Route =
  | { name: 'home' }
  | { name: 'editor'; cardId: string }
  | { name: 'play'; cardId: string; saveId: string }
  | { name: 'settings' }
  | { name: 'unknown'; hash: string }

// 把 location.hash 解析成路由对象；认不出来给 unknown（不猜）
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '')
  if (path === '' || path === '/' || path === '/home') return { name: 'home' }
  const parts = path.split('/').filter((part) => part !== '')
  if (parts.length === 1 && parts[0] === 'settings') return { name: 'settings' }
  if (parts.length === 2 && parts[0] === 'edit')
    return { name: 'editor', cardId: decodeURIComponent(parts[1]) }
  if (parts.length === 3 && parts[0] === 'play') {
    return { name: 'play', cardId: decodeURIComponent(parts[1]), saveId: decodeURIComponent(parts[2]) }
  }
  return { name: 'unknown', hash }
}

// 反过来：路由对象 -> 可以赋给 location.hash 的字符串
export function routeHash(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/'
    case 'settings':
      return '#/settings'
    case 'editor':
      return `#/edit/${encodeURIComponent(route.cardId)}`
    case 'play':
      return `#/play/${encodeURIComponent(route.cardId)}/${encodeURIComponent(route.saveId)}`
    default:
      return '#/'
  }
}
