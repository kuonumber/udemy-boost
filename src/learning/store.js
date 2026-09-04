// 學習歷程的 chrome.storage.local 存取；storage 可注入（測試 / e2e）。
import { emptyLog } from "./log.js";

const KEY = (courseId) => `lp:${courseId}`;

export function createLogStore(storage = chrome.storage.local) {
  return {
    async get(courseId, courseTitle, slug) {
      const r = await storage.get(KEY(courseId));
      const log = r[KEY(courseId)];
      if (!log) return { log: emptyLog(courseId, courseTitle, slug), isNew: true };
      // 課程名稱可能改；以最新為準
      return { log: { ...log, courseTitle: courseTitle || log.courseTitle, slug: slug || log.slug }, isNew: false };
    },
    async set(log) {
      await storage.set({ [KEY(log.courseId)]: log });
    },
    async clear(courseId) {
      await storage.remove(KEY(courseId));
    },
  };
}
