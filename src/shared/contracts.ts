export const platformIds = ['chaoxing', 'icourse', 'zhihuishu'] as const
export type PlatformId = typeof platformIds[number]
export type Completion = 'complete' | 'incomplete' | 'unknown'
export type LoginStatus = 'unknown' | 'logged-in' | 'logged-out' | 'attention'
export type TaskStatus = 'queued' | 'running' | 'paused' | 'attention' | 'recoverable' | 'finished' | 'cancelled'
export interface Account { id: string; platform: PlatformId; label: string; createdAt: number; loginStatus: LoginStatus }
export interface Course { id: string; accountId: string; platform: PlatformId; title: string; url: string; updatedAt: number; completion: Completion }
export interface PageTarget { selector: string; text: string; index: number; frameUrl: string }
export interface Chapter { id: string; courseId: string; title: string; url: string; kind: 'video' | 'manual' | 'unknown'; locked: boolean; completion: Completion; target?: PageTarget }
export interface Task { id: string; platform: PlatformId; accountId: string; courseId: string; title: string; chapterIds: string[]; chapters: Chapter[]; chapterIndex: number; status: TaskStatus; playbackState?: Observation['state']; observedAt?: number; reason: string | null; createdAt: number; updatedAt: number; position: number; currentTime: number; duration: number; playbackEnded: boolean; platformCompletion: Completion; generation: number }
export interface Observation { taskId: string; accountId: string; chapterId: string; generation: number; observedAt: number; state: 'playing' | 'paused' | 'ended' | 'buffering' | 'unknown'; currentTime: number; duration: number; completion: Completion; issue: string | null; url: string }
export interface StudyInterval { taskId: string; platform: PlatformId; start: number; end: number }
export interface Notice { id: string; level: 'info' | 'warning'; title: string; body: string; createdAt: number; read: boolean }
export interface Settings { muteAll: boolean; audiblePlatform: PlatformId; closeToTray: boolean; reminderEnabled: boolean; reminderTime: string; breakEnabled: boolean; breakMinutes: number; lastReminderDate: string; reminderCursorAt: number; lastBreakAt: number }
export interface PlatformInfo { id: PlatformId; name: string; short: string; color: string; home: string; courses: string; roots: string[]; scope: string; verification: 'unverified'; note: string }
export interface RuntimeInfo { platform: PlatformId; taskId: string | null; accountId: string; mode: 'browse' | 'task'; visible: boolean; url: string; title: string; loginPending?: boolean }
export interface Snapshot { sequence: number; accounts: Account[]; courses: Course[]; tasks: Task[]; notices: Notice[]; settings: Settings; platforms: PlatformInfo[]; views: RuntimeInfo[]; stats: { playbackMs: number; elapsedMs: number; todayFinished: number }; version: string; fixtureMode: boolean; lifecycle: 'ready' | 'suspending' | 'quitting' }
export type Command =
 | { type: 'account.add'; platform: PlatformId; label: string }
 | { type: 'account.rename'; accountId: string; label: string }
 | { type: 'account.open'; accountId: string }
 | { type: 'account.check'; accountId: string }
 | { type: 'account.logout'; accountId: string }
 | { type: 'account.delete'; accountId: string }
 | { type: 'courses.refresh'; accountId: string }
 | { type: 'course.open'; courseId: string }
 | { type: 'course.chapters'; courseId: string }
 | { type: 'task.add'; courseId: string; chapterIds: string[] }
 | { type: 'queue.start'; platform: PlatformId }
 | { type: 'queue.pause'; platform: PlatformId }
 | { type: 'task.pause'; taskId: string }
 | { type: 'task.resume'; taskId: string }
 | { type: 'task.cancel'; taskId: string }
 | { type: 'task.reorder'; taskId: string; direction: 'up' | 'down' }
 | { type: 'view.show'; platform: PlatformId; bounds: Bounds }
 | { type: 'view.hide' }
 | { type: 'view.navigate'; platform: PlatformId; action: 'back' | 'reload' | 'home' }
 | { type: 'view.close'; platform: PlatformId }
 | { type: 'settings.update'; settings: Partial<Pick<Settings, 'muteAll' | 'audiblePlatform' | 'closeToTray' | 'reminderEnabled' | 'reminderTime' | 'breakEnabled' | 'breakMinutes'>> }
 | { type: 'notices.read' }
 | { type: 'diagnostics.export' }
 | { type: 'data.clear-history' }
 | { type: 'app.quit' }
export interface Bounds { x: number; y: number; width: number; height: number }
export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string }
export interface DesktopBridge { snapshot(): Promise<Result<Snapshot>>; command<T = unknown>(command: Command): Promise<Result<T>>; onSnapshot(listener: (snapshot: Snapshot) => void): () => void }
export const defaultSettings: Settings = { muteAll: false, audiblePlatform: 'chaoxing', closeToTray: true, reminderEnabled: false, reminderTime: '19:00', breakEnabled: false, breakMinutes: 45, lastReminderDate: '', reminderCursorAt: 0, lastBreakAt: 0 }
export const terminalStatuses: TaskStatus[] = ['finished', 'cancelled']
