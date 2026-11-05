"""Workspace-scoped, append-only reusable chart skills.

A skill has a stable id (the creating request id) and immutable revisions.  The
creating request itself is revision 1; later edits append exactly one version.
Idempotent retries return the exact original revision even after newer edits, and
a mismatched reuse of a request id is a conflict rather than an overwrite.
"""
import hashlib
import json
import sqlite3

from .agent_store import canonical,digest,now
from .chart_skill_models import ChartSkillSnapshot,skill_hash
from .models import WorkspaceError

MAX_SKILLS=100
MAX_VERSIONS=100


def changed(message='绘图 skill 已变化，请重新选择。'):
    return WorkspaceError('chart_skill_changed',message,409)


class ChartSkills:
    def __init__(self,store):
        self.store=store

    def record(self,row):
        spec=json.loads(row['spec_json'])
        if hashlib.sha256(canonical(spec).encode('utf-8')).hexdigest()!=row['sha256']:
            raise changed('保存的绘图 skill 与哈希不一致。')
        return {'id':row['skill_id'],'revision':row['revision'],'sha256':row['sha256'],'spec':spec,
            'created_at':row['created_at'],'updated_at':row['updated_at']}

    @staticmethod
    def latest(connection,skill_id):
        return connection.execute('SELECT * FROM chart_skill_versions WHERE skill_id=? ORDER BY revision DESC LIMIT 1',
            (skill_id,)).fetchone()

    def list(self):
        with self.store.connection() as connection:
            rows=connection.execute('''SELECT v.* FROM chart_skill_versions v JOIN (
                SELECT skill_id,MAX(revision) AS revision FROM chart_skill_versions GROUP BY skill_id) latest
                ON latest.skill_id=v.skill_id AND latest.revision=v.revision
                ORDER BY v.updated_at DESC,v.skill_id DESC LIMIT ?''',(MAX_SKILLS,))
            return {'items':[self.record(row) for row in rows]}

    def get(self,identifier):
        with self.store.connection() as connection:
            row=self.latest(connection,identifier)
            if row is None:raise WorkspaceError('not_found','找不到这个绘图 skill。',404)
            return self.record(row)

    def create(self,payload):
        spec=payload.spec.model_dump(mode='json')
        signature=digest({'operation':'create','spec':spec})
        skill_id=str(payload.request_id)
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            existing=connection.execute('SELECT request_hash FROM chart_skills WHERE id=?',(skill_id,)).fetchone()
            if existing is not None:
                if existing['request_hash']!=signature:
                    raise WorkspaceError('idempotency_conflict','这个新建编号已用于另一份绘图 skill。',409)
                row=connection.execute('SELECT * FROM chart_skill_versions WHERE skill_id=? AND revision=1',(skill_id,)).fetchone()
                if row is None:raise changed('保存的绘图 skill 已损坏。')
                return self.record(row),False
            if connection.execute('SELECT 1 FROM chart_skill_versions WHERE request_id=?',(skill_id,)).fetchone():
                raise WorkspaceError('idempotency_conflict','这个新建编号已用于另一份绘图 skill。',409)
            if connection.execute('SELECT COUNT(*) FROM chart_skills').fetchone()[0]>=MAX_SKILLS:
                raise WorkspaceError('chart_skill_quota','绘图 skill 数量已达上限（100）。',413)
            stamp=now()
            try:
                connection.execute('INSERT INTO chart_skills VALUES (?,?,?)',(skill_id,signature,stamp))
                connection.execute('INSERT INTO chart_skill_versions VALUES (?,1,?,?,?,?,?,?)',
                    (skill_id,skill_id,signature,skill_hash(spec),canonical(spec),stamp,stamp))
            except sqlite3.IntegrityError:
                raise WorkspaceError('idempotency_conflict','这个新建编号已用于另一份绘图 skill。',409) from None
            row=connection.execute('SELECT * FROM chart_skill_versions WHERE skill_id=? AND revision=1',(skill_id,)).fetchone()
            return self.record(row),True

    def versions(self,skill_id,payload):
        spec=payload.spec.model_dump(mode='json')
        signature=digest({'operation':'version','skill_id':skill_id,'expected_revision':payload.expected_revision,'spec':spec})
        with self.store.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            replay=connection.execute('SELECT * FROM chart_skill_versions WHERE request_id=?',(str(payload.request_id),)).fetchone()
            if replay is not None:
                if replay['skill_id']!=skill_id or replay['request_hash']!=signature:
                    raise WorkspaceError('idempotency_conflict','这个保存编号已用于其他绘图 skill 请求。',409)
                return self.record(replay),False
            skill=connection.execute('SELECT * FROM chart_skills WHERE id=?',(skill_id,)).fetchone()
            if skill is None:raise WorkspaceError('not_found','找不到这个绘图 skill。',404)
            latest=self.latest(connection,skill_id)
            if latest is None:raise changed('保存的绘图 skill 已损坏。')
            if latest['revision']!=payload.expected_revision:
                raise WorkspaceError('revision_conflict','绘图 skill 已更新，请重新查看。',409)
            if latest['revision']>=MAX_VERSIONS:
                raise WorkspaceError('chart_skill_quota','这个绘图 skill 的版本已达上限（100）。',413)
            revision=latest['revision']+1;stamp=now()
            try:
                connection.execute('INSERT INTO chart_skill_versions VALUES (?,?,?,?,?,?,?,?)',
                    (skill_id,revision,str(payload.request_id),signature,skill_hash(spec),canonical(spec),
                     skill['created_at'],stamp))
            except sqlite3.IntegrityError:
                raise WorkspaceError('idempotency_conflict','这个保存编号已用于其他绘图 skill 请求。',409) from None
            row=connection.execute('SELECT * FROM chart_skill_versions WHERE skill_id=? AND revision=?',(skill_id,revision)).fetchone()
            return self.record(row),True

    def export(self,identifier):
        record=self.get(identifier)
        return record['spec'],'chart-skill-'+identifier+'.json'

    def snapshot(self,connection,reference):
        skill_id=str(reference.id)
        row=self.latest(connection,skill_id)
        if row is None:raise WorkspaceError('not_found','找不到这个绘图 skill。',404)
        if row['revision']!=reference.revision or row['sha256']!=reference.sha256:
            raise changed('所选绘图 skill 版本或哈希已变化，请重新选择。')
        spec=json.loads(row['spec_json'])
        if hashlib.sha256(canonical(spec).encode('utf-8')).hexdigest()!=row['sha256']:
            raise changed('保存的绘图 skill 与哈希不一致。')
        return {'id':skill_id,'revision':row['revision'],'sha256':row['sha256'],'spec':spec}

    @staticmethod
    def frozen(snapshot):
        """Revalidate a stored snapshot without consulting the current recipe."""
        try:
            checked=ChartSkillSnapshot.model_validate(snapshot).model_dump(mode='json')
        except ValueError:raise changed('图表保存的绘图 skill 快照无效。') from None
        if checked!=snapshot:raise changed('图表保存的绘图 skill 快照无效。')
        if hashlib.sha256(canonical(snapshot['spec']).encode('utf-8')).hexdigest()!=snapshot['sha256']:
            raise changed('图表保存的绘图 skill 快照哈希不一致。')
        return snapshot
