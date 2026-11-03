import { createHash } from 'node:crypto'
import type { PlatformId } from '../../shared/contracts'
import { platformOf } from '../../shared/platforms'
export function isAllowedUrl(platform: PlatformId, raw: string): boolean {
 try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && platformOf(platform).roots.some(root => url.hostname === root || url.hostname.endsWith('.' + root)) } catch { return false }
}
export function safeUrl(raw: string): string {
 try { const url = new URL(raw); return url.protocol === 'https:' ? url.origin + '/[path-redacted]' : '[local-or-invalid-url]' } catch { return '[invalid-url]' }
}
export function fingerprint(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 20) }
export function redact(text: string): string {
 return text.replace(/https?:\/\/[^\s"'<>]+/gi, '[url-redacted]').replace(/(?:cookie|authorization|password|passwd|token|ticket|secret|验证码|密码)\s*[:=]\s*[^\s,;]+/gi, '[credential-redacted]').slice(0, 1200)
}
export function trustedSender(senderId: number, expectedId: number, isMainFrame: boolean, url: string, expectedUrl: string): boolean {
 if (senderId !== expectedId || !isMainFrame) return false
 try { const actual = new URL(url); const expected = new URL(expectedUrl); actual.hash=''; expected.hash=''; return actual.href === expected.href } catch { return false }
}
export const partitionFor = (platform: PlatformId, accountId: string): string => 'persist:campus-' + platform + '-' + fingerprint(accountId)

// Signed login routes are intentionally not persisted as course addresses.
export function isPersistableCourseUrl(platform:PlatformId,raw:string):boolean {
 if(!isAllowedUrl(platform,raw))return false
 const url=new URL(raw);const sensitive=/token|ticket|password|passwd|cookie|authorization|secret|signature|access.?key|auth.?key|session.?id/i
 if([...url.searchParams.keys()].some(k=>sensitive.test(k)))return false
 return !/(?:token|ticket|password|secret|authorization|sessionid)=/i.test(url.hash)&&!/[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/.test(raw)
}
