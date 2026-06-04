type ProgressProps = {
  value: number;
};

export const Progress = ({ value }: ProgressProps) => (
  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
    <div
      className="h-full rounded-full bg-primary transition-all"
      style={{ width: `${Math.max(0, Math.min(value, 100))}%` }}
    />
  </div>
);
