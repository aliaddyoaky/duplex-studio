import { useRef, useState } from 'react';

import type { Asset } from '../../shared/schemas.js';
import { mediaUrl, updateAssetTags, uploadAsset } from '../api.js';

export function AssetLibrary(props: { assets: Asset[]; onChanged(): void; onSelect?(asset: Asset): void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setError(null);
    try {
      for (const file of Array.from(files)) await uploadAsset(file);
      props.onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { setBusy(false); }
  };

  return (
    <section className="panel asset-panel">
      <div className="panel-heading"><div><span className="eyebrow">素材准备</span><h2>素材库</h2></div><button className="icon-action" title="上传素材" onClick={() => inputRef.current?.click()}>＋</button></div>
      <input ref={inputRef} className="visually-hidden" type="file" accept="video/*,image/*,audio/*" multiple onChange={(event) => void chooseFiles(event.target.files)} />
      <div className="asset-upload" onClick={() => inputRef.current?.click()}><span>＋</span><div><b>{busy ? '正在上传…' : '上传视频、图片或音频'}</b><small>支持单文件最大 500 MB</small></div></div>
      {error && <div className="inline-error">{error}</div>}
      <div className="asset-list">
        {props.assets.length === 0 ? <p className="empty-copy">先放入素材，脚本审阅时会自动匹配。</p> : props.assets.map((asset) => <AssetRow asset={asset} key={asset.id} onChanged={props.onChanged} onSelect={props.onSelect} />)}
      </div>
    </section>
  );
}

function AssetRow(props: { asset: Asset; onChanged(): void; onSelect?(asset: Asset): void }) {
  const [tags, setTags] = useState(props.asset.tags.join('、'));
  const [saving, setSaving] = useState(false);
  const saveTags = async () => {
    setSaving(true);
    try { await updateAssetTags(props.asset.id, tags.split(/[、,\s]+/).filter(Boolean)); props.onChanged(); } finally { setSaving(false); }
  };
  return (
    <article className="asset-row" onClick={() => props.onSelect?.(props.asset)}>
      <div className={`asset-thumb ${props.asset.type}`}>
        {props.asset.type === 'audio' ? <span>♪</span> : props.asset.type === 'video' ? <video src={mediaUrl(props.asset.uri)} muted playsInline preload="metadata" /> : <img src={mediaUrl(props.asset.uri)} alt="" />}
      </div>
      <div className="asset-info"><b>{props.asset.filename ?? props.asset.id}</b><small>{props.asset.type} · {props.asset.sizeBytes ? `${Math.ceil(props.asset.sizeBytes / 1024)} KB` : 'demo'}</small><input value={tags} placeholder="添加标签" onChange={(event) => setTags(event.target.value)} onClick={(event) => event.stopPropagation()} onBlur={() => void saveTags()} disabled={saving} /></div>
    </article>
  );
}
