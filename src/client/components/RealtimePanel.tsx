import { useEffect, useRef, useState } from 'react';

import { confirmScript as confirmScriptApi } from '../api.js';
import { createLiveSession, type LiveSessionController } from '../realtime/liveSession.js';
import type { ProjectPhase } from '../../shared/schemas.js';

interface TranscriptLine {
  speaker: 'user' | 'agent';
  text: string;
}

export function RealtimePanel(props: {
  stateVersion: number;
  runtimeConnected: boolean;
  projectId?: string;
  onProjectChanged(): void;
  onConfirmScript?(): void;
  phase?: ProjectPhase;
  runtimeContext?: string;
}) {
  const versionRef = useRef(props.stateVersion);
  const phaseRef = useRef(props.phase);
  const contextRef = useRef(props.runtimeContext ?? '');
  const projectIdRef = useRef(props.projectId);
  const confirmRef = useRef(props.onConfirmScript);
  confirmRef.current = props.onConfirmScript;
  projectIdRef.current = props.projectId;
  const controllerRef = useRef<LiveSessionController | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<'disconnected' | 'connected' | 'speaking' | 'error'>('disconnected');
  const [micActive, setMicActive] = useState(false);
  const [lines, setLines] = useState<TranscriptLine[]>(() => loadTranscript());
  const [error, setError] = useState<string | null>(null);
  versionRef.current = props.stateVersion;
  phaseRef.current = props.phase;
  contextRef.current = props.runtimeContext ?? '';

  if (!controllerRef.current) {
    controllerRef.current = createLiveSession({
      getStateVersion: () => versionRef.current,
      getRuntimeContext: () => contextRef.current,
      onTranscript: (text, speaker) => {
        setLines((current) => {
          const last = current[current.length - 1];
          if (last && last.speaker === speaker && !last.text.startsWith('↳')) {
            // 转写流可能是增量片段，也可能是从头累积的完整句（以旧行开头），两种都正确合并
            const mergedText = text.startsWith(last.text) ? text : last.text + text;
            return [...current.slice(0, -1), { speaker, text: mergedText }].slice(-24);
          }
          return [...current, { speaker, text }].slice(-24);
        });
      },
      onUserTurn: (text, version) => {
        if (version === versionRef.current && phaseRef.current === 'SCRIPT_REVIEW' && isExplicitStartCommand(text)) confirmRef.current?.();
      },
      onSpeaking: (speaking) => setVoiceStatus(speaking ? 'speaking' : 'connected'),
      onInterrupted: () => setLines((current) => [...current, { speaker: 'agent', text: '↳ 已中断，播放内容已清除' }]),
      onProjectCreated: () => props.onProjectChanged(),
      onIntentPatch: () => props.onProjectChanged(),
      // 模型通过 confirmScript 工具调用触发制作：走真正的 Runtime 确认接口
      postConfirmScript: async (scriptVersion) => {
        const projectId = projectIdRef.current;
        if (!projectId) throw new Error('还没有可确认的项目');
        const state = await confirmScriptApi(projectId, scriptVersion);
        return { stateVersion: state.version, phase: state.phase };
      },
      onConfirmScript: () => props.onProjectChanged(),
    });
  }

  useEffect(() => () => controllerRef.current?.disconnect(), []);
  useEffect(() => {
    window.localStorage.setItem('duplex-studio-transcript', JSON.stringify(lines.slice(-24)));
  }, [lines]);
  // 演示重置（版本从 >0 归零）时清空转写，避免残留上一个项目的对话
  const prevVersionRef = useRef(props.stateVersion);
  useEffect(() => {
    if (prevVersionRef.current > 0 && props.stateVersion === 0) {
      window.localStorage.removeItem('duplex-studio-transcript');
      setLines((current) => (current.length === 0 ? current : []));
    }
    prevVersionRef.current = props.stateVersion;
  }, [props.stateVersion]);

  const connect = async () => {
    setError(null);
    try {
      await controllerRef.current?.connect();
      setVoiceStatus('connected');
      // 连接成功后直接开始监听，免去“再点一次”的第二步
      try {
        await controllerRef.current?.startMic();
        setMicActive(true);
      } catch (micError) {
        setMicActive(false);
        setError(`麦克风启动失败：${micError instanceof Error ? micError.message : String(micError)}`);
      }
    } catch (caught) {
      setVoiceStatus('error');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const toggleMic = async () => {
    setError(null);
    try {
      if (micActive) {
        controllerRef.current?.stopMic();
        setMicActive(false);
      } else {
        await controllerRef.current?.startMic();
        setMicActive(true);
      }
    } catch (caught) {
      setMicActive(false);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const disconnect = () => {
    controllerRef.current?.disconnect();
    setMicActive(false);
    setVoiceStatus('disconnected');
  };

  return (
    <section className="panel realtime-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">系统 1 · 实时交互</span>
          <h2>双工语音</h2>
        </div>
        <span className={`status-dot ${voiceStatus}`} title={voiceStatusLabel(voiceStatus)} />
      </div>

      <div className="voice-orb-wrap">
        <button className={`voice-orb ${micActive ? 'active' : ''}`} onClick={voiceStatus === 'disconnected' ? connect : toggleMic}>
          <span className="voice-bars"><i /><i /><i /><i /><i /></span>
          <strong>{voiceStatus === 'disconnected' ? '连接语音' : micActive ? '正在聆听' : '点击说话'}</strong>
          <small>{voiceStatus === 'speaking' ? '代理正在说话' : 'Gemini 3.8 Live'}</small>
        </button>
      </div>

      <div className="connection-row">
        <span><b className={props.runtimeConnected ? 'ok-text' : 'warn-text'}>●</b> 运行时{props.runtimeConnected ? '在线' : '离线'}</span>
        <span>状态 v{props.stateVersion || '—'}</span>
      </div>

      <div className="transcript" aria-label="实时转写">
        {lines.length === 0 ? (
          <p className="empty-copy">连接语音后，实时转写和打断会显示在这里。</p>
        ) : (
          lines.map((line, index) => (
            <div className={`transcript-line ${line.speaker}`} key={`${index}-${line.text}`}>
              <span>{line.speaker === 'user' ? '你' : '代理'}</span>
              <p>{line.text}</p>
            </div>
          ))
        )}
      </div>
      {error && <div className="inline-error">{error}</div>}
      {voiceStatus !== 'disconnected' && <button className="text-button" onClick={disconnect}>断开语音</button>}
    </section>
  );
}

export function isExplicitStartCommand(text: string): boolean {
  const normalized = text.replace(/[，。！？、,.!?\s]/g, '');
  // 否定/推迟语义一律不触发，哪怕句子里出现“开始制作”
  if (/(不要|先不|暂不|暂时不|还不|没准备好|别|先别|不用|无法|不能|等一?下|等会|再说|从头开始|重新开始)/.test(normalized)) return false;
  // 自然语句中的明确确认（如“好的，开始制作吧”），或整句就是一个短确认词
  return /(开始制作|确认脚本|确认并开始|开始吧|可以开始|现在开始|制作吧|开工)/.test(normalized)
    || /^(开始|确认|确认开始|确认制作)$/.test(normalized);
}

function loadTranscript(): TranscriptLine[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem('duplex-studio-transcript') ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((line): line is TranscriptLine =>
      line && (line.speaker === 'user' || line.speaker === 'agent') && typeof line.text === 'string',
    ).slice(-24);
  } catch {
    return [];
  }
}

function voiceStatusLabel(status: 'disconnected' | 'connected' | 'speaking' | 'error') {
  return {
    disconnected: '未连接',
    connected: '已连接',
    speaking: '代理说话中',
    error: '连接错误',
  }[status];
}
