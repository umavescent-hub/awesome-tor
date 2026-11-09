// Catering inquiries: stored as submitted, worked through from the kitchen admin.

export function createCatering(db) {
  const sql = {
    insert: db.prepare(`
      INSERT INTO catering_inquiries (
        created_at, updated_at, status, name, email, phone, event_date, guest_count,
        location, service_style, budget, dietary, message
      ) VALUES (
        :now, :now, 'new', :name, :email, :phone, :eventDate, :guestCount,
        :location, :serviceStyle, :budget, :dietary, :message
      )`),
    list: db.prepare('SELECT * FROM catering_inquiries ORDER BY created_at DESC, id DESC'),
    setStatus: db.prepare('UPDATE catering_inquiries SET status = ?, updated_at = ? WHERE id = ?'),
  };

  return {
    create(inquiry, now) {
      return Number(sql.insert.run({ ...inquiry, now }).lastInsertRowid);
    },
    list() {
      return sql.list.all().map((row) => ({
        id: row.id,
        createdAt: new Date(row.created_at).toISOString(),
        status: row.status,
        name: row.name,
        email: row.email,
        phone: row.phone,
        eventDate: row.event_date,
        guestCount: row.guest_count,
        location: row.location,
        serviceStyle: row.service_style,
        budget: row.budget,
        dietary: row.dietary,
        message: row.message,
      }));
    },
    setStatus(id, status, now) {
      return sql.setStatus.run(status, now, id).changes === 1;
    },
  };
}
