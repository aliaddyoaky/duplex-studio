import type { RuntimeMetrics } from '../../shared/events.js';

export function Metrics({ metrics }: { metrics: RuntimeMetrics }) {
  const items = [
    ['首次响应', formatMs(metrics.firstResponseMs)],
    ['打断响应', formatMs(metrics.interruptReactionMs)],
    ['重规划', formatMs(metrics.replanLatencyMs)],
    ['任务复用', metrics.taskReuseRate === null ? '—' : `${Math.round(metrics.taskReuseRate * 100)}%`],
  ];
  return <div className="metrics-grid">{items.map(([label, value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}

function formatMs(value: number | null) {
  return value === null ? '—' : `${Math.max(0, Math.round(value))} ms`;
}
