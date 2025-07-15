-- جدول لتخزين المستخدمين المسموح لهم باستلام المهام
CREATE TABLE IF NOT EXISTS allowed_users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    telegram_id BIGINT
);
