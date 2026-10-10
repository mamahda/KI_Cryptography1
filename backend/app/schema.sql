-- Applied on every server start, so every statement must be idempotent.
-- Compatible with MySQL 8 and MariaDB 10.6+.

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(32)     NOT NULL,
  password_hash VARCHAR(100)    NOT NULL,
  created_at    DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash BINARY(32)      NOT NULL PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(6)     NOT NULL,
  created_at DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per (user, algorithm): the profile JSON encrypted three times.
CREATE TABLE IF NOT EXISTS profiles (
  user_id    BIGINT UNSIGNED           NOT NULL,
  algorithm  ENUM('AES','DES','RC4')   NOT NULL,
  iv         VARBINARY(16)             NOT NULL,
  ciphertext MEDIUMBLOB                NOT NULL,
  mac        BINARY(32)                NOT NULL,
  encrypt_ns BIGINT                    NOT NULL,
  updated_at DATETIME(6)               NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, algorithm),
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS files (
  id         CHAR(36)                               NOT NULL PRIMARY KEY,
  user_id    BIGINT UNSIGNED                        NOT NULL,
  category   ENUM('id_card','document','video')     NOT NULL,
  mime_type  VARCHAR(127)                           NOT NULL,
  size_plain BIGINT                                 NOT NULL,
  created_at DATETIME(6)                            NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_files_user (user_id, category, created_at),
  CONSTRAINT fk_files_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per (file, algorithm). The ciphertext lives on disk at
-- storage_path. The original filename is encrypted alongside it.
CREATE TABLE IF NOT EXISTS file_variants (
  file_id          CHAR(36)                 NOT NULL,
  algorithm        ENUM('AES','DES','RC4')  NOT NULL,
  storage_path     VARCHAR(255)             NOT NULL,
  iv               VARBINARY(16)            NOT NULL,
  mac              BINARY(32)               NOT NULL,
  name_iv          VARBINARY(16)            NOT NULL,
  name_ciphertext  VARBINARY(1024)          NOT NULL,
  name_mac         BINARY(32)               NOT NULL,
  size_cipher      BIGINT                   NOT NULL,
  encrypt_ns       BIGINT                   NOT NULL,
  encrypt_total_ns BIGINT                   NOT NULL,
  PRIMARY KEY (file_id, algorithm),
  CONSTRAINT fk_variants_file FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS benchmarks (
  id          BIGINT UNSIGNED                         NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED                         NOT NULL,
  file_id     CHAR(36)                                NULL,
  algorithm   ENUM('AES','DES','RC4')                 NOT NULL,
  operation   ENUM('encrypt','decrypt','download')    NOT NULL,
  source      ENUM('server','client')                 NOT NULL,
  bytes       BIGINT                                  NOT NULL,
  run_index   INT                                     NOT NULL,
  duration_ns BIGINT                                  NOT NULL,
  created_at  DATETIME(6)                             NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_bench_user (user_id, file_id),
  CONSTRAINT fk_bench_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_bench_file FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
