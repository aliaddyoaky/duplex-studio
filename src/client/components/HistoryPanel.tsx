import { useEffect, useState } from 'react';

import { fetchHistory, type HistorySummary } from '../api.js';

export function HistoryPanel({ projectVersion }: { projectVersion: number }) {
  const [items, setItems] = useState<HistorySummary[]>([]);
  useEffect(() => { let active = true; void fetchHistory().then((value) => { if (active && Array.isArray(value)) setItems(value as HistorySummary[]); }).catch(() => undefined); return () => { active = false; }; }, [projectVersion]);
  return <div className="history-panel"><div className="subheading">历史版本</div>{items.length === 0 ? <p className="empty-copy">完成一次脚本审阅后会出现在这里。</p> : items.slice(0, 8).map((item, index) => <div className="history-row" key={`${item.version}-${item.phase}-${index}`}><b>v{item.version}</b><span>{phaseLabel(item.phase)}</span><small>{item.taskCount} 节点 · {item.artifactCount} 产物</small></div>)}</div>;
}

function phaseLabel(phase: string) { return ({ SCRIPT_REVIEW: '脚本审阅', PRODUCING: '制作中', MIXING: '统一混音', COMPLETED: '已完成', FAILED: '失败' } as Record<string, string>)[phase] ?? phase; }
