import { useId } from "react";

interface EnabledSettingProps {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}

/** Edits the local form; the containing editor owns revision-checked persistence. */
export function EnabledSetting({
  label,
  description,
  checked,
  disabled,
  onChange,
}: EnabledSettingProps) {
  const id = useId();
  return (
    <div className="enabled-setting">
      <div className="enabled-setting-copy">
        <strong id={`${id}-label`}>{label}</strong>
        <p id={`${id}-help`}>{description}</p>
      </div>
      <label className="enabled-setting-control">
        <input
          type="checkbox"
          role="switch"
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-help`}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{checked ? "사용 중" : "사용 안 함"}</span>
      </label>
    </div>
  );
}
