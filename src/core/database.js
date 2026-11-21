import Database from 'better-sqlite3';

// Opens the SQLite database and creates the core tables. Feature modules create their own.
export function openDatabase(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,login TEXT NOT NULL,display TEXT NOT NULL,access TEXT NOT NULL,refresh TEXT NOT NULL,expires INTEGER NOT NULL,scopes TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY,login TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,links INTEGER NOT NULL DEFAULT 1,blocked TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS commands(channel TEXT NOT NULL,name TEXT NOT NULL,response TEXT NOT NULL,cooldown INTEGER NOT NULL DEFAULT 10,level TEXT NOT NULL DEFAULT 'everyone',PRIMARY KEY(channel,name));
CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  return db;
}
