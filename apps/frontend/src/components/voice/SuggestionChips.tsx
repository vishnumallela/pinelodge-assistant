export function SuggestionChips({
  prompts,
  onPick,
  disabled,
}: {
  prompts: string[];
  onPick: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-wrap justify-center gap-2">
      <legend className="sr-only">Suggested prompts</legend>
      {prompts.map((p, i) => (
        <button
          key={p}
          type="button"
          disabled={disabled}
          onClick={() => onPick(p)}
          style={{ animationDelay: `${i * 40}ms` }}
          className="tap rounded-full border border-border bg-transparent px-4 py-2 text-left text-sm text-foreground/80 transition-[transform,scale,background-color,color] [animation:message-in_0.28s_var(--ease-out)_both] motion-reduce:animate-none active:scale-[0.96] pf-hover:bg-accent pf-hover:text-foreground disabled:cursor-default disabled:border-border disabled:text-disabled-foreground"
        >
          {p}
        </button>
      ))}
    </fieldset>
  );
}
