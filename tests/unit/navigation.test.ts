import { describe,it,expect } from 'vitest'
import { blockedNavigationMessage, pageLoadFailure, courseHttpsRetry, courseDestinationIssue } from '../../src/main/core/navigation'

const signedEntry='https://v24.chaoxing.com/courselist/opencoursenewfy?role=3&courseId=101&clazzId=201&cpi=301&ckenc=synthetic-signature'
const legacyEntry='http://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=101&ckenc=synthetic-hop'
describe('course identity after redirects',()=>{
 const destination='https://mooc1-2.chaoxing.com/mooc-ans/visit/stucoursemiddle?courseid=101&clazzid=201&cpi=301'
 it('recognizes identifier casing across the directory and final course route',()=>expect(courseDestinationIssue('chaoxing',signedEntry,destination)).toBeNull())
 it.each(['courseid=101','clazzid=201','cpi=301'])('rejects a conflicting %s instead of binding another course',key=>{
  expect(courseDestinationIssue('chaoxing',signedEntry,destination.replace(key,key.slice(0,key.indexOf('='))+'=999'))).toContain('另一门课程')
 })
 it.each([destination+'&courseId=101',destination+'&clazzId=201',destination+'&cpi=301'])('rejects duplicate case-insensitive identifiers %#',url=>{
  expect(courseDestinationIssue('chaoxing',signedEntry,url)).toContain('歧义')
 })
 it.each([signedEntry,'https://passport2.chaoxing.com/login',destination.replace('courseid=101&',''),'https://evil.test/course?courseid=101'])('refuses a signed entry without a verifiable final course %#',url=>{
  expect(courseDestinationIssue('chaoxing',signedEntry,url)).not.toBeNull()
 })
 it('also refuses an ordinary course URL that redirects to a different known course',()=>{
  expect(courseDestinationIssue('chaoxing',destination,destination.replace('courseid=101','courseid=102'))).toContain('另一门课程')
 })
})
describe('bounded course HTTPS retry',()=>{
 it('preserves the observed redirect parameters only in the HTTPS retry',()=>{
  expect(courseHttpsRetry('chaoxing',signedEntry,legacyEntry)).toBe(legacyEntry.replace('http:','https:'))
 })
 it.each([
  ['icourse',signedEntry,legacyEntry],
  ['chaoxing','https://passport2.chaoxing.com/login',legacyEntry],
  ['chaoxing',signedEntry.replace('&ckenc=synthetic-signature',''),legacyEntry],
  ['chaoxing',signedEntry.replace('role=3','role=1'),legacyEntry],
  ['chaoxing',signedEntry,legacyEntry.replace('mooc1.chaoxing.com','mooc1.chaoxing.com.evil.test')],
  ['chaoxing',signedEntry,legacyEntry.replace('/visit/stucoursemiddle','/mycourse/studentcourse')],
  ['chaoxing',signedEntry,legacyEntry.replace('http:','https:')],
  ['chaoxing',signedEntry,legacyEntry.replace('mooc1.','user:secret@mooc1.')],
  ['chaoxing',signedEntry,legacyEntry.replace('.com/','.com:8080/')],
  ['chaoxing',signedEntry,legacyEntry+'#private'],
  ['chaoxing','invalid',legacyEntry]
 ] as const)('rejects unverified retry %#',(platform,source,target)=>{
  expect(courseHttpsRetry(platform,source,target)).toBeNull()
 })
})

describe('navigation diagnostics',()=>{
 it('distinguishes a course redirect from a login failure without retaining credentials',()=>{
  const message=blockedNavigationMessage('chaoxing','http://mooc1.chaoxing.com/mycourse/studentcourse?courseId=123&ckenc=synthetic-secret#private',true,'redirect',false)
  expect(message).toContain('HTTP');expect(message).toContain('主页面 · 服务端重定向')
  expect(message).toContain('mooc1.chaoxing.com');expect(message).toContain('/mycourse/studentcourse')
  expect(message).not.toMatch(/123|ckenc|secret|private|核对登录/)
 })
 it('offers the login recheck only on a main-frame login failure',()=>{
  expect(blockedNavigationMessage('chaoxing','http://i.chaoxing.com/',true,'navigate',true)).toContain('手机已确认，核对登录')
  const child=blockedNavigationMessage('chaoxing','http://i.chaoxing.com/',false,'navigate',true)
  expect(child).toContain('嵌套页面');expect(child).not.toContain('核对登录')
 })
 it.each(['https://private-secret.evil.test/users/private-secret?token=private-secret','http://private-secret.chaoxing.com/private-secret','not-a-url-private-secret'])('never reflects unknown address text %#',raw=>{
  expect(blockedNavigationMessage('chaoxing',raw,true,'new-window',false)).not.toContain('private-secret')
 })
 it('does not label another platform as a known Chaoxing route',()=>{
  expect(blockedNavigationMessage('icourse','http://i.chaoxing.com/login',true,'redirect',false)).not.toContain('i.chaoxing.com')
 })
 it('returns only bounded numeric load codes without echoing error text',()=>{
  expect(pageLoadFailure({errno:-105,message:'token=private-secret https://example.test/secret'})).toContain('-105')
  expect(pageLoadFailure({errno:-105,message:'token=private-secret'})).not.toContain('private-secret')
  expect(pageLoadFailure({errno:'private-secret'})).not.toContain('private-secret')
  expect(pageLoadFailure(new Error('private-secret'))).not.toContain('private-secret')
 })
})
