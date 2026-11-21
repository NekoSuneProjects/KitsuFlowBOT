// Operational log rows, shown to operators in Admin Panel → Bot & platform logs.
export function createLogger(db) {
  const log = (id, event, detail) =>
    db
      .prepare('INSERT INTO logs(channel,event,detail) VALUES(?,?,?)')
      .run(id, event, String(detail).slice(0, 500));
  return log;
}
