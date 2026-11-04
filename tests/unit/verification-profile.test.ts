import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { verificationProfilePath } from '../../src/main/core/verification-profile'

describe('local packaged verification profile',()=>{
 it('is confined to a dedicated temporary directory',()=>{
  const id='12345678-1234-4123-8123-123456789abc'
  expect(verificationProfilePath(id,'/temp')).toBe(join('/temp','CampusCourseDesktop-verification',id))
 })
 it.each(['','../CampusCourseDesktop','C:\\Users\\test','12345678-1234-4123-8123-123456789abc/../other','not-a-uuid'])('rejects invalid IDs instead of falling back to real accounts: %s',id=>{
  expect(()=>verificationProfilePath(id,'/temp')).toThrow('未访问日常账号数据')
 })
})
