import { useEffect, useState } from 'react';
import { RANGES, defaultParams, type EditParams, type Range } from '../engine/params';
import { NEUTRAL_ID } from '../presets/presets';
import { promptInstall, useInstallMode } from '../pwa';
import { autoSettings, downloadBlob, exportPhoto, presetThumbnail } from '../state/editor';
import { actions, activePhoto, useStore } from '../state/store';
import { CropIcon, GridIcon, LightIcon, MixerIcon, PresetsIcon } from './Icons';
import { COMPACT_SECTIONS, CropPanel } from './panels';
import { ParamSlider, Slider } from './Slider';
import { Filmstrip } from './Workspace';

const NEUTRAL = defaultParams();

/** One-tap looks, each previewed on the photo that is open. */
function LooksPanel() {
  const presets = useStore((s) => s.presets);
  const activeId = useStore((s) => s.activePresetId);
  const token = useStore((s) => s.imageToken);
  const strength = useStore((s) => s.presetStrength);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  // Original first, then the rest in their usual order.
  const ordered = [...presets].sort((a, b) => Number(b.id === NEUTRAL_ID) - Number(a.id === NEUTRAL_ID));

  useEffect(() => {
    setThumbs({});
    let index = 0;
    let frame = 0;
    // One per frame, so opening a photo never stalls on them.
    const next = () => {
      const preset = presets[index++];
      if (!preset) return;
      const url = presetThumbnail(preset.params);
      if (url) setThumbs((t) => ({ ...t, [preset.id]: url }));
      frame = requestAnimationFrame(next);
    };
    frame = requestAnimationFrame(next);
    return () => cancelAnimationFrame(frame);
  }, [token, presets]);

  const active = presets.find((p) => p.id === activeId);
  return (
    <>
      <div className="look-strip" role="group" aria-label="Looks">
        {ordered.map((preset) => (
          <button
            key={preset.id}
            className={`look${preset.id === activeId ? ' on' : ''}`}
            aria-pressed={preset.id === activeId}
            onClick={() => actions.applyPreset(preset.id)}
          >
            <span className="look-image">{thumbs[preset.id] && <img src={thumbs[preset.id]} alt="" draggable={false} />}</span>
            <span className="look-name">{preset.id === NEUTRAL_ID ? 'Original' : preset.name}</span>
          </button>
        ))}
      </div>
      {active && active.id !== NEUTRAL_ID && (
        <Slider
          label="Strength"
          value={strength}
          range={[0, 100]}
          resetValue={100}
          format={(v) => `${v}`}
          onChange={actions.setPresetStrength}
          onCommit={() => actions.commit(`${active.name} ${strength}%`)}
        />
      )}
    </>
  );
}

interface QuickParam {
  id: string;
  label: string;
  range: Range;
  step?: number;
  format?: (v: number) => string;
  get: (p: EditParams) => number;
  set: (p: EditParams, v: number) => void;
}

const plain = (v: number) => `${v}`;

const QUICK: QuickParam[] = [
  { id: 'exposure', label: 'Exposure', range: RANGES.light.exposure, step: 0.01, format: (v) => (v > 0 ? '+' : '') + v.toFixed(2), get: (p) => p.light.exposure, set: (p, v) => (p.light.exposure = v) },
  { id: 'contrast', label: 'Contrast', range: RANGES.light.contrast, get: (p) => p.light.contrast, set: (p, v) => (p.light.contrast = v) },
  { id: 'highlights', label: 'Highlights', range: RANGES.light.highlights, get: (p) => p.light.highlights, set: (p, v) => (p.light.highlights = v) },
  { id: 'shadows', label: 'Shadows', range: RANGES.light.shadows, get: (p) => p.light.shadows, set: (p, v) => (p.light.shadows = v) },
  { id: 'temp', label: 'Temp', range: RANGES.color.temperature, get: (p) => p.color.temperature, set: (p, v) => (p.color.temperature = v) },
  { id: 'tint', label: 'Tint', range: RANGES.color.tint, get: (p) => p.color.tint, set: (p, v) => (p.color.tint = v) },
  { id: 'vibrance', label: 'Vibrance', range: RANGES.color.vibrance, get: (p) => p.color.vibrance, set: (p, v) => (p.color.vibrance = v) },
  { id: 'saturation', label: 'Saturation', range: RANGES.color.saturation, get: (p) => p.color.saturation, set: (p, v) => (p.color.saturation = v) },
  { id: 'clarity', label: 'Clarity', range: RANGES.presence.clarity, get: (p) => p.presence.clarity, set: (p, v) => (p.presence.clarity = v) },
  { id: 'sharpen', label: 'Sharpen', range: RANGES.effects.sharpening, format: plain, get: (p) => p.effects.sharpening, set: (p, v) => (p.effects.sharpening = v) },
  { id: 'vignette', label: 'Vignette', range: RANGES.effects.vignetteAmount, get: (p) => p.effects.vignetteAmount, set: (p, v) => (p.effects.vignetteAmount = v) },
  { id: 'grain', label: 'Grain', range: RANGES.effects.grain, format: plain, get: (p) => p.effects.grain, set: (p, v) => (p.effects.grain = v) },
];

function QuickChip({ param, on, onPick }: { param: QuickParam; on: boolean; onPick: () => void }) {
  const changed = useStore((s) => param.get(s.params) !== param.get(NEUTRAL));
  return (
    <button className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={onPick}>
      {param.label}
      {changed && <i className="chip-dot" aria-label="changed" />}
    </button>
  );
}

/** One big slider at a time, chosen from a row of chips. */
function AdjustPanel() {
  const [id, setId] = useState(QUICK[0].id);
  const param = QUICK.find((q) => q.id === id) ?? QUICK[0];
  return (
    <>
      <div className="chip-row">
        <button className="chip accent" onClick={autoSettings}>
          Auto
        </button>
        {QUICK.map((q) => (
          <QuickChip key={q.id} param={q} on={q.id === id} onPick={() => setId(q.id)} />
        ))}
        <button className="chip" onClick={actions.reset}>
          Reset all
        </button>
      </div>
      <ParamSlider key={param.id} label={param.label} range={param.range} step={param.step} format={param.format} get={param.get} set={param.set} />
    </>
  );
}

/** Every panel from the desktop app, for when the quick tools are not enough. */
function MorePanel() {
  const [id, setId] = useState(COMPACT_SECTIONS[1].id);
  const section = COMPACT_SECTIONS.find((s) => s.id === id) ?? COMPACT_SECTIONS[0];
  return (
    <>
      <div className="chip-row sticky">
        {COMPACT_SECTIONS.map((s) => (
          <button key={s.id} className={`chip${s.id === id ? ' on' : ''}`} aria-pressed={s.id === id} onClick={() => setId(s.id)}>
            {s.shortTitle}
          </button>
        ))}
      </div>
      <section.Panel />
    </>
  );
}

type Tab = 'looks' | 'adjust' | 'crop' | 'photos' | 'more';

export function MobileTools() {
  const [tab, setTab] = useState<Tab>('looks');
  const tool = useStore((s) => s.tool);
  const photoCount = useStore((s) => s.catalog.length);

  const tabs: { id: Tab; label: string; Icon: () => JSX.Element }[] = [
    { id: 'looks', label: 'Looks', Icon: PresetsIcon },
    { id: 'adjust', label: 'Adjust', Icon: LightIcon },
    { id: 'crop', label: 'Crop', Icon: CropIcon },
    ...(photoCount > 1 ? [{ id: 'photos' as const, label: 'Photos', Icon: GridIcon }] : []),
    { id: 'more', label: 'More', Icon: MixerIcon },
  ];

  const choose = (next: Tab) => {
    setTab(next);
    actions.setTool(next === 'crop' ? 'crop' : 'none');
  };

  // The crop panel's Close button, or switching photo, ends the tool.
  useEffect(() => {
    if (tab === 'crop' && tool !== 'crop') setTab('looks');
  }, [tab, tool]);

  return (
    <div className="mobile-tools">
      <div className={`mobile-sheet${tab === 'more' ? ' tall' : ''}`}>
        {tab === 'looks' && <LooksPanel />}
        {tab === 'adjust' && <AdjustPanel />}
        {tab === 'crop' && tool === 'crop' && <CropPanel />}
        {tab === 'photos' && <Filmstrip />}
        {tab === 'more' && <MorePanel />}
      </div>
      <nav className="tool-tabs" aria-label="Tools">
        {tabs.map(({ id, label, Icon }) => (
          <button key={id} className={id === tab ? 'active' : ''} aria-pressed={id === tab} onClick={() => choose(id)}>
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

const SIZES = [
  { id: 'full', title: 'Full quality', detail: 'JPEG, full resolution', quality: 0.95, longEdge: undefined },
  { id: 'share', title: 'For sharing', detail: 'JPEG, 2048 px, smaller file', quality: 0.9, longEdge: 2048 },
] as const;

/** Two taps to a finished photo. Sharing needs a fresh tap, so it comes after rendering. */
export function QuickExport({ onClose, onMore }: { onClose: () => void; onMore: () => void }) {
  const photo = useStore(activePhoto);
  const [progress, setProgress] = useState<number | null>(null);
  const [ready, setReady] = useState<File | null>(null);
  const busy = progress !== null && !ready;

  if (!photo) return null;

  const run = async (size: (typeof SIZES)[number]) => {
    setProgress(0);
    try {
      const blob = await exportPhoto({
        type: 'image/jpeg',
        quality: size.quality,
        longEdge: size.longEdge,
        metadata: 'noLocation',
        onProgress: setProgress,
      });
      const name = `${photo.name.replace(/\.[^.]+$/, '')}-edit.jpg`;
      const file = new File([blob], name, { type: 'image/jpeg' });
      if (navigator.canShare?.({ files: [file] })) {
        setReady(file);
      } else {
        downloadBlob(blob, name);
        actions.notify(`Saved ${name}.`);
        onClose();
      }
    } catch (error) {
      actions.notify(error instanceof Error ? error.message : 'Export failed.', true);
      setProgress(null);
    }
  };

  const share = async () => {
    if (!ready) return;
    try {
      await navigator.share({ files: [ready] });
      onClose();
    } catch (error) {
      // Closing the share sheet is not a failure; the file stays ready to try again.
      if (error instanceof Error && error.name !== 'AbortError') actions.notify(error.message, true);
    }
  };

  return (
    <div className="modal-backdrop bottom" onPointerDown={() => !busy && onClose()}>
      <div className="action-sheet" role="dialog" aria-modal="true" aria-label="Export" onPointerDown={(e) => e.stopPropagation()}>
        {ready ? (
          <>
            <p className="sheet-title">Your photo is ready ({(ready.size / 1048576).toFixed(1)} MB)</p>
            <button className="sheet-button primary" onClick={share}>
              Save or share
            </button>
            <button
              className="sheet-button"
              onClick={() => {
                downloadBlob(ready, ready.name);
                onClose();
              }}
            >
              Download file
            </button>
          </>
        ) : busy ? (
          <>
            <p className="sheet-title">{(progress ?? 0) >= 0.9 ? 'Encoding...' : `Rendering ${Math.round((progress ?? 0) * 100)}%`}</p>
            <div className="progress" role="progressbar" aria-valuenow={Math.round((progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${(progress ?? 0) * 100}%` }} />
            </div>
          </>
        ) : (
          <>
            {SIZES.map((size) => (
              <button key={size.id} className="sheet-button option" onClick={() => void run(size)}>
                <strong>{size.title}</strong>
                <span>{size.detail}</span>
              </button>
            ))}
            <button className="sheet-button" onClick={onMore}>
              More options
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function InstallHint() {
  const mode = useInstallMode();
  if (mode === 'installed') return null;
  if (mode === 'prompt') {
    return (
      <button className="button install" onClick={promptInstall}>
        Install app
      </button>
    );
  }
  return (
    <p className="install-hint">
      {mode === 'ios'
        ? 'To install: open in Safari, tap Share, then Add to Home Screen.'
        : 'To install: open your browser menu, then Add to Home screen.'}
    </p>
  );
}
