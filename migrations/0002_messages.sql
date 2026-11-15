CREATE TABLE order_messages (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	order_id INTEGER NOT NULL REFERENCES orders (id),
	author_role TEXT NOT NULL CHECK (author_role IN ('customer', 'owner', 'provider')),
	author_email TEXT NOT NULL,
	body TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX order_messages_order ON order_messages (order_id, id);
