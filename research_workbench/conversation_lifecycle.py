"""Application-level clearing of one assistant conversation (schema version 25).

A tombstone row permanently closes one conversation id.  The user's next message
starts a NEW conversation id, so cleared turns can never be replayed into model
history.  Only conversational text is redacted; saved notes, images, datasets,
analyses, charts, captured grants/provenance, events, execution receipts and
model configuration are untouched.  This is application-level clearing, not
physical erasure of SQLite pages or backups.
"""

from datetime import datetime, timezone

from .library import read_metadata
from .models import WorkspaceError

SCHEMA = '''
CREATE TABLE IF NOT EXISTS agent_conversation_clears (
 conversation_id TEXT PRIMARY KEY REFERENCES agent_conversations(id) ON DELETE CASCADE,
 document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL UNIQUE,
 cleared_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS agent_conversation_clear_scope BEFORE INSERT ON agent_conversation_clears
WHEN NOT EXISTS(SELECT 1 FROM agent_conversations WHERE id=NEW.conversation_id AND document_id=NEW.document_id)
BEGIN SELECT RAISE(ABORT,'conversation clear scope'); END;
'''

CLEARED_CODE = 'agent_conversation_cleared'
CLEARED_MESSAGE = '这段对话已清除，请开始新对话。'
BUSY_CODE = 'agent_conversation_busy'
BUSY_MESSAGE = '这段对话还有进行中或等待确认的助手工作，请先停止或完成后再清除。'
CLEARED_TITLE = '已清除的对话'
# Clearing must never cancel or interrupt real work: both checkpoints block it.
BUSY_TURNS = ('queued', 'running', 'waiting_confirmation')
BUSY_TASKS = ('running', 'waiting_confirmation', 'waiting_analysis')


def now():
    return datetime.now(timezone.utc).isoformat()


def is_cleared(connection, conversation_id):
    if not conversation_id:
        return False
    return connection.execute(
        'SELECT 1 FROM agent_conversation_clears WHERE conversation_id=?',
        (conversation_id,)).fetchone() is not None


def reject_cleared(connection, conversation_id):
    """Fence one closed conversation inside the caller's transaction."""
    if is_cleared(connection, conversation_id):
        raise WorkspaceError(CLEARED_CODE, CLEARED_MESSAGE, 410)


class ConversationClears:
    def __init__(self, store):
        self.store = store

    @staticmethod
    def receipt(row):
        return {'id': row['conversation_id'], 'document_id': row['document_id'],
                'cleared': True, 'cleared_at': row['cleared_at']}

    def clear(self, document_id, identifier, payload):
        """Close one conversation, redact its chat text and keep every receipt.

        One BEGIN IMMEDIATE transaction: ownership, replay binding, active work
        refusal, tombstone, redaction and pending-proposal refusal all commit or
        roll back together.  No model key is read and no external call is made.
        """
        request_id = str(payload.request_id)
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            # The conversation row is the ownership check: an unknown id, another
            # document in this Store or another guest Store is one 404 answer.
            if connection.execute(
                    'SELECT 1 FROM agent_conversations WHERE id=? AND document_id=?',
                    (identifier, document_id)).fetchone() is None:
                raise WorkspaceError('not_found', '找不到这段对话。', 404)
            read_metadata(connection, document_id)
            receipt = connection.execute(
                'SELECT * FROM agent_conversation_clears WHERE conversation_id=?',
                (identifier,)).fetchone()
            if receipt is not None:
                if receipt['request_id'] != request_id:
                    raise WorkspaceError('idempotency_conflict',
                                         '这段对话已用其他请求清除，请重试原请求。', 409)
                return self.receipt(receipt)
            if connection.execute(
                    'SELECT 1 FROM agent_conversation_clears WHERE request_id=?',
                    (request_id,)).fetchone() is not None:
                raise WorkspaceError('idempotency_conflict',
                                     '这个清除请求编号已用于其他对话。', 409)
            if connection.execute(
                    "SELECT 1 FROM agent_turns WHERE conversation_id=? AND status IN (?,?,?) LIMIT 1",
                    (identifier, *BUSY_TURNS)).fetchone() is not None:
                raise WorkspaceError(BUSY_CODE, BUSY_MESSAGE, 409)
            if connection.execute(
                    "SELECT 1 FROM agent_tasks WHERE conversation_id=? AND status IN (?,?,?) LIMIT 1",
                    (identifier, *BUSY_TASKS)).fetchone() is not None:
                raise WorkspaceError(BUSY_CODE, BUSY_MESSAGE, 409)
            cleared_at = now()
            connection.execute('INSERT INTO agent_conversation_clears VALUES (?,?,?,?)',
                               (identifier, document_id, request_id, cleared_at))
            # Conversational text only.  Turn ids, request hashes, context grants
            # and provenance stay so later audits keep their original binding.
            connection.execute(
                "UPDATE agent_turns SET message='',answer='',sources_json='[]' WHERE conversation_id=?",
                (identifier,))
            connection.execute('UPDATE agent_conversations SET title=?,updated_at=? WHERE id=?',
                               (CLEARED_TITLE, cleared_at, identifier))
            # Anything still pending is refused here, never executed.
            connection.execute('''UPDATE agent_proposals SET status='rejected',error_json=NULL
                WHERE status='pending' AND turn_id IN
                (SELECT id FROM agent_turns WHERE conversation_id=?)''', (identifier,))
            return {'id': identifier, 'document_id': document_id,
                    'cleared': True, 'cleared_at': cleared_at}
