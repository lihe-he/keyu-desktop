import { describe, expect, it } from 'vitest'
import { platformOf, platforms } from '../../src/shared/platforms'
import { isAllowedUrl } from '../../src/main/core/security'

describe('public platform entry configuration', () => {
  it('uses the directly observed Zhihuishu login origin instead of the aborting legacy redirect', () => {
    expect(platformOf('zhihuishu').home).toBe('https://login.zhihuishu.com/')
    expect(platformOf('zhihuishu').roots).toEqual(['zhihuishu.com'])
  })
  it('keeps all entry URLs inside the existing allowlist without promoting course compatibility', () => {
    for (const platform of platforms) {
      expect(isAllowedUrl(platform.id, platform.home)).toBe(true)
      expect(isAllowedUrl(platform.id, platform.courses)).toBe(true)
      expect(platform.verification).toBe('unverified')
    }
  })
})
