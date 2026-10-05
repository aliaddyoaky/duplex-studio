import type { RuntimeEvent } from '../../shared/events.js';
import type { TaskRecord } from '../../shared/schemas.js';
import { NodeDetail } from './NodeDetail.js';

export function AgentBrain(props: { tasks: TaskRecord[]; events: RuntimeEvent[]; staleTaskIds: string[]; selectedTaskId?: string | null; onSelectTask?: (taskId: string) => void; onRetry?: (taskId: string) => void }) {
  const currentVersion = Math.max(0, ...props.tasks.map((task) => task.stateVersion));
  const visible = props.tasks.filter((task) => task.stateVersion === currentVersion || task.status === 'stale').slice(-10);
  const decisions = props.events
    .filter((event) => ['TASK_REUSED', 'TASK_CANCELLED', 'STALE_RESULT_DROPPED', 'NEW_TASK_GRAPH_STARTED'].includes(event.type))
    .slice(-6)
    .reverse();

  return (
    <section className="panel brain-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">系统 2 · 运行时</span>
          <h2>创意大脑</h2>
        </div>
        <span className="brain-pulse">⌁</span>
      </div>
      <div className="graph-stack">
        {visible.length === 0 ? <p className="empty-copy">创建项目后，任务图会显示在这里。</p> : visible.map((task) => (
          <button className={`graph-task ${task.status} ${props.selectedTaskId === task.id ? 'selected' : ''}`} key={`${task.id}-${task.stateVersion}`} onClick={() => props.onSelectTask?.(task.id)}>
            <span className="node-icon">{task.status === 'completed' ? '✓' : task.status === 'cancelled' ? '×' : task.status === 'stale' ? '!' : '•'}</span>
            <div><b>{prettyTask(task.type)}</b><small>{task.id}</small></div>
            <span className="node-status">{props.staleTaskIds.includes(task.id) ? '已过期' : statusLabel(task.status)}</span>
          </button>
        ))}
      </div>
      {props.tasks.find((task) => task.type === 'script')?.trace?.inputs.find((input) => input.kind === 'provider') && (
        <div className="model-note">脚本模型：{props.tasks.find((task) => task.type === 'script')?.trace?.inputs.find((input) => input.kind === 'provider')?.summary}</div>
      )}
      <div className="decision-log">
        <div className="subheading">重规划决策</div>
        {decisions.map((event) => (
          <div className={`decision ${event.type.toLowerCase()}`} key={event.sequence}>
            <time>#{event.sequence}</time>
            <span>{eventLabel(event)}</span>
          </div>
        ))}
      </div>
      <NodeDetail task={props.tasks.find((task) => task.id === props.selectedTaskId) ?? null} onRetry={props.onRetry} />
    </section>
  );
}

function prettyTask(type: string) {
  if (type.startsWith('generated_scene:')) return `生成镜头 · ${type.slice('generated_scene:'.length)}`;
  const labels: Record<string, string> = {
    script: '脚本',
    product_analysis: '产品分析',
    asset_search: '素材搜索',
    storyboard: '分镜脚本',
    render: '渲染预览',
    image_reference: '参考图',
  };
  if (type.startsWith('generate_')) return `生成 · ${type.slice('generate_'.length)}`;
  return labels[type] ?? type.replaceAll('_', ' ');
}

function eventLabel(event: RuntimeEvent) {
  const name = String(event.payload.taskType ?? event.payload.taskId ?? '任务图');
  if (event.type === 'TASK_REUSED') return `复用  ${prettyTask(name)}`;
  if (event.type === 'TASK_CANCELLED') return `取消  ${prettyTask(name)}`;
  if (event.type === 'STALE_RESULT_DROPPED') return `过期结果已丢弃  ${prettyTask(name)}`;
  return `重规划 → v${event.stateVersion ?? '?'}`;
}

function statusLabel(status: string) {
  return {
    queued: '排队中',
    running: '运行中',
    completed: '已完成',
    cancelled: '已取消',
    stale: '已过期',
    failed: '失败',
  }[status] ?? status;
}
