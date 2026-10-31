import { useRef, useState, type ChangeEvent, type ComponentType, type FormEvent } from 'react';
import { GRADE_ZONES, HSL_CHANNELS, RANGES, type GradeZone, type HslChannel } from '../engine/params';
import { presetFromJson, presetToJson, type Preset } from '../presets/presets';
import { downloadBlob } from '../state/editor';
import { actions, getState, useStore } from '../state/store';
import { CurveEditor } from './CurveEditor';
import {
  ColorIcon,
  CurveIcon,
  DownloadIcon,
  EffectsIcon,
  GradingIcon,
  LightIcon,
  MixerIcon,
  PresenceIcon,
  PresetsIcon,
  TrashIcon,
} from './Icons';
import { ParamSlider } from './Slider';

const TEMP_TRACK = 'linear-gradient(90deg,#3f7fd6,#d8d8d8,#e0a93a)';
const TINT_TRACK = 'linear-gradient(90deg,#46b84e,#d8d8d8,#c24fc2)';
const SAT_TRACK = 'linear-gradient(90deg,#808080,#e0556a)';
const VIBRANCE_TRACK = 'linear-gradient(90deg,#808080,#d9a23c)';
const RAINBOW =
  'linear-gradient(90deg,hsl(0 80% 55%),hsl(60 80% 55%),hsl(120 80% 55%),hsl(180 80% 55%),hsl(240 80% 55%),hsl(300 80% 55%),hsl(360 80% 55%))';

const exposureFormat = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2);
const plain = (v: number) => `${v}`;

function LightPanel() {
  const r = RANGES.light;
  return (
    <>
      <ParamSlider label="Exposure" range={r.exposure} step={0.01} format={exposureFormat} get={(p) => p.light.exposure} set={(p, v) => (p.light.exposure = v)} />
      <ParamSlider label="Contrast" range={r.contrast} get={(p) => p.light.contrast} set={(p, v) => (p.light.contrast = v)} />
      <ParamSlider label="Highlights" range={r.highlights} get={(p) => p.light.highlights} set={(p, v) => (p.light.highlights = v)} />
      <ParamSlider label="Shadows" range={r.shadows} get={(p) => p.light.shadows} set={(p, v) => (p.light.shadows = v)} />
      <ParamSlider label="Whites" range={r.whites} get={(p) => p.light.whites} set={(p, v) => (p.light.whites = v)} />
      <ParamSlider label="Blacks" range={r.blacks} get={(p) => p.light.blacks} set={(p, v) => (p.light.blacks = v)} />
    </>
  );
}

function ColorPanel() {
  const r = RANGES.color;
  return (
    <>
      <ParamSlider label="Temperature" range={r.temperature} gradient={TEMP_TRACK} get={(p) => p.color.temperature} set={(p, v) => (p.color.temperature = v)} />
      <ParamSlider label="Tint" range={r.tint} gradient={TINT_TRACK} get={(p) => p.color.tint} set={(p, v) => (p.color.tint = v)} />
      <ParamSlider label="Vibrance" range={r.vibrance} gradient={VIBRANCE_TRACK} get={(p) => p.color.vibrance} set={(p, v) => (p.color.vibrance = v)} />
      <ParamSlider label="Saturation" range={r.saturation} gradient={SAT_TRACK} get={(p) => p.color.saturation} set={(p, v) => (p.color.saturation = v)} />
    </>
  );
}

function PresencePanel() {
  const r = RANGES.presence;
  return (
    <>
      <ParamSlider label="Texture" range={r.texture} get={(p) => p.presence.texture} set={(p, v) => (p.presence.texture = v)} />
      <ParamSlider label="Clarity" range={r.clarity} get={(p) => p.presence.clarity} set={(p, v) => (p.presence.clarity = v)} />
      <ParamSlider label="Dehaze" range={r.dehaze} get={(p) => p.presence.dehaze} set={(p, v) => (p.presence.dehaze = v)} />
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

function MixerPanel() {
  const [channel, setChannel] = useState<HslChannel>('red');
  const hue = MIXER_HUES[channel];
  const r = RANGES.hsl;
  const title = channel[0].toUpperCase() + channel.slice(1);
  return (
    <>
      <div className="swatches" role="tablist" aria-label="Colour channel">
        {HSL_CHANNELS.map((ch) => (
          <button
            key={ch}
            role="tab"
            aria-selected={ch === channel}
            aria-label={ch}
            title={ch}
            className={`swatch${ch === channel ? ' active' : ''}`}
            style={{ background: `hsl(${MIXER_HUES[ch]} 80% 52%)` }}
            onClick={() => setChannel(ch)}
          />
        ))}
      </div>
      <div className="sub-title">{title}</div>
      <ParamSlider
        key={`${channel}-hue`}
        label="Hue"
        range={r.hue}
        gradient={`linear-gradient(90deg,hsl(${hue - 30} 75% 52%),hsl(${hue} 75% 52%),hsl(${hue + 30} 75% 52%))`}
        get={(p) => p.hsl[channel].hue}
        set={(p, v) => (p.hsl[channel].hue = v)}
      />
      <ParamSlider
        key={`${channel}-sat`}
        label="Saturation"
        range={r.sat}
        gradient={`linear-gradient(90deg,hsl(${hue} 0% 50%),hsl(${hue} 90% 50%))`}
        get={(p) => p.hsl[channel].sat}
        set={(p, v) => (p.hsl[channel].sat = v)}
      />
      <ParamSlider
        key={`${channel}-lum`}
        label="Luminance"
        range={r.lum}
        gradient={`linear-gradient(90deg,hsl(${hue} 70% 18%),hsl(${hue} 70% 50%),hsl(${hue} 70% 82%))`}
        get={(p) => p.hsl[channel].lum}
        set={(p, v) => (p.hsl[channel].lum = v)}
      />
    </>
  );
}

const ZONE_LABEL: Record<GradeZone, string> = {
  shadows: 'Shadows',
  midtones: 'Midtones',
  highlights: 'Highlights',
};

function GradingPanel() {
  const [zone, setZone] = useState<GradeZone>('shadows');
  const hue = useStore((s) => s.params.grading[zone].hue);
  const r = RANGES.grade;
  return (
    <>
      <div className="segmented" role="tablist" aria-label="Tonal zone">
        {GRADE_ZONES.map((z) => (
          <button key={z} role="tab" aria-selected={z === zone} className={z === zone ? 'active' : ''} onClick={() => setZone(z)}>
            {ZONE_LABEL[z]}
          </button>
        ))}
      </div>
      <ParamSlider
        key={`${zone}-hue`}
        label="Hue"
        range={r.hue}
        gradient={RAINBOW}
        format={(v) => `${v}°`}
        get={(p) => p.grading[zone].hue}
        set={(p, v) => (p.grading[zone].hue = v)}
      />
      <ParamSlider
        key={`${zone}-sat`}
        label="Saturation"
        range={r.sat}
        gradient={`linear-gradient(90deg,hsl(${hue} 0% 50%),hsl(${hue} 90% 50%))`}
        format={plain}
        get={(p) => p.grading[zone].sat}
        set={(p, v) => (p.grading[zone].sat = v)}
      />
      <ParamSlider
        key={`${zone}-lum`}
        label="Luminance"
        range={r.lum}
        get={(p) => p.grading[zone].lum}
        set={(p, v) => (p.grading[zone].lum = v)}
      />
      <div className="divider" />
      <ParamSlider label="Blending" range={RANGES.grading.blending} format={plain} get={(p) => p.grading.blending} set={(p, v) => (p.grading.blending = v)} />
      <ParamSlider label="Balance" range={RANGES.grading.balance} get={(p) => p.grading.balance} set={(p, v) => (p.grading.balance = v)} />
    </>
  );
}

function EffectsPanel() {
  const r = RANGES.effects;
  return (
    <>
      <ParamSlider label="Vignette Amount" range={r.vignetteAmount} get={(p) => p.effects.vignetteAmount} set={(p, v) => (p.effects.vignetteAmount = v)} />
      <ParamSlider label="Midpoint" range={r.vignetteMidpoint} format={plain} get={(p) => p.effects.vignetteMidpoint} set={(p, v) => (p.effects.vignetteMidpoint = v)} />
      <ParamSlider label="Feather" range={r.vignetteFeather} format={plain} get={(p) => p.effects.vignetteFeather} set={(p, v) => (p.effects.vignetteFeather = v)} />
      <div className="divider" />
      <ParamSlider label="Sharpening" range={r.sharpening} format={plain} get={(p) => p.effects.sharpening} set={(p, v) => (p.effects.sharpening = v)} />
      <ParamSlider label="Grain" range={r.grain} format={plain} get={(p) => p.effects.grain} set={(p, v) => (p.effects.grain = v)} />
    </>
  );
}

function exportPresetFile(preset: Pick<Preset, 'name' | 'params'>): void {
  const safe = preset.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'preset';
  downloadBlob(new Blob([presetToJson(preset)], { type: 'application/json' }), `${safe}.json`);
}

function PresetsPanel() {
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

  return (
    <>
      <ul className="preset-list">
        {presets.map((preset) => (
          <li key={preset.id} className={preset.id === activeId ? 'active' : ''}>
            <button
              className="preset-apply"
              aria-pressed={preset.id === activeId}
              onClick={() => actions.applyPreset(preset.id)}
            >
              {preset.name}
              {preset.builtIn && <span className="badge">Built-in</span>}
            </button>
            <button
              className="icon-button"
              aria-label={`Export ${preset.name} as JSON`}
              title="Export JSON"
              onClick={() => exportPresetFile(preset)}
            >
              <DownloadIcon />
            </button>
            {!preset.builtIn && (
              <button
                className="icon-button"
                aria-label={`Delete ${preset.name}`}
                title="Delete"
                onClick={() => actions.deletePreset(preset.id)}
              >
                <TrashIcon />
              </button>
            )}
          </li>
        ))}
      </ul>
      <form className="preset-save" onSubmit={onSave}>
        <input
          aria-label="New preset name"
          placeholder="Name for current settings"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="button" type="submit" disabled={!name.trim()}>
          Save
        </button>
      </form>
      <div className="preset-actions">
        <button className="button" onClick={() => fileRef.current?.click()}>
          Import JSON
        </button>
        <button
          className="button"
          onClick={() => exportPresetFile({ name: 'pixelroom-settings', params: getState().params })}
        >
          Export current
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        multiple
        hidden
        onChange={onImport}
      />
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

export const SECTIONS: Section[] = [
  { id: 'presets', title: 'Presets', shortTitle: 'Presets', Icon: PresetsIcon, Panel: PresetsPanel, defaultOpen: true },
  { id: 'light', title: 'Light', shortTitle: 'Light', Icon: LightIcon, Panel: LightPanel, defaultOpen: true },
  { id: 'color', title: 'Color', shortTitle: 'Color', Icon: ColorIcon, Panel: ColorPanel, defaultOpen: true },
  { id: 'presence', title: 'Presence', shortTitle: 'Presence', Icon: PresenceIcon, Panel: PresencePanel },
  { id: 'curve', title: 'Tone Curve', shortTitle: 'Curve', Icon: CurveIcon, Panel: CurveEditor },
  { id: 'mixer', title: 'HSL / Color Mixer', shortTitle: 'Mixer', Icon: MixerIcon, Panel: MixerPanel },
  { id: 'grading', title: 'Color Grading', shortTitle: 'Grading', Icon: GradingIcon, Panel: GradingPanel },
  { id: 'effects', title: 'Effects', shortTitle: 'Effects', Icon: EffectsIcon, Panel: EffectsPanel },
];
