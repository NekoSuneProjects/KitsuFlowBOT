import crypto from 'node:crypto';

// Paired desktop devices (KitsuFlowBOT Assistant). Keys are created in Studio → Voice & Clips →
// Pair a PC, shown once, and stored only as a SHA-256 hash in voice_companion_devices.
export const hashDeviceKey = value => crypto.createHash('sha256').update(value).digest('hex');

// Express middleware: "Authorization: Bearer kfv_..." -> req.companion = { id, channel }.
export function createDeviceAuth(db) {
  return (req, res, next) => {
    const header = req.get('Authorization') || '',
      key = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!/^kfv_[A-Za-z0-9_-]{48}$/.test(key))
      return res.status(401).json({ error: 'Device key required' });
    const record = db
      .prepare('SELECT id,channel FROM voice_companion_devices WHERE secret_hash=? AND revoked=0')
      .get(hashDeviceKey(key));
    if (!record) return res.status(401).json({ error: 'Unknown or revoked device' });
    req.companion = record;
    db.prepare('UPDATE voice_companion_devices SET last_seen=CURRENT_TIMESTAMP WHERE id=?').run(
      record.id
    );
    next();
  };
}

// True when a paired device for the channel has called the API in the last `seconds`.
export function deviceOnline(db, channel, seconds = 30) {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM voice_companion_devices WHERE channel=? AND revoked=0 AND last_seen IS NOT NULL AND datetime(last_seen) > datetime('now', ?)"
      )
      .get(channel, '-' + Number(seconds) + ' seconds')
  );
}
