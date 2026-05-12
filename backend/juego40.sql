CREATE DATABASE IF NOT EXISTS juego_40;
USE juego_40;

CREATE TABLE users (
    id CHAR(36) PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    balance DECIMAL(10, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE game_sessions (
    id CHAR(36) PRIMARY KEY,
    game_type VARCHAR(50),
    creator_id_fk CHAR(36) NOT NULL,          
    total_pot DECIMAL(10, 2) DEFAULT 0.00,
    winner_id_fk CHAR(36),
    status ENUM('waiting', 'active', 'finished') DEFAULT 'waiting',
    played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id_fk) REFERENCES users(id),
    FOREIGN KEY (winner_id_fk) REFERENCES users(id)
);

CREATE TABLE transactions (
    id CHAR(36) PRIMARY KEY,
    user_id_fk CHAR(36),
    game_session_id_fk CHAR(36),
    amount DECIMAL(10, 2) NOT NULL,
    type VARCHAR(20), -- 'bet', 'win', 'refund', 'deposit'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id_fk) REFERENCES users(id),
    FOREIGN KEY (game_session_id_fk) REFERENCES game_sessions(id)
);