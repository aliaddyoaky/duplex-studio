import type { StateDiffEntry } from '../state/useDemoStore.js';

export function StateDiff({ entries }: { entries: StateDiffEntry[] }) {
  return (
    <div className="state-diff">
      <div className="subheading">最近状态变化</div>
      {entries.length === 0 ? <p className="empty-copy">暂无版本变化。</p> : entries.slice(0, 5).map((entry) => (
        <div className="diff-row" key={entry.path}>
          <code>{entry.path}</code>
          <div><del>{value(entry.before)}</del><span>→</span><ins>{value(entry.after)}</ins></div>
        </div>
      ))}
    </div>
  );
}

function value(input: unknown) {
  if (input === undefined) return '∅';
  return typeof input === 'string' ? input : JSON.stringify(input);
}
