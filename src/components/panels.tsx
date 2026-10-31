import { useRef, useState, type ChangeEvent, type ComponentType, type FormEvent, type PointerEvent } from 'react';
import { constrainCrop, cropToAspect, defaultGeometry, flipGeometry, outputSize, rotateGeometry } from '../engine/geometry';
import { GRADE_ZONES, HSL_CHANNELS, RANGES, type GradeZone, type HslChannel } from '../engine/params';
import { presetFromJson, presetToJson, type Preset } from '../presets/presets';
import { autoSettings, autoWb, downloadBlob } from '../state/editor';
import { actions, activePhoto, getState, useStore } from '../state/store';
import { CurveEditor } from './CurveEditor';
import {
  ColorIcon,
  CropIcon,
  CurveIcon,
  DownloadIcon,
  EffectsIcon,
  EyedropperIcon,
  FlipIcon,
  GradingIcon,
  LightIcon,
  MixerIcon,
  PresenceIcon,
  PresetsIcon,
  RotateLeftIcon,
  RotateRightIcon,
  TrashIcon,
} from './Icons';
import { ParamSlider } from './Slider';

const TEMP_TRACK = 'linear-gradient(90deg,#4a7fc4,#c9c9c9,#d8a63f)';
const TINT_TRACK = 'linear-gradient(90deg,#4eab55,#c9c9c9,#b953b9)';
const SAT_TRACK = 'linear-gradient(90deg,#7c7c7c,#d9586c)';
const VIBRANCE_TRACK = 'linear-gradient(90deg,#7c7c7c,#cf9b3c)';

const exposureFormat = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2);
const plain = (v: number) => `${v}`;
const oneDecimal = (v: number) => v.toFixed(1);

/** The Basic panel: treatment, white balance, tone and presence in one place. */
function BasicPanel() {
  const mono = useStore((s) => s.params.mono);
  const temperature = useStore((s) => s.params.color.temperature);
  const tint = useStore((s) => s.params.color.tint);
  const tool = useStore((s) => s.tool);
  const light = RANGES.light;
  const color = RANGES.color;
  const presence = RANGES.presence;
  const asShot = temperature === 0 && tint === 0;

  return (
    <>
      <div className="row-field">
        <span className="field-label">Treatment</span>
        <div className="text-toggle" role="radiogroup" aria-label="Treatment">
          <button role="radio" aria-checked={!mono} className={!mono ? 'on' : ''} onClick={() => actions.change('Treatment: Color', (p) => void (p.mono = false))}>
            Color
          </button>
          <button role="radio" aria-checked={mono} className={mono ? 'on' : ''} onClick={() => actions.change('Treatment: Black & White', (p) => void (p.mono = true))}>
            Black &amp; White
          </button>
        </div>
      </div>

      <div className="row-field wb-row">
        <button
          className={`tool-button${tool === 'whiteBalance' ? ' on' : ''}`}
          aria-label="White balance picker"
          title="Click a spot that should be neutral (W)"
          aria-pressed={tool === 'whiteBalance'}
          onClick={() => actions.setTool(tool === 'whiteBalance' ? 'none' : 'whiteBalance')}
        >
          <EyedropperIcon />
        </button>
        <span className="field-label">WB:</span>
        <select
          aria-label="White balance"
          value={asShot ? 'shot' : 'custom'}
          onChange={(e) => {
            if (e.target.value === 'shot') {
              actions.change('White Balance: As Shot', (p) => {
                p.color.temperature = 0;
                p.color.tint = 0;
              });
            } else if (e.target.value === 'auto') {
              autoWb();
            }
          }}
        >
          <option value="shot">As Shot</option>
          <option value="auto">Auto</option>
          {!asShot && <option value="custom">Custom</option>}
        </select>
      </div>
      <ParamSlider label="Temp" range={color.temperature} gradient={TEMP_TRACK} get={(p) => p.color.temperature} set={(p, v) => (p.color.temperature = v)} />
      <ParamSlider label="Tint" range={color.tint} gradient={TINT_TRACK} get={(p) => p.color.tint} set={(p, v) => (p.color.tint = v)} />

      <div className="group-title">
        <span>Tone</span>
        <button className="link-button" onClick={autoSettings}>
          Auto
        </button>
      </div>
      <ParamSlider label="Exposure" range={light.exposure} step={0.01} format={exposureFormat} get={(p) => p.light.exposure} set={(p, v) => (p.light.exposure = v)} />
      <ParamSlider label="Contrast" range={light.contrast} get={(p) => p.light.contrast} set={(p, v) => (p.light.contrast = v)} />
      <ParamSlider label="Highlights" range={light.highlights} get={(p) => p.light.highlights} set={(p, v) => (p.light.highlights = v)} />
      <ParamSlider label="Shadows" range={light.shadows} get={(p) => p.light.shadows} set={(p, v) => (p.light.shadows = v)} />
      <ParamSlider label="Whites" range={light.whites} get={(p) => p.light.whites} set={(p, v) => (p.light.whites = v)} />
      <ParamSlider label="Blacks" range={light.blacks} get={(p) => p.light.blacks} set={(p, v) => (p.light.blacks = v)} />

      <div className="group-title">
        <span>Presence</span>
      </div>
      <ParamSlider label="Texture" range={presence.texture} get={(p) => p.presence.texture} set={(p, v) => (p.presence.texture = v)} />
      <ParamSlider label="Clarity" range={presence.clarity} get={(p) => p.presence.clarity} set={(p, v) => (p.presence.clarity = v)} />
      <ParamSlider label="Dehaze" range={presence.dehaze} get={(p) => p.presence.dehaze} set={(p, v) => (p.presence.dehaze = v)} />
      <ParamSlider label="Vibrance" range={color.vibrance} gradient={VIBRANCE_TRACK} get={(p) => p.color.vibrance} set={(p, v) => (p.color.vibrance = v)} />
      <ParamSlider label="Saturation" range={color.saturation} gradient={SAT_TRACK} get={(p) => p.color.saturation} set={(p, v) => (p.color.saturation = v)} />
    </>
  );
}

const MIXER_HUES: Record<HslChannel, number> = {
  red: 0,
  orange: 30,
  yellow: 60,
  green: 120,
  aqua: 180,
  blue: 240,
  purple: 270,
  magenta: 300,
};

type MixerTab = 'hue' | 'sat' | 'lum' | 'all';
const MIXER_TABS: { id: MixerTab; label: string }[] = [
  { id: 'hue', label: 'Hue' },
  { id: 'sat', label: 'Saturation' },
  { id: 'lum', label: 'Luminance' },
  { id: 'all', label: 'All' },
];

function title(word: string): string {
  return word[0].toUpperCase() + word.slice(1);
}

function mixerGradient(kind: 'hue' | 'sat' | 'lum', hue: number): string {
  if (kind === 'hue') return `linear-gradient(90deg,hsl(${hue - 30} 70% 50%),hsl(${hue} 70% 50%),hsl(${hue + 30} 70% 50%))`;
  if (kind === 'sat') return `linear-gradient(90deg,hsl(${hue} 0% 48%),hsl(${hue} 85% 50%))`;
  return `linear-gradient(90deg,hsl(${hue} 70% 18%),hsl(${hue} 70% 50%),hsl(${hue} 70% 82%))`;
}

function MixerGroup({ kind, heading }: { kind: 'hue' | 'sat' | 'lum'; heading?: string }) {
  const r = RANGES.hsl;
  return (
    <>
      {heading && <div className="group-title"><span>{heading}</span></div>}
      {HSL_CHANNELS.map((ch) => (
        <ParamSlider
          key={`${kind}-${ch}`}
          label={title(ch)}
          historyLabel={`${title(ch)} ${heading ?? MIXER_TABS.find((t) => t.id === kind)?.label}`}
          range={r[kind]}
          gradient={mixerGradient(kind, MIXER_HUES[ch])}
          get={(p) => p.hsl[ch][kind]}
          set={(p, v) => (p.hsl[ch][kind] = v)}
        />
      ))}
    </>
  );
}

function MixerPanel() {
  const [tab, setTab] = useState<MixerTab>('hue');
  return (
    <>
      <div className="tabs-row" role="tablist" aria-label="Color adjustment">
        {MIXER_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === tab} className={t.id === tab ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'all' ? (
        <>
          <MixerGroup kind="hue" heading="Hue" />
          <MixerGroup kind="sat" heading="Saturation" />
          <MixerGroup kind="lum" heading="Luminance" />
        </>
      ) : (
        <MixerGroup kind={tab} />
      )}
    </>
  );
}

const ZONE_LABEL: Record<GradeZone, string> = {
  shadows: 'Shadows',
  midtones: 'Midtones',
  highlights: 'Highlights',
};

/** Hue by angle, saturation by distance from the centre. */
function ColorWheel({ zone }: { zone: GradeZone }) {
  const hue = useStore((s) => s.params.grading[zone].hue);
  const sat = useStore((s) => s.params.grading[zone].sat);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const set = (e: PointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = e.clientX - rect.left - rect.width / 2;
    const dy = e.clientY - rect.top - rect.height / 2;
    const radius = rect.width / 2;
    const nextHue = Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360);
    const nextSat = Math.round(Math.min(1, Math.hypot(dx, dy) / radius) * 100);
    actions.update((p) => {
      p.grading[zone].hue = nextHue;
      p.grading[zone].sat = nextSat;
    });
  };

  const rad = (hue * Math.PI) / 180;
  return (
    <div
      ref={ref}
      className="color-wheel"
      role="slider"
      tabIndex={0}
      aria-label={`${ZONE_LABEL[zone]} color`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={sat}
      aria-valuetext={`Hue ${hue} degrees, saturation ${sat}`}
      title="Drag to choose. Double-click to clear."
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        set(e);
      }}
      onPointerMove={(e) => dragging.current && set(e)}
      onPointerUp={() => {
        dragging.current = false;
        actions.commit(`Color Grading: ${ZONE_LABEL[zone]}`);
      }}
      onPointerCancel={() => {
        dragging.current = false;
        actions.commit(`Color Grading: ${ZONE_LABEL[zone]}`);
      }}
      onDoubleClick={() =>
        actions.change(`Color Grading: Clear ${ZONE_LABEL[zone]}`, (p) => {
          p.grading[zone].hue = 0;
          p.grading[zone].sat = 0;
        })
      }
    >
      <span
        className="wheel-dot"
        style={{
          left: `${50 + (Math.sin(rad) * sat) / 2}%`,
          top: `${50 - (Math.cos(rad) * sat) / 2}%`,
        }}
      />
    </div>
  );
}

function GradingPanel() {
  const r = RANGES.grade;
  return (
    <>
      <div className="wheels">
        {[...GRADE_ZONES].map((zone) => (
          <div key={zone} className={`wheel-cell ${zone}`}>
            <span className="wheel-label">{ZONE_LABEL[zone]}</span>
            <ColorWheel zone={zone} />
            <ParamSlider
              compact
              label="Lum"
              historyLabel={`${ZONE_LABEL[zone]} Luminance`}
              range={r.lum}
              get={(p) => p.grading[zone].lum}
              set={(p, v) => (p.grading[zone].lum = v)}
            />
          </div>
        ))}
      </div>
      <ParamSlider label="Blending" range={RANGES.grading.blending} format={plain} get={(p) => p.grading.blending} set={(p, v) => (p.grading.blending = v)} />
      <ParamSlider label="Balance" range={RANGES.grading.balance} get={(p) => p.grading.balance} set={(p, v) => (p.grading.balance = v)} />
    </>
  );
}

function DetailPanel() {
  const zoom = useStore((s) => s.view.zoom);
  const d = RANGES.detail;
  return (
    <>
      {zoom !== 1 && (
        <button className="note-button" onClick={() => actions.setView({ ...getState().view, zoom: 1 })}>
          Zoom to 1:1 to judge sharpening and noise
        </button>
      )}
      <div className="group-title"><span>Sharpening</span></div>
      <ParamSlider label="Amount" historyLabel="Sharpening" range={RANGES.effects.sharpening} format={plain} get={(p) => p.effects.sharpening} set={(p, v) => (p.effects.sharpening = v)} />
      <ParamSlider label="Radius" historyLabel="Sharpen Radius" range={d.sharpenRadius} step={0.1} format={oneDecimal} get={(p) => p.detail.sharpenRadius} set={(p, v) => (p.detail.sharpenRadius = v)} />
      <ParamSlider label="Detail" historyLabel="Sharpen Detail" range={d.sharpenDetail} format={plain} get={(p) => p.detail.sharpenDetail} set={(p, v) => (p.detail.sharpenDetail = v)} />
      <ParamSlider label="Masking" historyLabel="Sharpen Masking" range={d.sharpenMasking} format={plain} get={(p) => p.detail.sharpenMasking} set={(p, v) => (p.detail.sharpenMasking = v)} />
      <div className="group-title"><span>Noise Reduction</span></div>
      <ParamSlider label="Luminance" historyLabel="Luminance Noise" range={d.noiseLuma} format={plain} get={(p) => p.detail.noiseLuma} set={(p, v) => (p.detail.noiseLuma = v)} />
      <ParamSlider label="Color" historyLabel="Color Noise" range={d.noiseColor} format={plain} get={(p) => p.detail.noiseColor} set={(p, v) => (p.detail.noiseColor = v)} />
    </>
  );
}

function EffectsPanel() {
  const r = RANGES.effects;
  return (
    <>
      <div className="group-title"><span>Post-Crop Vignetting</span></div>
      <ParamSlider label="Amount" historyLabel="Vignette Amount" range={r.vignetteAmount} get={(p) => p.effects.vignetteAmount} set={(p, v) => (p.effects.vignetteAmount = v)} />
      <ParamSlider label="Midpoint" historyLabel="Vignette Midpoint" range={r.vignetteMidpoint} format={plain} get={(p) => p.effects.vignetteMidpoint} set={(p, v) => (p.effects.vignetteMidpoint = v)} />
      <ParamSlider label="Feather" historyLabel="Vignette Feather" range={r.vignetteFeather} format={plain} get={(p) => p.effects.vignetteFeather} set={(p, v) => (p.effects.vignetteFeather = v)} />
      <div className="group-title"><span>Grain</span></div>
      <ParamSlider label="Amount" historyLabel="Grain Amount" range={r.grain} format={plain} get={(p) => p.effects.grain} set={(p, v) => (p.effects.grain = v)} />
      <ParamSlider label="Size" historyLabel="Grain Size" range={r.grainSize} format={plain} get={(p) => p.effects.grainSize} set={(p, v) => (p.effects.grainSize = v)} />
      <ParamSlider label="Roughness" historyLabel="Grain Roughness" range={r.grainRoughness} format={plain} get={(p) => p.effects.grainRoughness} set={(p, v) => (p.effects.grainRoughness = v)} />
    </>
  );
}

const ASPECTS: { label: string; value: string }[] = [
  { label: 'Custom', value: '0' },
  { label: 'Original', value: 'original' },
  { label: '1 x 1', value: '1' },
  { label: '4 x 5', value: '0.8' },
  { label: '5 x 4', value: '1.25' },
  { label: '2 x 3', value: '0.6666667' },
  { label: '3 x 2', value: '1.5' },
  { label: '16 x 9', value: '1.7777778' },
  { label: '9 x 16', value: '0.5625' },
];

/** Opens under the tool strip while the crop tool is active. */
export function CropPanel() {
  const photo = useStore(activePhoto);
  const geometry = useStore((s) => s.params.geometry);
  const aspect = useStore((s) => s.cropAspect);
  const [aspectValue, setAspectValue] = useState('0');
  if (!photo) return null;
  const { width: W, height: H } = photo;
  const size = outputSize(geometry, W, H);

  const chooseAspect = (value: string) => {
    setAspectValue(value);
    if (value === '0') {
      actions.setCropAspect(null);
      return;
    }
    const ratio = value === 'original' ? Math.max(W, H) / Math.min(W, H) * (size.width >= size.height ? 1 : -1) : Number(value);
    const target = ratio < 0 ? -1 / ratio : ratio;
    actions.setCropAspect(target);
    actions.change('Crop Aspect', (p) => {
      p.geometry = constrainCrop(cropToAspect(p.geometry, W, H, target), W, H);
    });
  };

  return (
    <div className="crop-panel">
      <div className="row-field">
        <span className="field-label">Aspect:</span>
        <select aria-label="Crop aspect ratio" value={aspectValue} onChange={(e) => chooseAspect(e.target.value)}>
          {ASPECTS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <span className="field-value" title={aspect ? 'Aspect locked' : undefined}>
          {size.width} x {size.height}
        </span>
      </div>
      <ParamSlider
        label="Angle"
        historyLabel="Straighten"
        range={RANGES.angle}
        step={0.01}
        format={(v) => v.toFixed(2)}
        get={(p) => p.geometry.angle}
        set={(p, v) => {
          p.geometry.angle = v;
          p.geometry = constrainCrop(p.geometry, W, H);
        }}
      />
      <div className="row-field crop-actions">
        <button className="tool-button" aria-label="Rotate left" title="Rotate left" onClick={() => actions.change('Rotate Left', (p) => void (p.geometry = rotateGeometry(p.geometry, false)))}>
          <RotateLeftIcon />
        </button>
        <button className="tool-button" aria-label="Rotate right" title="Rotate right" onClick={() => actions.change('Rotate Right', (p) => void (p.geometry = rotateGeometry(p.geometry, true)))}>
          <RotateRightIcon />
        </button>
        <button className="tool-button" aria-label="Flip horizontal" title="Flip horizontal" onClick={() => actions.change('Flip Horizontal', (p) => void (p.geometry = flipGeometry(p.geometry)))}>
          <FlipIcon />
        </button>
        <span className="spacer" />
        <button
          className="flat-button"
          onClick={() => {
            setAspectValue('0');
            actions.setCropAspect(null);
            actions.change('Reset Crop', (p) => void (p.geometry = defaultGeometry()));
          }}
        >
          Reset
        </button>
        <button className="flat-button" onClick={() => actions.setTool('none')}>
          Close
        </button>
      </div>
    </div>
  );
}

function exportPresetFile(preset: Pick<Preset, 'name' | 'params'>): void {
  const safe = preset.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'preset';
  downloadBlob(new Blob([presetToJson(preset)], { type: 'application/json' }), `${safe}.json`);
}

export function PresetsPanel() {
  const presets = useStore((s) => s.presets);
  const activeId = useStore((s) => s.activePresetId);
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    actions.saveCurrentAsPreset(trimmed);
    actions.notify(`Saved preset "${trimmed}".`);
    setName('');
  };

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    for (const file of files) {
      try {
        const { name: presetName, params } = presetFromJson(await file.text());
        const preset = actions.addPreset(presetName, params);
        actions.applyPreset(preset.id);
        actions.notify(`Imported and applied "${presetName}".`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown error.';
        actions.notify(`Could not import ${file.name}. ${reason}`, true);
      }
    }
  };

  const groups: [string, Preset[]][] = [
    ['Built-in Presets', presets.filter((p) => p.builtIn)],
    ['User Presets', presets.filter((p) => !p.builtIn)],
  ];

  return (
    <>
      {groups.map(([heading, list]) =>
        list.length ? (
          <div key={heading}>
            <div className="list-heading">{heading}</div>
            <ul className="plain-list">
              {list.map((preset) => (
                <li key={preset.id} className={preset.id === activeId ? 'on' : ''}>
                  <button className="list-main" aria-pressed={preset.id === activeId} onClick={() => actions.applyPreset(preset.id)}>
                    {preset.name}
                  </button>
                  <button className="list-action" aria-label={`Export ${preset.name} as JSON`} title="Export JSON" onClick={() => exportPresetFile(preset)}>
                    <DownloadIcon />
                  </button>
                  {!preset.builtIn && (
                    <button className="list-action" aria-label={`Delete ${preset.name}`} title="Delete" onClick={() => actions.deletePreset(preset.id)}>
                      <TrashIcon />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      <form className="inline-form" onSubmit={onSave}>
        <input aria-label="New preset name" placeholder="New preset name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="flat-button" type="submit" disabled={!name.trim()}>
          Save
        </button>
      </form>
      <div className="inline-form">
        <button className="flat-button grow" onClick={() => fileRef.current?.click()}>
          Import JSON
        </button>
        <button className="flat-button grow" onClick={() => exportPresetFile({ name: 'pixelroom-settings', params: getState().params })}>
          Export current
        </button>
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json" multiple hidden onChange={onImport} />
    </>
  );
}

export function SnapshotsPanel() {
  const photo = useStore(activePhoto);
  const [name, setName] = useState('');
  const snapshots = photo?.snapshots ?? [];
  return (
    <>
      <ul className="plain-list">
        {snapshots.map((s) => (
          <li key={s.id}>
            <button className="list-main" onClick={() => actions.applySnapshot(s.id)}>
              {s.name}
            </button>
            <button className="list-action" aria-label={`Delete ${s.name}`} title="Delete" onClick={() => actions.deleteSnapshot(s.id)}>
              <TrashIcon />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (!trimmed || !photo) return;
          actions.addSnapshot(trimmed);
          setName('');
        }}
      >
        <input aria-label="New snapshot name" placeholder="New snapshot name" maxLength={60} value={name} disabled={!photo} onChange={(e) => setName(e.target.value)} />
        <button className="flat-button" type="submit" disabled={!name.trim() || !photo}>
          Add
        </button>
      </form>
    </>
  );
}

export function HistoryPanel() {
  const history = useStore((s) => s.history);
  const index = useStore((s) => s.historyIndex);
  return (
    <>
      <ol className="plain-list history-list">
        {history
          .map((entry, i) => ({ entry, i }))
          .reverse()
          .map(({ entry, i }) => (
            <li key={i} className={i === index ? 'on' : i > index ? 'future' : ''}>
              <button className="list-main" onClick={() => actions.goToHistory(i)}>
                {entry.label}
              </button>
            </li>
          ))}
      </ol>
      {history.length > 1 && (
        <div className="inline-form">
          <button className="flat-button grow" onClick={actions.clearHistory}>
            Clear All
          </button>
        </div>
      )}
    </>
  );
}

export interface Section {
  id: string;
  title: string;
  shortTitle: string;
  Icon: ComponentType;
  Panel: ComponentType;
  defaultOpen?: boolean;
}

/** Panels down the right side, top to bottom. */
export const RIGHT_SECTIONS: Section[] = [
  { id: 'basic', title: 'Basic', shortTitle: 'Basic', Icon: LightIcon, Panel: BasicPanel, defaultOpen: true },
  { id: 'curve', title: 'Tone Curve', shortTitle: 'Curve', Icon: CurveIcon, Panel: CurveEditor },
  { id: 'mixer', title: 'HSL / Color', shortTitle: 'Color', Icon: MixerIcon, Panel: MixerPanel },
  { id: 'grading', title: 'Color Grading', shortTitle: 'Grading', Icon: GradingIcon, Panel: GradingPanel },
  { id: 'detail', title: 'Detail', shortTitle: 'Detail', Icon: PresenceIcon, Panel: DetailPanel },
  { id: 'effects', title: 'Effects', shortTitle: 'Effects', Icon: EffectsIcon, Panel: EffectsPanel },
];

/** Panels down the left side, under the Navigator. */
export const LEFT_SECTIONS: Section[] = [
  { id: 'presets', title: 'Presets', shortTitle: 'Presets', Icon: PresetsIcon, Panel: PresetsPanel, defaultOpen: true },
  { id: 'snapshots', title: 'Snapshots', shortTitle: 'Snaps', Icon: ColorIcon, Panel: SnapshotsPanel },
  { id: 'history', title: 'History', shortTitle: 'History', Icon: CropIcon, Panel: HistoryPanel, defaultOpen: true },
];

/** Phones have one tab bar, so presets come first and all tools follow. */
export const COMPACT_SECTIONS: Section[] = [LEFT_SECTIONS[0], ...RIGHT_SECTIONS, LEFT_SECTIONS[2]];
