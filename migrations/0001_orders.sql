CREATE TABLE orders (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	provider TEXT NOT NULL CHECK (provider IN ('stripe', 'paypal')),
	provider_ref TEXT NOT NULL,
	email TEXT NOT NULL,
	name TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'processing', 'shipped', 'complete', 'refunded', 'cancelled')),
	currency TEXT NOT NULL,
	total INTEGER NOT NULL,
	items TEXT NOT NULL,
	shipping TEXT,
	tracking TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	UNIQUE (provider, provider_ref)
);
CREATE INDEX orders_email ON orders (email);
CREATE INDEX orders_created ON orders (created_at);

CREATE TABLE order_notes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	order_id INTEGER NOT NULL REFERENCES orders (id),
	author TEXT NOT NULL,
	body TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX order_notes_order ON order_notes (order_id);

CREATE TABLE login_tokens (
	token_hash TEXT PRIMARY KEY,
	email TEXT NOT NULL,
	expires_at INTEGER NOT NULL,
	used_at INTEGER
);
CREATE INDEX login_tokens_email ON login_tokens (email, expires_at);

CREATE TABLE audit_log (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	actor TEXT NOT NULL,
	action TEXT NOT NULL,
	order_id INTEGER,
	detail TEXT NOT NULL DEFAULT '{}',
	created_at INTEGER NOT NULL
);
CREATE INDEX audit_log_created ON audit_log (created_at);
