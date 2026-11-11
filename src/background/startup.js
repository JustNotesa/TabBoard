import log from "loglevel";
import { openSession } from "./open.js";
import { getSessionsByTag } from "./tag.js";
import getSessions from "./getSessions.js";

const logDir = "background/startup";

export const openStartupSessions = async () => {
  log.info(logDir, "openStartupSessions()");
  const startupSessions = await getSessionsByTag("_startup", ["id", "tag", "date"]);
  if (startupSessions.length == 0) return;

  for (const i in startupSessions) {
    const session = await getSessions(startupSessions[i].id);
    if (session === undefined) continue;
    await openSession(session, i == 0 ? "openInCurrentWindow" : "openInNewWindow");
  }
};
