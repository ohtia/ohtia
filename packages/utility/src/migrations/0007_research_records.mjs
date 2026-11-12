import { sql } from "kysely";

// Keep this module self-contained: its exact bytes identify the immutable migration.
/** @param {string} name */
const uuid = (name) =>
  `typeof(${name})='blob' AND length(${name})=16 AND substr(hex(${name}),13,1)='7' AND substr(hex(${name}),17,1) IN ('8','9','A','B')`;
/** @param {string} name */
const time = (name) =>
  `typeof(${name})='text' AND length(${name})=24 AND ${name} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z' AND strftime('%Y-%m-%dT%H:%M:%fZ',${name},'+0 seconds') IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',${name},'+0 seconds')=${name}`;
const whitespace = "char(9,10,11,12,13,32,133,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)";
/** @param {string} name */
const title = (name) =>
  `${name} IS NULL OR (typeof(${name})='text' AND length(${name}) BETWEEN 1 AND 200 AND instr(${name},char(0))=0 AND trim(${name},${whitespace})=${name})`;
const languages = ["[a-z][a-z]", "[a-z][a-z][a-z]"];
const scripts = ["", "-[A-Z][a-z][a-z][a-z]"];
const regions = ["", "-[A-Z][A-Z]", "-[0-9][0-9][0-9]"];
const language = languages.flatMap((l) =>
  scripts.flatMap((s) => regions.map((r) => `document_language GLOB '${l}${s}${r}'`)),
).join(" OR ");

export const tables = {
  projects: `CREATE TABLE projects (
    id BLOB PRIMARY KEY NOT NULL CHECK (${uuid("id")}),
    project_type TEXT NOT NULL CHECK (project_type='thesis'),
    title TEXT CHECK (${title("title")}),
    document_language TEXT CHECK (document_language IS NULL OR (typeof(document_language)='text' AND instr(document_language,char(0))=0 AND (${language}))),
    is_development INTEGER NOT NULL CHECK (typeof(is_development)='integer' AND is_development IN (0,1)),
    setup_confirmed_at TEXT CHECK (setup_confirmed_at IS NULL OR (${time("setup_confirmed_at")})),
    created_at TEXT NOT NULL CHECK (${time("created_at")}),
    updated_at TEXT NOT NULL CHECK (${time("updated_at")}),
    CHECK ((title IS NULL AND document_language IS NULL AND setup_confirmed_at IS NULL) OR (title IS NOT NULL AND document_language IS NOT NULL AND setup_confirmed_at IS NOT NULL))
  )`,
  conversations: `CREATE TABLE conversations (
    id BLOB PRIMARY KEY NOT NULL CHECK (${uuid("id")}),
    project_id BLOB NOT NULL REFERENCES projects(id) CHECK (${uuid("project_id")}),
    title TEXT CHECK (${title("title")}),
    created_at TEXT NOT NULL CHECK (${time("created_at")}),
    updated_at TEXT NOT NULL CHECK (${time("updated_at")}),
    revision INTEGER NOT NULL CHECK (typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991)
  )`,
  messages: `CREATE TABLE messages (
    id BLOB PRIMARY KEY NOT NULL CHECK (${uuid("id")}),
    conversation_id BLOB NOT NULL REFERENCES conversations(id) CHECK (${uuid("conversation_id")}),
    position INTEGER NOT NULL CHECK (typeof(position)='integer' AND position BETWEEN 1 AND 9007199254740991),
    author_kind TEXT NOT NULL CHECK (author_kind IN ('researcher','agent')),
    agent_id TEXT,
    content TEXT NOT NULL CHECK (typeof(content)='text' AND length(CAST(content AS BLOB))>0),
    created_at TEXT NOT NULL CHECK (${time("created_at")}),
    UNIQUE (conversation_id,position),
    CHECK ((author_kind='researcher' AND agent_id IS NULL) OR (author_kind='agent' AND agent_id IS NOT NULL AND agent_id IN ('virgilio','josefa','jorge-luis','erasmus','boris','maria','thomas')))
  )`,
  command_receipts: `CREATE TABLE command_receipts (
    operation_id TEXT PRIMARY KEY NOT NULL CHECK (typeof(operation_id)='text' AND length(operation_id) BETWEEN 1 AND 128 AND substr(operation_id,1,1) GLOB '[A-Za-z0-9]' AND operation_id NOT GLOB '*[^A-Za-z0-9_-]*'),
    command TEXT NOT NULL CHECK (typeof(command)='text' AND length(command)>0),
    payload_sha256 BLOB NOT NULL CHECK (typeof(payload_sha256)='blob' AND length(payload_sha256)=32),
    result_id BLOB NOT NULL CHECK (${uuid("result_id")}),
    created_at TEXT NOT NULL CHECK (${time("created_at")})
  )`,
};
export const objects = {
  conversations_project: "CREATE INDEX conversations_project ON conversations(project_id)",
  projects_identity: `CREATE TRIGGER projects_identity BEFORE UPDATE ON projects
    WHEN NEW.id<>OLD.id OR NEW.project_type<>OLD.project_type OR NEW.is_development<>OLD.is_development OR NEW.created_at<>OLD.created_at
    BEGIN SELECT RAISE(ABORT,'Immutable project identity'); END`,
  projects_setup: `CREATE TRIGGER projects_setup BEFORE UPDATE ON projects
    WHEN NEW.setup_confirmed_at IS NULL AND (SELECT count(*) FROM conversations WHERE project_id=OLD.id)<>1
    BEGIN SELECT RAISE(ABORT,'Setup requires one conversation'); END`,
  conversations_initial: `CREATE TRIGGER conversations_initial BEFORE INSERT ON conversations
    WHEN NEW.revision<>1 OR NEW.updated_at<>NEW.created_at OR
      ((SELECT setup_confirmed_at FROM projects WHERE id=NEW.project_id) IS NULL AND EXISTS (SELECT 1 FROM conversations WHERE project_id=NEW.project_id))
    BEGIN SELECT RAISE(ABORT,'Invalid initial conversation'); END`,
  conversations_changes: `CREATE TRIGGER conversations_changes BEFORE UPDATE ON conversations
    WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1 OR
      (NEW.title IS NOT OLD.title AND NEW.updated_at<=OLD.updated_at) OR
      (NEW.updated_at<>OLD.updated_at AND (NEW.title IS NULL OR NEW.updated_at<=OLD.updated_at))
    BEGIN SELECT RAISE(ABORT,'Invalid conversation change'); END`,
  conversations_setup_delete: `CREATE TRIGGER conversations_setup_delete BEFORE DELETE ON conversations
    WHEN (SELECT setup_confirmed_at FROM projects WHERE id=OLD.project_id) IS NULL
    BEGIN SELECT RAISE(ABORT,'Setup conversation required'); END`,
  messages_position: `CREATE TRIGGER messages_position BEFORE INSERT ON messages
    WHEN NEW.author_kind='researcher' AND NEW.position<=(SELECT coalesce(max(position),0) FROM messages WHERE conversation_id=NEW.conversation_id)
    BEGIN SELECT RAISE(ABORT,'Message position must advance'); END`,
  messages_revision: `CREATE TRIGGER messages_revision AFTER INSERT ON messages
    BEGIN UPDATE conversations SET revision=revision+1 WHERE id=NEW.conversation_id; END`,
  messages_update: `CREATE TRIGGER messages_update BEFORE UPDATE ON messages
    BEGIN SELECT RAISE(ABORT,'Immutable message'); END`,
  messages_delete: `CREATE TRIGGER messages_delete BEFORE DELETE ON messages
    BEGIN SELECT RAISE(ABORT,'Immutable message'); END`,
  receipts_update: `CREATE TRIGGER receipts_update BEFORE UPDATE ON command_receipts
    BEGIN SELECT RAISE(ABORT,'Immutable command receipt'); END`,
  receipts_delete: `CREATE TRIGGER receipts_delete BEFORE DELETE ON command_receipts
    BEGIN SELECT RAISE(ABORT,'Immutable command receipt'); END`,
};
/** @param {import("kysely").Kysely<unknown>} database */
export async function up(database) {
  for (const statement of [...Object.values(tables), ...Object.values(objects)])
    await sql.raw(statement).execute(database);
}
