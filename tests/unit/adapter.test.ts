import { describe, it, expect, vi } from 'vitest'
import type { WebContents } from 'electron'
import { PlatformAdapter } from '../../src/main/adapters/adapter'
import type { PageProbe } from '../../src/main/adapters/types'
import { makeAccount } from './helpers'

const identity='https://v24.chaoxing.com/courselist/opencoursenewfy?role=3&courseId=101&clazzId=201&cpi=301'
const page=(urls=[identity+'&ckenc=synthetic-first']):PageProbe=>({url:'https://v24.chaoxing.com/wfw/courselist/course3?space_token=synthetic-context',title:'脱敏课程目录',login:'unknown',issue:null,chapters:[],activeChapter:null,completion:'unknown',media:null,courses:urls.map(url=>({title:'脱敏课程甲',url,completion:'unknown',locked:false,kind:'unknown'}))})
const contents={} as WebContents
describe('signed course entry resolution',()=>{
 it('never returns signed entry or directory credentials in persisted courses',async()=>{
  const a=new PlatformAdapter('chaoxing');vi.spyOn(a,'read').mockResolvedValue([page()])
  const courses=await a.courses(contents,makeAccount())
  expect(courses).toHaveLength(1);expect(courses[0].url).toBe(identity)
  expect(JSON.stringify(courses)).not.toMatch(/ckenc|space_token|synthetic-/)
  const id=courses[0].id;vi.mocked(a.read).mockResolvedValue([page([identity+'&ckenc=synthetic-second'])])
  expect((await a.courses(contents,makeAccount()))[0].id).toBe(id)
  expect(await a.resolveCourseUrl(contents,courses[0])).toBe(identity+'&ckenc=synthetic-second')
 })
 it('requires the current directory, matching course identifiers and no login challenge',async()=>{
  const a=new PlatformAdapter('chaoxing');vi.spyOn(a,'read').mockResolvedValue([page()]);const [course]=await a.courses(contents,makeAccount())
  vi.mocked(a.read).mockResolvedValue([page([])]);await expect(a.resolveCourseUrl(contents,course)).rejects.toThrow('当前账号')
  vi.mocked(a.read).mockResolvedValue([page([identity.replace('clazzId=201','clazzId=202')+'&ckenc=synthetic'])]);await expect(a.resolveCourseUrl(contents,course)).rejects.toThrow('当前账号')
  vi.mocked(a.read).mockResolvedValue([{...page(),issue:'登录已失效'}]);await expect(a.resolveCourseUrl(contents,course)).rejects.toThrow('登录已失效')
 })
 it('refuses multiple competing entries instead of guessing a signature',async()=>{
  const a=new PlatformAdapter('chaoxing');vi.spyOn(a,'read').mockResolvedValue([page()]);const [course]=await a.courses(contents,makeAccount())
  vi.mocked(a.read).mockResolvedValue([page([identity+'&ckenc=synthetic-a',identity+'&ckenc=synthetic-b'])]);await expect(a.resolveCourseUrl(contents,course)).rejects.toThrow('当前账号')
 })
})
