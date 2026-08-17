-- LEGACY HISTORICAL BOOTSTRAP ONLY.
-- DO NOT APPLY THIS FILE TO THE CURRENT MOLO DATABASE.
-- It does not represent the current production schema.
-- See database/README.md and backend/scripts/schema-audit.mjs.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE staff_role AS ENUM ('owner', 'admin', 'waiter');
CREATE TYPE table_status AS ENUM ('free', 'reserved', 'occupied', 'closed');
CREATE TYPE booking_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled', 'completed');
CREATE TYPE booking_source AS ENUM ('mini_app', 'phone', 'admin_manual');
CREATE TYPE restaurant_status AS ENUM ('open', 'booking_closed', 'closed');

CREATE TABLE restaurant (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL DEFAULT 'MOLO Restaurant',
    phone VARCHAR(50),
    address TEXT,
    menu_url TEXT,
    logo_url TEXT,
    main_photo_url TEXT,
    open_time TIME NOT NULL DEFAULT '10:00',
    booking_close_time TIME NOT NULL DEFAULT '22:00',
    close_time TIME NOT NULL DEFAULT '23:00',
    status restaurant_status NOT NULL DEFAULT 'open',
    close_message TEXT DEFAULT 'Ресторан зараз зачинений. Ми працюємо з 10:00 до 23:00.',
    booking_closed_message TEXT DEFAULT 'Онлайн-бронювання завершено. Для бронювання зателефонуйте адміністратору.',
    map_width NUMERIC NOT NULL DEFAULT 1600,
    map_height NUMERIC NOT NULL DEFAULT 1000,
    booking_close_notified_at DATE,
    restaurant_close_notified_at DATE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE zones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    color VARCHAR(50),
    photo_url TEXT,
    description TEXT,
    x NUMERIC NOT NULL DEFAULT 0,
    y NUMERIC NOT NULL DEFAULT 0,
    width NUMERIC NOT NULL DEFAULT 300,
    height NUMERIC NOT NULL DEFAULT 200,
    rotation NUMERIC NOT NULL DEFAULT 0,
    is_closed BOOLEAN NOT NULL DEFAULT FALSE,
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
    table_number VARCHAR(50) NOT NULL,
    seats INTEGER NOT NULL DEFAULT 4,
    shape VARCHAR(50) NOT NULL DEFAULT 'rectangle',
    photo_url TEXT,
    status table_status NOT NULL DEFAULT 'free',
    x NUMERIC NOT NULL DEFAULT 0,
    y NUMERIC NOT NULL DEFAULT 0,
    width NUMERIC NOT NULL DEFAULT 100,
    height NUMERIC NOT NULL DEFAULT 80,
    rotation NUMERIC NOT NULL DEFAULT 0,
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(zone_id, table_number)
);

CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL UNIQUE,
    telegram_id BIGINT UNIQUE,
    visits_count INTEGER NOT NULL DEFAULT 0,
    total_guests INTEGER NOT NULL DEFAULT 0,
    cancellations_count INTEGER NOT NULL DEFAULT 0,
    reschedules_count INTEGER NOT NULL DEFAULT 0,
    last_visit_at TIMESTAMP,
    note TEXT,
    is_regular BOOLEAN NOT NULL DEFAULT FALSE,
    is_blacklisted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE staff (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id BIGINT UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    role staff_role NOT NULL DEFAULT 'waiter',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_id UUID REFERENCES tables(id) ON DELETE SET NULL,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    created_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
    booking_date DATE NOT NULL,
    booking_time TIME NOT NULL,
    guests_count INTEGER NOT NULL CHECK (guests_count > 0),
    wishes TEXT,
    status booking_status NOT NULL DEFAULT 'pending',
    source booking_source NOT NULL DEFAULT 'mini_app',
    approved_at TIMESTAMP,
    rejected_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    completed_at TIMESTAMP,
    late_notified_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE booking_reschedule_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    requested_date DATE NOT NULL,
    requested_time TIME NOT NULL,
    status booking_status NOT NULL DEFAULT 'pending',
    admin_comment TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP
);

CREATE TABLE map_objects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
    zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
    object_type VARCHAR(100) NOT NULL,
    name VARCHAR(255),
    x NUMERIC NOT NULL DEFAULT 0,
    y NUMERIC NOT NULL DEFAULT 0,
    width NUMERIC NOT NULL DEFAULT 100,
    height NUMERIC NOT NULL DEFAULT 100,
    rotation NUMERIC NOT NULL DEFAULT 0,
    color VARCHAR(50),
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE broadcasts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
    title VARCHAR(255),
    message TEXT NOT NULL,
    target VARCHAR(100) NOT NULL DEFAULT 'all_clients',
    sent_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    details JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE daily_statistics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stat_date DATE NOT NULL UNIQUE,
    guests_count INTEGER NOT NULL DEFAULT 0,
    bookings_count INTEGER NOT NULL DEFAULT 0,
    cancelled_count INTEGER NOT NULL DEFAULT 0,
    no_show_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_bookings_date ON bookings(booking_date);
CREATE INDEX idx_bookings_table_date ON bookings(table_id, booking_date);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_clients_phone ON clients(phone);
CREATE INDEX idx_tables_zone ON tables(zone_id);
CREATE INDEX idx_logs_staff ON logs(staff_id);
CREATE INDEX idx_logs_created_at ON logs(created_at);

INSERT INTO restaurant (name, menu_url)
VALUES (
    'MOLO Restaurant',
    'https://expz.menu/8ec3f3d4-0e9f-4ed7-a03f-5f4deaba843e?utm_source=ig&utm_medium=social&utm_content=link_in_bio'
);
