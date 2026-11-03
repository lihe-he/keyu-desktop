import { isPersistableCourseUrl } from '../../src/main/core/security'
import { describe,it,expect } from 'vitest'
import { isAllowedUrl,partitionFor,trustedSender,safeUrl,redact } from '../../src/main/core/security'
import { commandSchema } from '../../src/shared/validation'
describe('strict navigation policy',()=>{
 it.each(['https://i.chaoxing.com/','https://passport2.chaoxing.com/login','https://foo.chaoxing.net/'])('allows actual platform hosts %s',url=>expect(isAllowedUrl('chaoxing',url)).toBe(true))
 it.each(['http://i.chaoxing.com/','https://chaoxing.com.evil.test','https://evilchaoxing.com','https://evil.test/?next=chaoxing.com','javascript:alert(1)','file:///C:/secret','https://u:p@chaoxing.com','https://chaoxing.com:8443','data:text/html,test','not a url'])('rejects unsafe navigation %s',url=>expect(isAllowedUrl('chaoxing',url)).toBe(false))
 it('rejects another platform in an existing session',()=>expect(isAllowedUrl('icourse','https://i.chaoxing.com')).toBe(false))
 it('sessions differ by both account and platform',()=>{expect(partitionFor('chaoxing','a')).not.toBe(partitionFor('chaoxing','b'));expect(partitionFor('chaoxing','a')).not.toBe(partitionFor('icourse','a'));expect(partitionFor('chaoxing','a')).toMatch(/^persist:/)})
 it('never shows query tokens or path account IDs in its URL label',()=>expect(safeUrl('https://i.chaoxing.com/users/123?token=secret#value')).toBe('https://i.chaoxing.com/[path-redacted]'))
 it('redacts credential values from errors',()=>{const text=redact('token=abc password=123 https://site.example/?ticket=secret');expect(text).not.toContain('abc');expect(text).not.toContain('123');expect(text).not.toContain('secret')})
})
describe('IPC trust boundary',()=>{
 const file='file:///D:/app/index.html'
 it('only trusts the exact local main renderer',()=>expect(trustedSender(1,1,true,file,file)).toBe(true))
 it('rejects a same-url popup',()=>expect(trustedSender(2,1,true,file,file)).toBe(false))
 it('rejects iframes even with the right URL and contents',()=>expect(trustedSender(1,1,false,file,file)).toBe(false))
 it('rejects remote pages and untrusted dev-server paths',()=>{expect(trustedSender(1,1,true,'https://i.chaoxing.com',file)).toBe(false);expect(trustedSender(1,1,true,'http://localhost:5173/evil','http://localhost:5173/')).toBe(false)})
 it('accepts an explicit bounded operation',()=>expect(commandSchema.safeParse({type:'task.pause',taskId:'a'}).success).toBe(true))
 it.each([{type:'eval',code:'process.exit()'},{type:'account.add',platform:'evil',label:'name'},{type:'account.add',platform:'chaoxing',label:' '},{type:'settings.update',settings:{reminderTime:'25:99'}},{type:'settings.update',settings:{breakMinutes:0}},{type:'settings.update',settings:{lastReminderDate:'fake'}},{type:'view.show',platform:'chaoxing',bounds:{x:-2,y:0,width:10,height:10}},{type:'task.pause',taskId:'a',script:'evil'}])('rejects invalid or overprivileged request %#',command=>expect(commandSchema.safeParse(command).success).toBe(false))
})

describe('credential-bearing course addresses never reach storage',()=>{
 it.each(['access_token=secret','ticket=secret','authorization=secret','signature=secret','sessionId=secret'])('rejects %s',query=>expect(isPersistableCourseUrl('chaoxing','https://i.chaoxing.com/course?'+query)).toBe(false))
 it('allows ordinary course identifiers',()=>expect(isPersistableCourseUrl('chaoxing','https://i.chaoxing.com/course?courseId=123&chapterId=456')).toBe(true))
 it('rejects credential fragments',()=>expect(isPersistableCourseUrl('chaoxing','https://i.chaoxing.com/course#token=secret')).toBe(false))
})
