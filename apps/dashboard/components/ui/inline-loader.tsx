type InlineLoaderProps = {
  label?: string;
};

export function InlineLoader({ label = "Loading" }: InlineLoaderProps) {
  return (
    <span className="inline-loader" role="status">
      <span className="inline-loader__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="inline-loader__label">{label}</span>
    </span>
  );
}
