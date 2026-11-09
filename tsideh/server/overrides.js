// Kitchen overrides set from the admin during service: pausing an event and 86-ing an item.

export function createOverrides(db) {
  const sql = {
    paused: db.prepare('SELECT paused FROM event_overrides WHERE event_id = ?'),
    soldOut: db.prepare('SELECT item_id FROM sold_out_items WHERE event_id = ?'),
    setPaused: db.prepare(`
      INSERT INTO event_overrides (event_id, paused, updated_at) VALUES (:eventId, :paused, :now)
      ON CONFLICT (event_id) DO UPDATE SET paused = excluded.paused, updated_at = excluded.updated_at`),
    markSoldOut: db.prepare('INSERT OR IGNORE INTO sold_out_items (event_id, item_id, created_at) VALUES (?, ?, ?)'),
    clearSoldOut: db.prepare('DELETE FROM sold_out_items WHERE event_id = ? AND item_id = ?'),
  };

  return {
    forEvent(eventId) {
      return {
        paused: sql.paused.get(eventId)?.paused === 1,
        soldOut: new Set(sql.soldOut.all(eventId).map((row) => row.item_id)),
      };
    },
    setPaused(eventId, paused, now) {
      sql.setPaused.run({ eventId, paused: paused ? 1 : 0, now });
    },
    setSoldOut(eventId, itemId, soldOut, now) {
      if (soldOut) sql.markSoldOut.run(eventId, itemId, now);
      else sql.clearSoldOut.run(eventId, itemId);
    },
  };
}
