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
 return text.replace(/https?:\/\/[^\s"'<>]+/gi, '[url-redacted]').replace(/(?:cookie|authorization|password|passwd|token|ticket|secret|ckenc|验证码|密码)\s*[:=]\s*[^\s,;]+/gi, '[credential-redacted]').slice(0, 1200)
}
export function trustedSender(senderId: number, expectedId: number, isMainFrame: boolean, url: string, expectedUrl: string): boolean {
 if (senderId !== expectedId || !isMainFrame) return false
 try { const actual = new URL(url); const expected = new URL(expectedUrl); actual.hash=''; expected.hash=''; return actual.href === expected.href } catch { return false }
}
export const partitionFor = (platform: PlatformId, accountId: string): string => 'persist:campus-' + platform + '-' + fingerprint(accountId)

// Signed login routes are intentionally not persisted as course addresses.
export function isPersistableCourseUrl(platform:PlatformId,raw:string):boolean {
 if(!isAllowedUrl(platform,raw))return false
 const url=new URL(raw);const sensitive=/token|ticket|password|passwd|cookie|authorization|secret|signature|ckenc|access.?key|auth.?key|session.?id/i
 if([...url.searchParams.keys()].some(k=>sensitive.test(k)))return false
 return !/(?:token|ticket|password|secret|authorization|sessionid|ckenc)=/i.test(url.hash)&&!/[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/.test(raw)
}

// A v24 URL without its signature is an identity only. Never navigate to this
// stored identity: resolve the original visible link in the account's directory.
export function isDirectoryCourse(platform:PlatformId,raw:string):boolean {
 try {const u=new URL(raw);return platform==='chaoxing'&&isAllowedUrl(platform,raw)&&u.hostname==='v24.chaoxing.com'&&u.pathname==='/courselist/opencoursenewfy'}catch{return false}
}
export function courseIdentityUrl(platform:PlatformId,raw:string):string|null {
 if(!isDirectoryCourse(platform,raw))return isPersistableCourseUrl(platform,raw)?raw:null
 const u=new URL(raw),keys=['role','courseId','clazzId','cpi']
 if(u.hash||[...u.searchParams.keys()].some(k=>!keys.includes(k)&&k!=='ckenc'))return null
 if([...u.searchParams.keys()].some(k=>u.searchParams.getAll(k).length!==1))return null
 if(u.searchParams.get('role')!=='3'||keys.slice(1).some(k=>!/^\d{1,24}$/.test(u.searchParams.get(k)??'')))return null
 const identity=new URL(u.origin+u.pathname)
 for(const k of keys)identity.searchParams.set(k,u.searchParams.get(k)!)
 return identity.href
}
