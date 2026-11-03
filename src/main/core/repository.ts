import type { Account, Course, Task, Settings, Notice, StudyInterval } from '../../shared/contracts'
export interface Repository {
 accounts(): Account[]; saveAccount(account: Account): void; removeAccount(id: string): void;
 courses(accountId?: string): Course[]; saveCourses(courses: Course[]): void;
 tasks(): Task[]; saveTask(task: Task): void;
 settings(): Settings; saveSettings(settings: Settings): void;
 notices(): Notice[]; saveNotice(notice: Notice): void; readNotices(): void;
 addInterval(interval: StudyInterval): void; intervals(from: number): StudyInterval[];
 log(event: string, data?: Record<string, unknown>): void; logs(): unknown[]; clearHistory(): void; close(): void;
}
