-- Migration: 0001_m00_prerequisites
-- Scope: PK-01 M00 PostgreSQL prerequisites
-- Authoritative: Canonical docs 20, 22, 51, 58

CREATE EXTENSION IF NOT EXISTS pgcrypto;
