import type { Recipe } from './types'
import type { PlatformId } from '../../shared/contracts'
// Candidate DOM recipes, not certified selectors. Every candidate must pass structural
// checks and a real-course acceptance run before the platform is declared compatible.
const base = { completedSelectors: ['[data-completion="complete"]'], lockSelectors: ['[aria-disabled="true"]','[disabled]','[data-locked="true"]'], loggedInSelectors: ['a[href*="logout"]','a[href*="signout"]'] }
// Observed in the personal "我学的课" iframe. Use heading links, not the
// duplicate cover / "课程已结束" links, and never persist the iframe's SSO URL.
const chaoxingPersonalCourse = '#courseList :is(h1,h2,h3,h4,h5,h6,[role="heading"]) a[href*="/visit/stucoursemiddle"]'
const chaoxingV24Course = '#stuCourseList :is(h1,h2,h3,h4,h5,h6,[role="heading"]) a[href*="/courselist/opencoursenewfy"]'
export const recipes: Record<PlatformId, Recipe> = {
 chaoxing: { ...base, courseSelectors: [chaoxingPersonalCourse, chaoxingV24Course, '.course-list a[href]', '.courseList a[href]', '.course a[href]', 'a[href*="/mycourse/studentcourse"]', 'a[href*="/visit/courselist"]'], coursePatterns: ['/visit/stucoursemiddle','/courselist/opencoursenewfy','/mycourse/studentcourse','/visit/interaction','/course/'], chapterSelectors: ['.chapter_item', '.chapter_unit', '.posCatalog_name', '.ncells a', 'a[href*="/knowledge/cards"]'] },
 icourse: { ...base, courseSelectors: ['.course-card a[href]', '.courseCard a[href]', '.m-course-list a[href]', 'a[href*="/learn/"]', 'a[href*="/spoc/course.htm"]'], coursePatterns: ['/learn/','/course/'], chapterSelectors: ['.j-chapter', '.j-lesson', '.u-lesson', '.lesson-item', 'a[href*="cid="]'] },
 zhihuishu: { ...base, courseSelectors: ['.course-card a[href]', '.courseList a[href]', '.course-list a[href]', 'a[href*="/learning/videoList"]', 'a[href*="/study/video"]'], coursePatterns: ['/learning/videoList','/study/','/course/'], chapterSelectors: ['.video-item', '.videoItem', '.lesson-item', '.catalogue a', 'a[href*="videoId="]'] }
}
