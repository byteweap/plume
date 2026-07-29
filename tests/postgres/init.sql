CREATE DATABASE plume_secondary;
CREATE ROLE plume_client LOGIN;

\connect plume

CREATE SCHEMA plume_fixture;
CREATE TABLE plume_fixture.items (
    id bigint PRIMARY KEY,
    label text NOT NULL
);
INSERT INTO plume_fixture.items (id, label)
VALUES (1, 'alpha'), (2, 'beta');

\connect plume_secondary

CREATE SCHEMA plume_fixture;
CREATE TABLE plume_fixture.items (
    id bigint PRIMARY KEY,
    label text NOT NULL
);
INSERT INTO plume_fixture.items (id, label)
VALUES (1, 'secondary-alpha'), (2, 'secondary-beta');
