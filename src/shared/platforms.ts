import type { PlatformId, PlatformInfo } from './contracts'
// The official login page otherwise defaults its QR return to an HTTP URL,
// which our HTTPS-only navigation policy correctly rejects after confirmation.
const chaoxingCourses = 'https://i.chaoxing.com/'
const chaoxingLogin = 'https://passport2.chaoxing.com/login?refer=' + encodeURIComponent(chaoxingCourses)
export const platforms: PlatformInfo[] = [
 { id: 'chaoxing', name: '超星学习通', short: '学', color: '#3975e8', home: chaoxingLogin, courses: chaoxingCourses, roots: ['chaoxing.com', 'chaoxing.net'], scope: '常规网页课程', verification: 'unverified', note: '适配器待真实账号与课程验证；不保证学校定制入口兼容。' },
 { id: 'icourse', name: '中国大学 MOOC', short: 'M', color: '#16a67a', home: 'https://www.icourse163.org/', courses: 'https://www.icourse163.org/home.htm', roots: ['icourse163.org', 'reg.163.com', 'urs.163.com', 'passport.163.com', 'study.163.com'], scope: '普通选课，不含学校云 / SPOC', verification: 'unverified', note: '普通网页课程适配待实测；学校云与 SPOC 不在首版范围。' },
 { id: 'zhihuishu', name: '智慧树', short: '知', color: '#ed9145', home: 'https://login.zhihuishu.com/', courses: 'https://onlineweb.zhihuishu.com/', roots: ['zhihuishu.com'], scope: '共享学分课', verification: 'unverified', note: '共享学分课适配待实测；翻转课与特殊校内课暂不支持。' }
]
export const platformOf = (id: PlatformId): PlatformInfo => platforms.find(p => p.id === id)!
