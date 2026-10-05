import type { TaskRecord } from '../../shared/schemas.js';

export function NodeDetail(props: { task: TaskRecord | null; onRetry?: (taskId: string) => void }) {
  if (!props.task) {
    return <div className="node-detail empty-copy">选择一个节点查看输入、输出和错误。</div>;
  }
  const trace = props.task.trace;
  return (
    <aside className="node-detail" aria-label="节点详情">
      <div className="node-detail-heading"><div><span className="eyebrow">节点详情</span><h3>{taskLabel(props.task.type)}</h3></div><span className={`detail-status ${props.task.status}`}>{statusLabel(props.task.status)}</span></div>
      <div className="detail-meta">{props.task.id} · v{props.task.stateVersion} · 第 {trace?.attempt ?? 1} 次尝试{trace?.durationMs !== undefined ? ` · ${trace.durationMs}ms` : ''}</div>
      <details open><summary>输入</summary>{trace?.inputs?.length ? trace.inputs.map((item) => <div className="trace-row" key={`${item.name}-${item.ref}`}><b>{item.name}</b><span>{item.summary}</span></div>) : <p className="empty-copy">暂无输入摘要</p>}</details>
      <details><summary>输出</summary>{trace?.outputs?.length ? trace.outputs.map((item) => <div className="trace-row" key={`${item.name}-${item.ref}`}><b>{item.name}</b><span>{item.summary}</span></div>) : <p className="empty-copy">暂无输出</p>}</details>
      <details><summary>下游</summary>{trace?.downstream?.length ? <p className="trace-list">{trace.downstream.join(' → ')}</p> : <p className="empty-copy">没有下游节点</p>}</details>
      {trace?.error && <details open className="detail-error"><summary>错误</summary><p>{trace.error.code}: {trace.error.message}</p>{trace.error.retryable && props.onRetry && <button className="text-button" onClick={() => props.onRetry?.(props.task!.id)}>重试此节点</button>}</details>}
    </aside>
  );
}

function taskLabel(type: string) {
  if (type.startsWith('generated_scene:')) return `生成镜头 · ${type.slice('generated_scene:'.length)}`;
  return ({ product_analysis: '产品分析', script: '脚本生成', asset_search: '素材匹配', storyboard: '分镜脚本', prompt_lint: '提示词检查', audio_voiceover: '统一口播', audio_bgm: '统一 BGM', audio_sfx: '音效准备', render: '最终混音与渲染' } as Record<string, string>)[type] ?? type;
}

function statusLabel(status: string) {
  return ({ pending: '排队中', running: '运行中', completed: '已完成', cancelled: '已取消', stale: '已过期', failed: '失败' } as Record<string, string>)[status] ?? status;
}
