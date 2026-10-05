import { useEffect, useState } from 'react';

import { applyIntentPatch, confirmScript, createProject, fetchAssets, resetDemo, retryTask, setDemoMode, type DemoMode } from './api.js';
import type { Asset, ProjectState, TaskRecord } from '../shared/schemas.js';
import { runGoldenReplay } from './replayGoldenPath.js';
import { AgentBrain } from './components/AgentBrain.js';
import { CreativeCanvas } from './components/CreativeCanvas.js';
import { Metrics } from './components/Metrics.js';
import { RealtimePanel } from './components/RealtimePanel.js';
import { StateDiff } from './components/StateDiff.js';
import { Timeline } from './components/Timeline.js';
import { AssetLibrary } from './components/AssetLibrary.js';
import { HistoryPanel } from './components/HistoryPanel.js';
import { selectMetrics, selectStateDiff, useDemoStore } from './state/useDemoStore.js';

const GOLDEN_BRIEF = {
  product: '低糖气泡咖啡',
  audience: '大学生',
  platform: 'douyin',
  duration: 15,
};

export function App() {
  const { state, refresh, dispatch } = useDemoStore();
  const [busy, setBusy] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const snapshot = state.snapshot;
  const mode = snapshot?.mode ?? 'LIVE';

  const startDemo = async () => {
    setBusy(true);
    try {
      await createProject(GOLDEN_BRIEF);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await resetDemo();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const replayGoldenPath = async () => {
    setBusy(true);
    try {
      await runGoldenReplay();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!snapshot?.state) return;
    setBusy(true);
    try { await confirmScript(snapshot.state.projectId, snapshot.state.version); await refresh(); } catch (error) { dispatch({ type: 'ERROR', message: error instanceof Error ? error.message : String(error) }); } finally { setBusy(false); }
  };

  const createFromBrief = async (brief: typeof GOLDEN_BRIEF) => {
    setBusy(true);
    try { await createProject(brief); await refresh(); } finally { setBusy(false); }
  };

  const changeSource = async (sceneId: string, source: 'generated_video' | 'existing_asset') => {
    if (!snapshot?.state) return;
    await applyIntentPatch({ patchId: `source_${Date.now()}`, baseVersion: snapshot.state.version, changes: { [`scenes.${sceneId}.source`]: source }, userSummary: `${sceneId} 使用${source === 'existing_asset' ? '真实素材' : 'AI 生成'}` });
    await refresh();
  };

  const retry = async (taskId: string) => {
    await retryTask(taskId);
    await refresh();
  };

  const changeMode = async (next: DemoMode) => {
    await setDemoMode(next);
    await refresh();
  };

  const refreshAssets = async () => {
    try { setAssets(await fetchAssets()); } catch { /* asset library is optional during runtime startup */ }
  };
  useEffect(() => { void refreshAssets(); }, []);

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">D</div>
          <div><h1>Duplex Studio</h1><span>实时创意代理 · 面试演示版</span></div>
        </div>
        <div className="top-actions">
          <div className="mode-switch" aria-label="演示模式">
            {(['LIVE', 'HYBRID', 'REPLAY'] as DemoMode[]).map((item) => (
              <button className={mode === item ? 'active' : ''} onClick={() => void changeMode(item)} key={item}>{modeLabel(item)}</button>
            ))}
          </div>
          <span className={`runtime-pill ${state.runtimeConnected ? 'online' : ''}`}><i />{state.runtimeConnected ? '运行时在线' : '正在连接'}</span>
          {mode === 'REPLAY' && (
            <button className="primary-action" onClick={() => void replayGoldenPath()} disabled={busy}>{busy ? '正在回放…' : '运行黄金回放'}</button>
          )}
          {!snapshot?.state && mode !== 'REPLAY' ? (
            <button className="primary-action" onClick={() => void startDemo()} disabled={busy}>{busy ? '生成中…' : '使用种子简报'}</button>
          ) : snapshot?.state ? (
            <button className="reset-button" onClick={() => void reset()} disabled={busy}>↻ 重置演示</button>
          ) : null}
        </div>
      </header>

      {state.error && <div className="global-error">运行时：{state.error}</div>}

      <div className="studio-grid">
        <div className="left-column"><RealtimePanel stateVersion={snapshot?.state?.version ?? 0} phase={snapshot?.state?.phase} projectId={snapshot?.state?.projectId} runtimeContext={buildRealtimeContext(snapshot?.state ?? null, snapshot?.tasks ?? [])} runtimeConnected={state.runtimeConnected} onProjectChanged={() => void refresh()} onConfirmScript={() => void confirm()} /><AssetLibrary assets={assets} onChanged={() => void refreshAssets()} /></div>
        <CreativeCanvas state={snapshot?.state ?? null} tasks={snapshot?.tasks ?? []} artifacts={snapshot?.artifacts ?? []} onCreateProject={(brief) => void createFromBrief(brief)} onConfirmScript={() => void confirm()} onChangeSource={(sceneId, source) => void changeSource(sceneId, source)} busy={busy} />
        <AgentBrain
          tasks={snapshot?.tasks ?? []}
          events={state.events}
          staleTaskIds={state.staleTaskIds}
          selectedTaskId={state.selectedTaskId}
          onSelectTask={(taskId) => dispatch({ type: 'SELECT_TASK', taskId })}
          onRetry={(taskId) => void retry(taskId)}
        />
        <section className="panel observatory-panel">
          <div className="observatory-main"><Timeline events={state.events} /></div>
          <div className="observatory-side">
            <Metrics metrics={selectMetrics(state)} />
            <StateDiff entries={selectStateDiff(state)} />
            <HistoryPanel projectVersion={snapshot?.state?.version ?? 0} />
          </div>
        </section>
      </div>
    </main>
  );
}

function buildRealtimeContext(state: ProjectState | null, tasks: TaskRecord[]): string {
  if (!state) return '当前还没有项目。等待用户提供需求后创建项目。';
  return JSON.stringify({
    projectId: state.projectId,
    version: state.version,
    phase: state.phase,
    brief: state.brief,
    creative: state.creative,
    script: state.script,
    scenes: state.scenes,
    tasks: tasks.map((task) => ({
      id: task.id,
      type: task.type,
      status: task.status,
      inputs: task.trace?.inputs,
      outputs: task.trace?.outputs,
      downstream: task.trace?.downstream,
      error: task.trace?.error,
    })),
  }, null, 2);
}

function modeLabel(mode: DemoMode) {
  return { LIVE: '实时', HYBRID: '混合', REPLAY: '回放' }[mode];
}
