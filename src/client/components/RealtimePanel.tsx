import { useEffect, useRef, useState } from 'react';

import { createLiveSession, type LiveSessionController } from '../realtime/liveSession.js';

interface TranscriptLine {
  speaker: 'user' | 'agent';
  text: string;
}

export function RealtimePanel(props: {
  stateVersion: number;
  runtimeConnected: boolean;
  onProjectChanged(): void;
  onConfirmScript?(): void;
}) {
  const versionRef = useRef(props.stateVersion);
  const controllerRef = useRef<LiveSessionController | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<'disconnected' | 'connected' | 'speaking' | 'error'>('disconnected');
  const [micActive, setMicActive] = useState(false);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  versionRef.current = props.stateVersion;

  if (!controllerRef.current) {
    controllerRef.current = createLiveSession({
      getStateVersion: () => versionRef.current,
      onTranscript: (text, speaker) => {
        setLines((current) => [...current.slice(-7), { speaker, text }]);
        if (speaker === 'user' && text.includes('开始')) props.onConfirmScript?.();
      },
      onSpeaking: (speaking) => setVoiceStatus(speaking ? 'speaking' : 'connected'),
      onInterrupted: () => setLines((current) => [...current, { speaker: 'agent', text: '↳ 已中断，播放内容已清除' }]),
      onProjectCreated: () => props.onProjectChanged(),
      onIntentPatch: () => props.onProjectChanged(),
    });
  }

  useEffect(() => () => controllerRef.current?.disconnect(), []);

  const connect = async () => {
    setError(null);
    try {
      await controllerRef.current?.connect();
      setVoiceStatus('connected');
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

function voiceStatusLabel(status: 'disconnected' | 'connected' | 'speaking' | 'error') {
  return {
    disconnected: '未连接',
    connected: '已连接',
    speaking: '代理说话中',
    error: '连接错误',
  }[status];
}
