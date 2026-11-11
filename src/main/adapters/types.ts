import type { LoginStatus, Completion, PageTarget } from '../../shared/contracts'
export interface Recipe { courseSelectors: string[]; coursePatterns: string[]; chapterSelectors: string[]; activeChapterSelectors: string[]; completedSelectors: string[]; lockSelectors: string[]; loggedInSelectors: string[] }
export interface PageItem { title: string; url: string; completion: Completion; locked: boolean; kind: 'video' | 'manual' | 'unknown'; target?: PageTarget }
export interface PageProbe { url: string; title: string; login: LoginStatus; issue: string | null; courses: PageItem[]; chapters: PageItem[]; media: { state: 'playing'|'paused'|'ended'|'buffering'; currentTime: number; duration: number; error: boolean } | null; completion: Completion; activeChapter: string|null; activeTarget?: PageTarget|null }
export type ProbeOperation = 'read'|'play'|'pause'|'click'
