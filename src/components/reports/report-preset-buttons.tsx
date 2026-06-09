import { Button } from "../ui/button";
import { Select } from "../ui/select";

export type ReportPreset = {
  id: string;
  label: string;
};

export const ReportPresetButtons = ({
  presets,
  morePresets,
  onPresetSelect,
}: {
  presets: ReportPreset[];
  morePresets: ReportPreset[];
  onPresetSelect: (presetId: string) => void;
}) => (
  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-white p-3 panel-shadow">
    {presets.map((preset) => (
      <Button key={preset.id} onClick={() => onPresetSelect(preset.id)} size="sm" type="button" variant="outline">
        {preset.label}
      </Button>
    ))}
    <div className="min-w-40">
      <Select defaultValue="" onChange={(event) => event.target.value && onPresetSelect(event.target.value)}>
        <option value="">More</option>
        {morePresets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
      </Select>
    </div>
  </div>
);
